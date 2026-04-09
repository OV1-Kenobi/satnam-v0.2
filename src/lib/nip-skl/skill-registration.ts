/**
 * @module nip-skl/skill-registration
 * @description NIP-SKL skill lifecycle management.
 *
 * Provides builder functions for all NIP-SKL event kinds (33400, 33401, 1985, 5)
 * and the {@link SkillManager} class that orchestrates the full skill lifecycle:
 * register → attest → update version → revoke.
 *
 * Per spec §7.3:
 * - Skill Manifest:   kind 33400 (addressable, d-tag = skill slug)
 * - Skill Attestation: kind 1985 (NIP-32 labels, guardian-issued)
 * - Skill Version Log: kind 33401 (tracks version history)
 * - Skill Revocation:  kind 5 (NIP-09 deletion event)
 *
 * All builder functions return UnsignedEvent objects. Callers must sign with
 * nostr-tools `finalizeEvent()` before publishing.
 */

import type { SkillManifest, VerificationTier, GuardianAttestation } from "./types";
import type { UnsignedEvent } from "../nip90/construct";
import { computeManifestHash, fetchSkillManifest, parseManifestContent } from "./manifest";
import { verifyGuardianAttestation } from "./attestation-verifier";
import type { CepsClient } from "../ceps/ceps-client";
import type { Vault } from "../vault/vault";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string to a Uint8Array.
 * @internal
 */
function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ---------------------------------------------------------------------------
// Build functions
// ---------------------------------------------------------------------------

/**
 * Parameters for building a skill manifest event.
 */
export interface SkillManifestParams {
  /** d-tag — unique skill identifier within the publisher's key namespace. */
  scopeId: string;
  /** Human-readable skill name. */
  name: string;
  /** Semantic version string (e.g. "2.1.0"). */
  version: string;
  /** Short description of the skill's purpose. */
  description: string;
  /**
   * Capability strings declared by this skill.
   * Examples: "http:outbound", "web_search", "code:execution".
   */
  capabilities: string[];
  /** Arbitrary topic tags (e.g. ["agent-skill", "research"]). */
  tags: string[];
  /** Optional Unix timestamp at which this manifest expires. */
  expiryTimestamp?: number;
  /**
   * Optional JSON-serialisable input schema object.
   * Serialised to event content as `{ inputSchema, outputSchema }`.
   */
  inputSchema?: Record<string, unknown>;
  /**
   * Optional JSON-serialisable output schema object.
   */
  outputSchema?: Record<string, unknown>;
}

/**
 * Construct a skill manifest event (kind:33400) per spec §7.3.
 *
 * Tags included:
 * - `["d", scopeId]`
 * - `["name", name]`
 * - `["version", version]`
 * - `["description", description]`
 * - `["manifest_hash", <sha256>]` — computed from canonical tag payload
 * - `["capability", cap]` for each capability
 * - `["t", tag]` for each tag
 * - `["expiry", timestamp]` (only when expiryTimestamp is set)
 *
 * The manifest_hash covers a canonical serialisation of name + version +
 * description + sorted capabilities. Callers must sign the returned event.
 *
 * @param params - Skill manifest construction parameters
 * @returns Unsigned Nostr event ready for signing
 */
export function buildSkillManifest(params: SkillManifestParams): UnsignedEvent {
  const {
    scopeId,
    name,
    version,
    description,
    capabilities,
    tags,
    expiryTimestamp,
    inputSchema = {},
    outputSchema = {},
  } = params;

  // Compute manifest hash from canonical payload
  // (synchronous path — hash will be updated when published via SkillManager)
  const canonicalPayload = JSON.stringify({
    name,
    version,
    description,
    capabilities: [...capabilities].sort(),
  });

  const eventTags: string[][] = [
    ["d", scopeId],
    ["name", name],
    ["version", version],
    ["description", description],
    // manifest_hash placeholder — will be replaced with real hash by SkillManager
    // For direct use, callers must compute hash separately
    ["manifest_hash", "pending"],
    ...capabilities.map((cap) => ["capability", cap]),
    ...tags.map((t) => ["t", t]),
  ];

  if (expiryTimestamp !== undefined) {
    eventTags.push(["expiry", expiryTimestamp.toString()]);
  }

  const content = JSON.stringify({ inputSchema, outputSchema, canonicalPayload });

  return {
    kind: 33400,
    created_at: Math.floor(Date.now() / 1000),
    tags: eventTags,
    content,
  };
}

/**
 * Parameters for building a skill attestation event.
 */
export interface SkillAttestationParams {
  /** Nostr event ID of the manifest being attested. */
  manifestEventId: string;
  /** Attestation tier being issued. */
  tier: VerificationTier;
}

/**
 * Construct a skill attestation event (kind:1985, NIP-32 labels).
 *
 * Tags per spec §7.3:
 * - `["L", "skill"]`                      — label namespace
 * - `["l", "skill/verified", "skill"]`     — verified label
 * - `["l", tier, "skill"]`                 — tier label (e.g. "tier3")
 * - `["e", manifestEventId]`               — reference to manifest event
 *
 * Only guardians (trusted pubkeys in VITE_GUARDIAN_PUBKEYS) should publish
 * attestation events. The attestation is signed with the guardian's nsec.
 *
 * @param params - Attestation parameters
 * @returns Unsigned Nostr event ready for signing
 */
export function buildSkillAttestation(params: SkillAttestationParams): UnsignedEvent {
  const { manifestEventId, tier } = params;

  return {
    kind: 1985,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["L", "skill"],
      ["l", "skill/verified", "skill"],
      ["l", tier, "skill"],
      ["e", manifestEventId],
    ],
    content: "",
  };
}

/**
 * Parameters for building a skill version log event.
 */
export interface SkillVersionLogParams {
  /** d-tag of the skill (same as manifest scopeId). */
  scopeId: string;
  /** Previous semantic version (e.g. "1.0.0"). */
  previousVersion: string;
  /** New semantic version being logged. */
  newVersion: string;
  /** Type of version change. */
  changeType: "major" | "minor" | "patch";
  /** Nostr event ID of the new manifest event. */
  manifestEventId: string;
  /**
   * Unix timestamp at which the old version is revoked.
   * Set this when deprecating the previous version.
   */
  revokedAt?: number;
}

/**
 * Construct a skill version log event (kind:33401).
 *
 * Tracks version history with a link to the new manifest event.
 * The d-tag mirrors the manifest's d-tag so addressable queries can find
 * the full version history for a skill.
 *
 * @param params - Version log parameters
 * @returns Unsigned Nostr event ready for signing
 */
export function buildSkillVersionLog(params: SkillVersionLogParams): UnsignedEvent {
  const { scopeId, previousVersion, newVersion, changeType, manifestEventId, revokedAt } = params;

  const eventTags: string[][] = [
    ["d", scopeId],
    ["previous_version", previousVersion],
    ["new_version", newVersion],
    ["change_type", changeType],
    ["e", manifestEventId],
  ];

  if (revokedAt !== undefined) {
    eventTags.push(["revoked_at", revokedAt.toString()]);
  }

  return {
    kind: 33401,
    created_at: Math.floor(Date.now() / 1000),
    tags: eventTags,
    content: "",
  };
}

/**
 * Construct a skill revocation event (kind:5, NIP-09 deletion).
 *
 * Publishing this event signals to all consumers that the manifest should be
 * treated as deleted. The runtime gate's revocation check queries for this
 * event before allowing skill execution.
 *
 * The revocation event must be signed by the same keypair that published the
 * original manifest (same pubkey). Signing with a different key will be
 * ignored by compliant relays.
 *
 * @param manifestEventId - Nostr event ID of the manifest to revoke
 * @param reason          - Optional human-readable reason for revocation
 * @returns Unsigned Nostr event ready for signing
 */
export function buildSkillRevocation(
  manifestEventId: string,
  reason?: string
): UnsignedEvent {
  return {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["e", manifestEventId]],
    content: reason ?? "",
  };
}

// ---------------------------------------------------------------------------
// SkillWithAttestations — rich return type for getSkillWithAttestations()
// ---------------------------------------------------------------------------

/**
 * A skill manifest with its current attestation status.
 */
export interface SkillWithAttestations {
  manifest: SkillManifest;
  attestationResult: {
    valid: boolean;
    reason: string;
    tier?: VerificationTier;
    guardianPubkey?: string;
  };
  attestations: GuardianAttestation[];
}

// ---------------------------------------------------------------------------
// SkillManager — orchestrates full skill lifecycle
// ---------------------------------------------------------------------------

/**
 * Parameters for registering a new skill.
 */
export interface SkillRegistrationParams {
  scopeId: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  tags: string[];
  expiryTimestamp?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** Hex or bech32 nsec used to sign the manifest event. */
  signerNsec: string;
  /** Relay URLs to publish to. */
  relayUrls: string[];
}

/**
 * Parameters for updating a skill version.
 */
export interface SkillVersionUpdateParams {
  /** d-tag of the skill being updated. */
  scopeId: string;
  /** Event ID of the old manifest being superseded. */
  oldManifestEventId: string;
  /** Old version string. */
  previousVersion: string;
  /** New version string. */
  newVersion: string;
  /** Change type classification. */
  changeType: "major" | "minor" | "patch";
  /** Whether to also publish a NIP-09 revocation for the old manifest. */
  revokeOldVersion?: boolean;
  /** New manifest parameters. */
  newManifest: Omit<SkillManifestParams, "scopeId" | "version">;
  /** Hex or bech32 nsec used to sign events. */
  signerNsec: string;
  /** Relay URLs to publish to. */
  relayUrls: string[];
}

/**
 * Full skill management client.
 *
 * Wraps the lower-level build functions and the CEPS publishing pipeline.
 * All mutating operations (register, attest, update, revoke) sign events using
 * the caller-supplied nsec and publish via CEPS.
 *
 * @example
 * ```ts
 * const manager = new SkillManager(cepsClient, vault);
 * const eventId = await manager.registerSkill({
 *   scopeId: 'research-v2',
 *   name: 'Market Research',
 *   version: '2.0.0',
 *   description: 'Researches market data',
 *   capabilities: ['web_search', 'summarization'],
 *   tags: ['agent-skill', 'research'],
 *   signerNsec: nsec,
 *   relayUrls: ['wss://pylon.openagents.com'],
 * });
 * ```
 */
export class SkillManager {
  constructor(
    private readonly ceps: CepsClient,
    private readonly vault: Vault
  ) {}

  // -------------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------------

  /**
   * Register a new skill by constructing the manifest, computing its hash,
   * signing it, and publishing it via CEPS.
   *
   * @param params - Skill registration parameters
   * @returns The published manifest event ID
   */
  async registerSkill(params: SkillRegistrationParams): Promise<string> {
    const {
      scopeId,
      name,
      version,
      description,
      capabilities,
      tags,
      expiryTimestamp,
      inputSchema,
      outputSchema,
          relayUrls,
    } = params;

    // Build the unsigned manifest
    const unsigned = buildSkillManifest({
      scopeId,
      name,
      version,
      description,
      capabilities,
      tags,
      expiryTimestamp,
      inputSchema,
      outputSchema,
    });

    // Compute the real manifest hash from the canonical payload string
    const canonicalPayload = JSON.stringify({
      name,
      version,
      description,
      capabilities: [...capabilities].sort(),
    });
    const manifestHash = await computeManifestHash(strToBytes(canonicalPayload));

    // Replace the placeholder hash tag with the real one
    unsigned.tags = unsigned.tags.map((tag) =>
      tag[0] === "manifest_hash" ? ["manifest_hash", manifestHash] : tag
    );

    // Sign and publish via CEPS
    const signedEvent = await this.ceps.signEventWithActiveSession(unsigned as any);
    const eventId = await this.ceps.publishEvent(signedEvent, relayUrls);
    return eventId;
  }

  // -------------------------------------------------------------------------
  // Attest
  // -------------------------------------------------------------------------

  /**
   * Attest a skill (Guardian only).
   *
   * Publishes a kind:1985 NIP-32 label event signed with the guardian's nsec.
   *
   * @param manifestEventId - Event ID of the manifest to attest
   * @param tier            - Attestation tier to grant
   * @param signerNsec      - Guardian's nsec (must be in VITE_GUARDIAN_PUBKEYS)
   * @returns The published attestation event ID
   */
  async attestSkill(
    manifestEventId: string,
    tier: VerificationTier: string
  ): Promise<string> {
    void signerNsec; // Used via CEPS session initialised by caller

    const unsigned = buildSkillAttestation({ manifestEventId, tier });

    const signedEvent = await this.ceps.signEventWithActiveSession(unsigned as any);
    const eventId = await this.ceps.publishEvent(signedEvent);
    return eventId;
  }

  // -------------------------------------------------------------------------
  // Update version
  // -------------------------------------------------------------------------

  /**
   * Update a skill's version.
   *
   * 1. Publishes a new kind:33400 manifest with the updated version.
   * 2. Publishes a kind:33401 version log entry.
   * 3. Optionally publishes a kind:5 revocation for the old manifest.
   *
   * @param params - Version update parameters
   * @returns The new manifest event ID
   */
  async updateSkillVersion(params: SkillVersionUpdateParams): Promise<string> {
    const {
      scopeId,
      oldManifestEventId,
      previousVersion,
      newVersion,
      changeType,
      revokeOldVersion = false,
      newManifest,
          relayUrls,
    } = params;

    void signerNsec; // Used via active CEPS session

    // 1. Register the new manifest
    const newManifestEventId = await this.registerSkill({
      scopeId,
      version: newVersion,
      name: newManifest.name,
      description: newManifest.description,
      capabilities: newManifest.capabilities,
      tags: newManifest.tags,
      expiryTimestamp: newManifest.expiryTimestamp,
      inputSchema: newManifest.inputSchema,
      outputSchema: newManifest.outputSchema,
          relayUrls,
    });

    // 2. Publish version log
    const versionLog = buildSkillVersionLog({
      scopeId,
      previousVersion,
      newVersion,
      changeType,
      manifestEventId: newManifestEventId,
      revokedAt: revokeOldVersion ? Math.floor(Date.now() / 1000) : undefined,
    });

    const signedLog = await this.ceps.signEventWithActiveSession(versionLog as any);
    await this.ceps.publishEvent(signedLog, relayUrls);

    // 3. Optionally revoke the old manifest
    if (revokeOldVersion) {
      const revocation = buildSkillRevocation(
        oldManifestEventId,
        `Superseded by version ${newVersion}`
      );
      const signedRevocation = await this.ceps.signEventWithActiveSession(revocation as any);
      await this.ceps.publishEvent(signedRevocation, relayUrls);
    }

    return newManifestEventId;
  }

  // -------------------------------------------------------------------------
  // Revoke
  // -------------------------------------------------------------------------

  /**
   * Revoke a skill by publishing a NIP-09 kind:5 deletion event.
   *
   * After revocation, the runtime gate will block all further executions of
   * this skill version.
   *
   * @param manifestEventId - Event ID of the manifest to revoke
   * @param signerNsec      - Publisher's nsec (must match manifest author)
   * @param reason          - Optional reason included in the deletion content
   * @returns The published revocation event ID
   */
  async revokeSkill(
    manifestEventId: string: string,
    reason?: string
  ): Promise<string> {
    void signerNsec; // Used via active CEPS session

    const revocation = buildSkillRevocation(manifestEventId, reason);
    const signedEvent = await this.ceps.signEventWithActiveSession(revocation as any);
    const eventId = await this.ceps.publishEvent(signedEvent);
    return eventId;
  }

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  /**
   * List all skill manifests published by a given pubkey.
   *
   * Queries kind:33400 events from the relay and returns them as SkillManifest
   * objects. Results are ordered by `created_at` descending (newest first).
   *
   * @param publisherPubkey - Hex pubkey of the skill publisher
   * @param relayUrl        - Relay URL to query
   * @returns Array of SkillManifest objects
   */
  async listSkills(publisherPubkey: string, relayUrl: string): Promise<SkillManifest[]> {
    const { listEventsWithCeps } = await import("../ceps/index");
    const { validateManifest } = await import("./manifest");

    const events = await listEventsWithCeps(
      [{ kinds: [33400], authors: [publisherPubkey], limit: 100 }],
      [relayUrl],
      { eoseTimeout: 8000 }
    );

    const manifests: SkillManifest[] = [];
    for (const event of events) {
      if (validateManifest(event as any)) {
        manifests.push(parseManifestContent(event as any));
      }
    }

    // Sort by created_at descending
    manifests.sort((a, b) => {
      const aTime = a.rawEvent?.created_at ?? 0;
      const bTime = b.rawEvent?.created_at ?? 0;
      return bTime - aTime;
    });

    return manifests;
  }

  // -------------------------------------------------------------------------
  // Get with attestations
  // -------------------------------------------------------------------------

  /**
   * Fetch a skill manifest and check its current attestation status.
   *
   * Returns the manifest, the attestation verification result, and the raw
   * attestation array.
   *
   * @param scopeId  - Skill scope ID ("33400:<pubkey>:<d-tag>:<version>")
   * @param relayUrl - Relay URL to query
   * @returns SkillWithAttestations object
   * @throws {Error} if the manifest cannot be found
   */
  async getSkillWithAttestations(
    scopeId: string,
    relayUrl: string
  ): Promise<SkillWithAttestations> {
    const manifest = await fetchSkillManifest(scopeId, [relayUrl]);

    if (!manifest) {
      throw new Error(`Skill manifest not found: ${scopeId}`);
    }

    const attestationResult = await verifyGuardianAttestation(manifest);

    return {
      manifest,
      attestationResult,
      attestations: manifest.attestations,
    };
  }
}

