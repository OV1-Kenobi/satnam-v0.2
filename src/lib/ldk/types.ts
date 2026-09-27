/** LDK types — stable-channel ready, no native dep in Phase 0 */
export type LdkInvoice = { bolt11: string; paymentHash: string; amountMsats: bigint };
export type LdkChannelConfig = { stableChannel?: boolean; pushMsats?: bigint };
export interface LdkAdapter {
  createInvoice(amountMsats: bigint, description: string): Promise<LdkInvoice>;
  payInvoice(bolt11: string): Promise<{ preimage: string }>;
  getBalance(): Promise<bigint>;
  openChannel(pubkey: string, amountSats: number, cfg?: LdkChannelConfig): Promise<string>;
}
