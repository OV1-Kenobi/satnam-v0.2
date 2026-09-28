import type { LdkAdapter, LdkInvoice } from "./types.js";
import { createHash, randomBytes } from "node:crypto";

/** Mock LDK — no native, returns synthetic bolt11, stableChannel flag honored but no-op */
export class MockLdkAdapter implements LdkAdapter {
  async createInvoice(amountMsats: bigint, _desc: string): Promise<LdkInvoice> {
    const pre = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(Buffer.from(pre, "hex")).digest("hex");
    // lnbc1dry mock — stable-channel creation does not affect invoice shape in mock
    return { bolt11: `lnbc1dry_${amountMsats}_${hash.slice(0,12)}`, paymentHash: hash, amountMsats };
  }
  async payInvoice(_bolt11: string): Promise<{ preimage: string }> {
    return { preimage: randomBytes(32).toString("hex") };
  }
  async getBalance(): Promise<bigint> { return 0n; }
  async openChannel(_pubkey: string, _amountSats: number, _cfg?: { stableChannel?: boolean }): Promise<string> {
    return `mock_channel_${randomBytes(4).toString("hex")}`;
  }
}

export function getLdkAdapter(): LdkAdapter {
  // Phase 0: always mock. Phase 1: if VITE_LDK_ENABLED and native built, return real LDK adapter.
  return new MockLdkAdapter();
}
