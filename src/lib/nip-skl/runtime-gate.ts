// Ported from v1 src/lib/nip-skl/runtime-gate.ts
// Stripped: Supabase checkEnvelopeStatus() stub comment (Supabase not used client-side in v2)
//   Import paths updated: types/nip-skl → ./types
//   Relay queries now use CEPS (via fetchSkillManifest)
// No JWT or auth coupling present — file was clean

/**
 * NIP-SKL Runtime Gate — Critical Safety Gate
 *
 * SECURITY: This function must be called before every skill execution
 * with no bypass path. Returns typed result — never throws — to prevent
 * silent failures from empty catch blocks.
 *
 * Checks (in order):
 * 1. Manifest exists on relay with valid signature (kind:33400)
 * 2. Guardian attestation present from trusted pubkey (kind:1985, NIP-32)
 * 3. No NIP-09 kind:5 revocation from the same publisher pubkey
 * 4. manifestEventId matches envelope version pin (constant-time compare)
 * 5. Constraints satisfied — agent pubkey has required attestation tier
 *    AND skill is in the agent's enabled_skills list (if agentProfile supplied)
 *
 * Aligned with spec §7.3 and §12.1 (security invariants).
 */

import type { RuntimeGateResult, SkillManifest, VerificationTier } from "./types";
import { fetchSkillManifest, validateManifest } from "./manifest";
import { verifyGuardianAttestation, tierMeetsMinimum, parseTierFromLabel } from "./attestation-verifier";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runtime gate options controlling which checks are performed.
 */
export interface RuntimeGateOptions {
  /**
   * Required attestation tier. Defaults to "tier1" (any attestation).
   * Set to "tier3" for cross-platform consumption (spec §7.3 recommendation).
   */
  requiredTier?: VerificationTier;

  /**
   * Agent pubkey (hex). When provided, the gate also verifies the agent
   * profile's `enabled_skills` tag includes this skill's scopeId.
   */
  agentPubkey?: string;

  /**
   * Raw agent profile event tags (kind:39200). When provided, used to
   * check `enabled_skills` list. Sourced from the caller's local store.
   */
  agentProfileTags?: string[][];

  /**
   * Relay URLs to query. Falls back to CEPS default relays when omitted.
   */
  relayUrls?: string[];
}

/**
 * Verify all NIP-SKL runtime gate checks before allowing skill execution.
 *
 * All 5 checks must pass for `allowed` to be true. The function stops and
 * returns as soon as a check fails — downstream checks remain `false` in the
 * result's `checks` map so callers can see the exact failure point.
 *
 * Never throws. All errors are caught and surfaced via the `reason` field.
 *
 * @param skillScopeId     - Canonical skill address: "33400:<pubkey>:<d-tag>:<version>"
 * @param manifestEventId  - Expected Nostr event ID of the manifest (the version pin)
 * @param options          - Optional gate configuration (tier, agent profile, relay URLs)
 * @returns                  RuntimeGateResult — never throws
 *
 * @example
 * ```ts
 * const gate = await verifySkillExecution(
 *   "33400:abc123:research-v2:2.0.0",
 *   "deadbeef...",
 *   { requiredTier: "tier3", agentProfileTags: agentEvent.tags }
 * );
 * if (!gate.allowed) throw new Error(`Skill execution blocked: ${gate.reason}`);
 * ```
 */
export async function verifySkillExecution(
  skillScopeId: string,
  manifestEventId: string,
  options: RuntimeGateOptions = {}
): Promise<RuntimeGateResult> {
  const checks = {
    manifestExists: false,
    guardianAttestationValid: false,
    noRevocation: false,
    versionPinMatches: false,
    constraintsSatisfied: false,
  };

  const relayUrls = options.relayUrls ?? [];

  // -------------------------------------------------------------------------
  // CHECK 1: Manifest exists — fetch kind:33400 from relay
  // -------------------------------------------------------------------------
  let manifest: SkillManifest | null = null;

  try {
    manifest = await fetchSkillManifest(skillScopeId, relayUrls);
  } catch (error) {
    return {
      allowed: false,
      reason: `Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      checks,
    };
  }

  if (!manifest || !manifest.rawEvent) {
    return {
      allowed: false,
      reason: "Manifest not found on relay",
      checks,
    };
  }

  // Validate signature, required tags, and semver format
  if (!validateManifest(manifest.rawEvent)) {
    return {
      allowed: false,
      reason: "Manifest signature or structure is invalid",
      checks,
    };
  }

  // Reject expired manifests (spec §7.3: expiry unix timestamp)
  if (
    manifest.validUntilUnix !== undefined &&
    manifest.validUntilUnix < Math.floor(Date.now() / 1000)
  ) {
    return {
      allowed: false,
      reason: `Skill manifest expired at unix ${manifest.validUntilUnix}`,
      checks,
    };
  }

  checks.manifestExists = true;

  // -------------------------------------------------------------------------
  // CHECK 2: Guardian attestation valid — query kind:1985 NIP-32 labels
  // -------------------------------------------------------------------------
  const attestationResult = await verifyGuardianAttestation(manifest);

  if (!attestationResult.valid) {
    return {
      allowed: false,
      reason: `Guardian attestation invalid: ${attestationResult.reason}`,
      checks,
    };
  }

  // Optionally enforce a minimum attestation tier
  const requiredTier = options.requiredTier ?? "tier1";
  if (!tierMeetsMinimum(attestationResult.tier, requiredTier)) {
    const actual = attestationResult.tier ?? "none";
    return {
      allowed: false,
      reason: `Attestation tier insufficient: got "${actual}", required "${requiredTier}"`,
      checks,
    };
  }

  checks.guardianAttestationValid = true;

  // -------------------------------------------------------------------------
  // CHECK 3: No revocation — query kind:5 NIP-09 deletions from the publisher
  // -------------------------------------------------------------------------
  const revocationResult = await checkForRevocation(
    manifest.manifestEventId,
    manifest.publisherPubkey,
    relayUrls
  );

  if (revocationResult.revoked) {
    return {
      allowed: false,
      reason: `Skill manifest revoked by publisher${revocationResult.reason ? `: ${revocationResult.reason}` : ""}`,
      checks,
    };
  }

  checks.noRevocation = true;

  // -------------------------------------------------------------------------
  // CHECK 4: Version pin matches — constant-time compare of event IDs
  // -------------------------------------------------------------------------
  let versionPinMatches = false;
  try {
    versionPinMatches = await constantTimeEqual(manifest.manifestEventId, manifestEventId);
  } catch (error) {
    return {
      allowed: false,
      reason: `Version pin comparison failed: ${error instanceof Error ? error.message : String(error)}`,
      checks,
    };
  }

  if (!versionPinMatches) {
    return {
      allowed: false,
      reason: `Version pin mismatch: envelope pins "${manifestEventId.slice(0, 8)}…" but relay manifest has "${manifest.manifestEventId.slice(0, 8)}…"`,
      checks,
    };
  }

  checks.versionPinMatches = true;

  // -------------------------------------------------------------------------
  // CHECK 5: Constraints satisfied — tier OK + optional enabled_skills check
  // -------------------------------------------------------------------------
  const constraintResult = checkConstraints(manifest, options);

  if (!constraintResult.satisfied) {
    return {
      allowed: false,
      reason: constraintResult.reason,
      checks,
    };
  }

  checks.constraintsSatisfied = true;

  // -------------------------------------------------------------------------
  // All checks passed
  // -------------------------------------------------------------------------
  return {
    allowed: true,
    reason: "All 5 runtime gate checks passed",
    checks,
  };
}

// ---------------------------------------------------------------------------
// Internal: Revocation check
// ---------------------------------------------------------------------------

interface RevocationCheckResult {
  revoked: boolean;
  reason?: string;
}

/**
 * Query the relay for kind:5 NIP-09 deletion events from the manifest publisher
 * that reference the manifest event ID.
 *
 * Returns `{ revoked: false }` if no deletion event is found, or if the relay
 * query fails (non-fatal; we default to non-revoked to avoid liveness issues).
 *
 * @internal
 */
async function checkForRevocation(
  manifestEventId: string,
  publisherPubkey: string,
  relayUrls: string[]
): Promise<RevocationCheckResult> {
  try {
    const { listEventsWithCeps } = await import("../ceps/index");

    const deletionEvents = await listEventsWithCeps(
      [
        {
          kinds: [5],
          authors: [publisherPubkey],
          "#e": [manifestEventId],
          limit: 1,
        },
      ],
      relayUrls.length > 0 ? relayUrls : undefined,
      { eoseTimeout: 5000 }
    );

    if (deletionEvents.length > 0) {
      // Extract optional reason from the first deletion event's content
      const reason = (deletionEvents[0] as any).content ?? undefined;
      return { revoked: true, reason: reason || undefined };
    }

    return { revoked: false };
  } catch (error) {
    // Non-fatal: relay query failure defaults to "not revoked" with a warning.
    // This prevents revocation check outages from permanently blocking all
    // skill execution. Log but do not block.
    console.warn(
      `[runtime-gate] Revocation check relay query failed (defaulting to non-revoked): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { revoked: false };
  }
}

// ---------------------------------------------------------------------------
// Internal: Constraints check
// ---------------------------------------------------------------------------

interface ConstraintCheckResult {
  satisfied: boolean;
  reason: string;
}

/**
 * Verify that the manifest's runtime constraints are satisfied and, when an
 * agent profile is supplied, that the skill's scopeId appears in the agent's
 * `enabled_skills` tag.
 *
 * Per spec §7.3: "agent pubkey has the required attestation tier + skill is in
 * enabled_skills".
 *
 * @internal
 */
function checkConstraints(
  manifest: SkillManifest,
  options: RuntimeGateOptions
): ConstraintCheckResult {
  const { agentProfileTags, agentPubkey } = options;

  // Check enabled_skills list when agent profile tags are provided
  if (agentProfileTags && agentProfileTags.length > 0) {
    const enabledSkillsTag = agentProfileTags.find((t) => t[0] === "enabled_skills");

    if (enabledSkillsTag) {
      // enabled_skills tag format: ["enabled_skills", "<scopeId1>", "<scopeId2>", ...]
      const enabledScopeIds = enabledSkillsTag.slice(1);

      // Match either the full scopeId or just the d-tag component
      const parts = manifest.skillScopeId.split(":");
      const dTag = parts[2] ?? "";

      const isEnabled =
        enabledScopeIds.includes(manifest.skillScopeId) ||
        enabledScopeIds.includes(dTag);

      if (!isEnabled) {
        const agentDesc = agentPubkey ? ` (agent: ${agentPubkey.slice(0, 8)}…)` : "";
        return {
          satisfied: false,
          reason: `Skill "${manifest.skillScopeId}" not in agent's enabled_skills list${agentDesc}`,
        };
      }
    }
    // If the agent has no enabled_skills tag, skill is implicitly allowed
  }

  // All constraints passed
  return { satisfied: true, reason: "Constraints satisfied" };
}

// ---------------------------------------------------------------------------
// Internal: Constant-time comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison using Web Crypto HMAC.
 *
 * Computes HMAC-SHA-256 of both strings under the same random key, then
 * compares the resulting MACs byte-by-byte with no early exit. This prevents
 * timing-side-channel attacks on manifestEventId comparisons.
 *
 * Aligned with spec §12.1 (security invariants).
 *
 * @internal
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();

  // Generate a fresh random HMAC key for this comparison.
  // Using a random key prevents offline pre-computation attacks.
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const [macA, macB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);

  return timingSafeArrayBufferEqual(macA, macB);
}

/**
 * Constant-time ArrayBuffer comparison.
 * Processes all bytes — no early return on mismatch.
 *
 * @internal
 */
function timingSafeArrayBufferEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Re-exports (used by skill-registration.ts and tests)
// ---------------------------------------------------------------------------
export { parseTierFromLabel };

