/**
 * @module clink/client
 * @description Phase 0 pure CLINK dry-run — resolves lud16|noffer → bolt11 stub.
 *
 * Dry-run: no LND/LDK invoice. Returns synthetic DRY_RUN bolt11 for validation.
 * Live: will call @shocknet/clink-sdk ClinkSDK.Noffer via shared StrFry relay.
 *
 * Feature flag: VITE_ENABLE_CLINK (off → throws), VITE_DRY_RUN (on → stub).
 */
import { isClinkEnabled, isDryRun } from '../../config/env.js';

export type ClinkResolveResult =
  | { ok: true; bolt11: string; mode: 'dry' | 'live'; source: 'noffer' | 'lud16-bridge' }
  | { ok: false; reason: string };

const DRY_PREFIX = 'lnbc1dry';

function syntheticBolt11(amountMsats: bigint): string {
  // Not a valid lightning invoice — flagged DRY_RUN for UI/tests. Amount encoded for display.
  return `${DRY_PREFIX}_${amountMsats}_dryrun`;
}

export async function resolveToBolt11(
  input: string,
  amountMsats: bigint,
  _opts?: { memo?: string }
): Promise<ClinkResolveResult> {
  if (!isClinkEnabled()) return { ok: false, reason: 'clink_disabled' };
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty_input' };
  if (isDryRun()) {
    // Accept noffer1... or lud16@domain, both resolve to stub
    if (raw.startsWith('noffer1') || raw.includes('@')) {
      return { ok: true, bolt11: syntheticBolt11(amountMsats), mode: 'dry', source: raw.startsWith('noffer1') ? 'noffer' : 'lud16-bridge' };
    }
    return { ok: false, reason: 'unsupported_input_dry' };
  }
  // Live path — uses CLINK sdk stub (Phase 0 dry returns same dry bolt11, Phase 1 will call getLiveSdk)
  const { DryClinkSdk } = await import('./sdk.js');
  const s = new DryClinkSdk('wss://relay.satnam.pub');
  const r = await s.noffer(raw, amountMsats);
  return { ok: true, bolt11: r.bolt11, mode: 'dry', source: raw.startsWith('noffer1') ? 'noffer' : 'lud16-bridge' };
}

export function isDryBolt11(bolt11: string): boolean {
  return String(bolt11).startsWith(DRY_PREFIX);
}
