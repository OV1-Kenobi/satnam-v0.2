// Ported from v1 types/nip-skl.ts
// No decontamination required — pure type definitions, no auth/Supabase coupling
// family_* naming: not present in this file (was clean)

/**
 * NIP-SKL Type Definitions
 *
 * Skill Registry (kinds 33400–33401) type system for Satnam v2.
 * Aligned with spec §7.3 and OpenAgents NIP-SKL.
 */

/**
 * Skill Manifest (kind 33400)
 * Addressable event with d-tag = skill slug
 */
export interface SkillManifest {
  skillScopeId: string; // "33400:<pubkey>:<d-tag>:<version>"
  version: string;      // semver
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  runtimeConstraints: string[]; // e.g. ["max_wall_seconds:30"]
  attestations: GuardianAttestation[]; // kind 1985 refs
  publisherPubkey: string;
  manifestEventId: string; // Nostr event id
  manifestHash?: string;   // SHA-256 of skill payload
  capabilities?: string[]; // e.g. ["http:outbound"]
  validUntilUnix?: number;
  relayHint?: string;
  rawEvent?: NostrEvent; // Full Nostr event for verification
}

/**
 * Guardian Attestation (kind 1985, NIP-32 labels)
 */
export interface GuardianAttestation {
  guardianPubkey: string;
  manifestEventId: string;
  label: string; // e.g. "skill/verified", "skill/audited", "skill/verified/tier3"
  tier?: VerificationTier;
  timestamp: number;
  nostrEventId?: string;
}

/**
 * Verification Tier
 * Aligned with spec §7.3 attestation tiers
 */
export type VerificationTier = "tier1" | "tier2" | "tier3" | "tier4";

export const VerificationTierLabels: Record<VerificationTier, string> = {
  tier1: "Self-Declared",
  tier2: "Peer-Reviewed",
  tier3: "Guardian-Attested",
  tier4: "Oracle-Verified",
};

/**
 * Skill Version Log (kind 33401)
 */
export interface SkillVersionLog {
  manifestEventId: string;
  version: string;
  previousVersion?: string;
  changeDescription: string;
  changeType?: "added" | "changed" | "fixed" | "deprecated" | "security";
  revokedAt?: number;
  publisherPubkey: string;
  timestamp: number;
}

/**
 * Runtime Constraint
 * Parsed from runtimeConstraints array
 */
export interface RuntimeConstraint {
  type: string; // e.g. "max_wall_seconds", "max_input_bytes"
  value: string | number;
  raw: string; // Original constraint string
}

/**
 * Skill Registry Cache Entry
 * Used by registry.ts for IndexedDB persistence
 */
export interface SkillRegistryCacheEntry {
  skillScopeId: string;
  manifest: SkillManifest;
  cachedAt: number;
  ttlSeconds: number;
  lastSyncTimestamp?: number;
}

/**
 * Runtime Gate Verification Result
 * Returned by runtime-gate.ts verifySkillExecution()
 */
export interface RuntimeGateResult {
  allowed: boolean;
  reason: string;
  checks?: {
    manifestExists: boolean;
    guardianAttestationValid: boolean;
    noRevocation: boolean;
    versionPinMatches: boolean;
    constraintsSatisfied: boolean;
  };
}

/**
 * Minimal Nostr Event interface
 */
export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Attestation Verification Result
 */
export interface AttestationVerificationResult {
  valid: boolean;
  reason: string;
  tier?: VerificationTier;
  guardianPubkey?: string;
}

/**
 * Skill Revocation Event (kind 5, NIP-09)
 */
export interface SkillRevocationEvent {
  revokedEventId: string; // The manifest event being revoked
  publisherPubkey: string;
  reason?: string;
  timestamp: number;
  nostrEventId: string;
}
