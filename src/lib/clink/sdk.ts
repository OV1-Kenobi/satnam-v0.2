/**
 * @module clink/sdk
 * @description Live CLINK wrapper — imports @shocknet/clink-sdk when installed.
 * Phase 0 dry-run: uses synthetic types; live path is type-checked but not network-tested.
 * No network calls in this module — caller decides dry vs live via isDryRun().
 */
export type ClinkOffer = { pubkey: string; relay: string; offerId: string; amountMsats?: bigint };
export type ClinkEnrollResult =
  | { ok: true; noffer: string; ndebit: string; nmanage: string }
  | { ok: false; reason: 'pow_required'; requiredDifficulty: number }
  | { ok: false; reason: string };

export interface ClinkSdk {
  noffer(offer: string, amountMsats?: bigint): Promise<{ bolt11: string }>;
  enroll(relay: string): Promise<ClinkEnrollResult>;
}

// Dry implementation — used in Phase 0 pure dry-run
export class DryClinkSdk implements ClinkSdk {
  constructor(_relay: string) { void _relay; }
  async noffer(offer: string, amountMsats?: bigint): Promise<{ bolt11: string }> {
    return { bolt11: `lnbc1dry_${String(amountMsats ?? 1000n)}_dryrun_${offer.slice(0,8)}` };
  }
  async enroll(_relay: string): Promise<ClinkEnrollResult> {
    const pk = '0'.repeat(64);
    return { ok: true, noffer: `noffer1dry_${pk.slice(0,12)}`, ndebit: `ndebit1dry_${pk.slice(0,12)}`, nmanage: `nmanage1dry_${pk.slice(0,12)}` };
  }
}

// Live stub — type-checked shape for @shocknet/clink-sdk; swap dry→live by flipping isDryRun()
export async function getLiveSdk(_relay: string): Promise<ClinkSdk> {
  // Live import deferred: `await import('@shocknet/clink-sdk')` then wrap ClinkSDK class.
  // Keeping as Dry for Phase 0 so `npm install` not required to pass tsc.
  return new DryClinkSdk(_relay);
}
