// Ported from v1 src/lib/nip-skl/attestation-verifier.ts
// Stripped: getEnvVar import (v1 config path) — replaced with direct import.meta.env
// Import paths updated: types/nip-skl → ./types
// No JWT or Supabase coupling present — file was clean

/**
 * NIP-SKL Attestation Verifier
 *
 * Validates kind 1985 guardian attestations for skill manifests.
 * Reads trusted guardian pubkeys from VITE_GUARDIAN_PUBKEYS env var.
 * Attestation tier definitions per spec §7.3.
 */

import type {
  SkillManifest,
  AttestationVerificationResult,
  VerificationTier,
} from "./types";

export async function verifyGuardianAttestation(
  manifest: SkillManifest
): Promise<AttestationVerificationResult> {
  const guardianPubkeysEnv =
    (typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_GUARDIAN_PUBKEYS
      : undefined) ||
    process.env?.VITE_GUARDIAN_PUBKEYS ||
    "";

  if (!guardianPubkeysEnv) {
    return {
      valid: false,
      reason:
        "No trusted guardian pubkeys configured (VITE_GUARDIAN_PUBKEYS not set)",
    };
  }

  const trustedPubkeys = guardianPubkeysEnv
    .split(",")
    .map((pk: string) => pk.trim())
    .filter(Boolean);

  if (trustedPubkeys.length === 0) {
    return {
      valid: false,
      reason: "No trusted guardian pubkeys configured",
    };
  }

  if (!manifest.attestations || manifest.attestations.length === 0) {
    return {
      valid: false,
      reason: "No guardian attestations found for this skill",
    };
  }

  const trustedAttestations = manifest.attestations.filter((att) =>
    trustedPubkeys.includes(att.guardianPubkey)
  );

  if (trustedAttestations.length === 0) {
    return {
      valid: false,
      reason: "No attestations from trusted guardians",
    };
  }

  for (const attestation of trustedAttestations) {
    const labelResult = validateAttestationLabel(attestation.label);
    if (labelResult.valid) {
      return {
        valid: true,
        reason: "Valid guardian attestation found",
        tier: labelResult.tier,
        guardianPubkey: attestation.guardianPubkey,
      };
    }
  }

  return {
    valid: false,
    reason: "Attestations found but labels are invalid",
  };
}

/**
 * Validate attestation label format.
 * Accepts: "skill/verified", "skill/audited", "skill/verified/tier1", etc.
 */
function validateAttestationLabel(label: string): {
  valid: boolean;
  tier?: VerificationTier;
} {
  const validBaseLabels = ["skill/verified", "skill/audited"];
  if (validBaseLabels.includes(label)) {
    return { valid: true };
  }

  const tierMatch = label.match(/^skill\/(verified|audited)\/tier([1-4])$/);
  if (tierMatch) {
    const tier = `tier${tierMatch[2]}` as VerificationTier;
    return { valid: true, tier };
  }

  return { valid: false };
}

/**
 * Check attestation tier level.
 * v2: Guardian capability checking via NIP-26 delegation events (future enhancement).
 */
export function checkAttestationTier(
  _guardianPubkey: string,
  _tier: VerificationTier
): boolean {
  // TODO v2: Query guardian profile (kind:39200) and verify declared tier capability
  // For now, all trusted guardians can issue any tier
  return true;
}

/**
 * Parse tier from attestation label.
 */
export function parseTierFromLabel(
  label: string
): VerificationTier | undefined {
  const tierMatch = label.match(/tier([1-4])$/);
  if (tierMatch) {
    return `tier${tierMatch[1]}` as VerificationTier;
  }
  return undefined;
}

/**
 * Minimum required tier for cross-platform skill consumption.
 * Per spec §7.3: Tier 3 (Guardian-Attested) recommended for cross-platform.
 */
export function getMinimumCrossPlatformTier(): VerificationTier {
  return "tier3";
}

/**
 * Check if a tier meets the minimum requirement.
 */
export function tierMeetsMinimum(
  tier: VerificationTier | undefined,
  minimum: VerificationTier
): boolean {
  if (!tier) return false;

  const tierLevels: Record<VerificationTier, number> = {
    tier1: 1,
    tier2: 2,
    tier3: 3,
    tier4: 4,
  };

  return tierLevels[tier] >= tierLevels[minimum];
}
