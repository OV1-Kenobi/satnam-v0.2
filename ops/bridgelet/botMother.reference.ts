/**
 * Bot-Mother — dry-run Enroll/PoW (Phase 0).
 * POST /bot-mother/birth?dryRun=1 → synthetic agenticNN@shockwallet.app
 * Real: dryRun=0 → CLINK Nenroll on relay.shock.network → real Pub noffer.
 */
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { createHash, randomBytes } from "node:crypto";

export type BirthRequest = { motherNip98?: string; label: string; tier?: string };
export type BirthResult = {
  agentNpub: string; agentNsecRef: string; noffer: string; ndebit: string; nmanage: string;
  nip05: string; dryRun: boolean;
};

function syntheticNoffer(pubkey: string): string {
  // DRY: bech32-like stub — not a real CLINK string, decodes as dry for Phase 0
  return `noffer1dry_${pubkey.slice(0,16)}`;
}

function powStub(difficulty: number): string {
  if (difficulty <= 0) return "pow0";
  let nonce = 0; // Phase 0: no real hashcash, just loop marker
  return `pow_d${difficulty}_n${nonce}`;
}

export async function birthAgentDryRun(label: string): Promise<BirthResult> {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const npub = nip19.npubEncode(pk);
  const noffer = syntheticNoffer(pk);
  const ndebit = `ndebit1dry_${pk.slice(0,16)}`;
  const nmanage = `nmanage1dry_${pk.slice(0,16)}`;
  // PoW stub — Phase 0 dry requires no work; live path will hashcash per required_difficulty
  powStub(0);
  // Mirror NIP-05 — caller inserts nip05_identifiers row (agenticNN, shockwallet.app)
  const safe = label.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "agentic";
  return {
    agentNpub: npub, agentNsecRef: `agent/${safe}.nsec`,
    noffer, ndebit, nmanage,
    nip05: `${safe}@shockwallet.app`,
    dryRun: true
  };
}

// Express handler (wire in satnamd/src/index.ts)
// app.post("/bot-mother/birth", async (req,res) => {
//   if (String(req.query.dryRun) !== "1") return res.status(501).json({error:"live not in Phase 0 dry-run"});
//   const { label } = req.body as BirthRequest;
//   if (!label) return res.status(400).json({error:"label required"});
//   // TODO: verify mother NIP-98 + rate_limits + per-mother 10/hr
//   const r = await birthAgentDryRun(label);
//   // TODO: Vault storeNsec, NIP-26 delegation from Guardian, Supabase mirror
//   res.json(r);
// });
