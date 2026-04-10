/**
 * @module hooks/useSkillManager
 * @description React hook wrapping {@link SkillManager} for NIP-SKL skill lifecycle
 * management in Satnam v2 component trees.
 *
 * The hook lazily initialises a SkillManager backed by the CEPS client and
 * OPFS Vault. All skill registration, attestation, version update, and
 * revocation operations are exposed as async functions with loading/error state.
 *
 * ## Usage
 * ```tsx
 * function SkillRegistrationPanel() {
 *   const {
 *     isLoading, error,
 *     registerSkill, attestSkill, revokeSkill,
 *     listSkills, getSkillWithAttestations,
 *   } = useSkillManager();
 *
 *   const handleRegister = async () => {
 *     const eventId = await registerSkill({
 *       scopeId: 'research-v2',
 *       name: 'Market Research',
 *       version: '2.0.0',
 *       description: 'Researches market data',
 *       capabilities: ['web_search'],
 *       tags: ['agent-skill'],
 *       signerNsec: nsec,
 *       relayUrls: ['wss://pylon.openagents.com'],
 *     });
 *   };
 * }
 * ```
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getCepsClient } from '../lib/ceps/ceps-client.js';
import { getVault } from '../lib/vault/vault.js';
import { SkillManager } from '../lib/nip-skl/skill-registration.js';
import type {
  SkillRegistrationParams,
  SkillVersionUpdateParams,
  SkillWithAttestations,
} from '../lib/nip-skl/skill-registration.js';
import type { SkillManifest, VerificationTier, GuardianAttestation } from '../lib/nip-skl/types.js';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Re-exported types for component consumers
// ---------------------------------------------------------------------------

/** Skill manifest with all attestations. Alias for SkillManifest from nip-skl/types. */
export type Skill = SkillManifest;

/** Single guardian attestation on a skill. Alias for GuardianAttestation from nip-skl/types. */
export type SkillAttestation = GuardianAttestation;

/** Attestation verification tier. Alias for VerificationTier from nip-skl/types. */
export type AttestationTier = VerificationTier;

export interface UseSkillManagerReturn {
  /** True while any async skill operation is in progress. */
  isLoading: boolean;

  /** Error message from the last failed operation, or null. */
  error: string | null;

  /**
   * Register a new skill manifest on the relay.
   *
   * @param params - Skill registration parameters
   * @returns The published manifest event ID
   */
  registerSkill: (params: SkillRegistrationParams) => Promise<string>;

  /**
   * Attest a skill (Guardian only).
   *
   * @param manifestEventId - Event ID of the manifest to attest
   * @param tier            - Attestation tier to grant
   * @param signerNsec      - Guardian's nsec
   * @returns The published attestation event ID
   */
  attestSkill: (
    manifestEventId: string,
    tier: VerificationTier,
    signerNsec: string
  ) => Promise<string>;

  /**
   * Update a skill's version.
   *
   * @param params - Version update parameters
   * @returns The new manifest event ID
   */
  updateSkillVersion: (params: SkillVersionUpdateParams) => Promise<string>;

  /**
   * Revoke a skill.
   *
   * @param manifestEventId - Event ID of the manifest to revoke
   * @param signerNsec      - Publisher's nsec
   * @param reason          - Optional reason
   * @returns The published revocation event ID
   */
  revokeSkill: (
    manifestEventId: string,
    signerNsec: string,
    reason?: string
  ) => Promise<string>;

  /**
   * List all skills published by a given pubkey.
   *
   * @param publisherPubkey - Hex pubkey of the skill publisher
   * @param relayUrl        - Relay URL to query
   * @returns Array of SkillManifest objects
   */
  listSkills: (publisherPubkey: string, relayUrl: string) => Promise<SkillManifest[]>;

  /**
   * Fetch a skill with its attestation status.
   *
   * @param scopeId  - Skill scope ID
   * @param relayUrl - Relay URL
   * @returns SkillWithAttestations object
   */
  getSkillWithAttestations: (
    scopeId: string,
    relayUrl: string
  ) => Promise<SkillWithAttestations>;

  /**
   * All skills loaded by the most recent listSkills() call.
   * Read-only state; populated by calling listSkills().
   */
  skills: SkillWithAttestations[];

  /**
   * Clear the last error.
   */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * React hook providing NIP-SKL skill lifecycle management.
 *
 * The {@link SkillManager} is created lazily on first use and reused across
 * renders via a ref. All operations update `isLoading` and `error` state
 * in the standard pattern used across Satnam v2 hooks.
 *
 * @returns UseSkillManagerReturn
 */
export function useSkillManager(): UseSkillManagerReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillWithAttestations[]>([]);

  /** Stable ref to the lazy-initialised SkillManager instance. */
  const managerRef = useRef<SkillManager | null>(null);
  /** Promise tracking the in-progress initialisation to prevent double-init. */
  const initPromiseRef = useRef<Promise<SkillManager> | null>(null);

  // ---------------------------------------------------------------------------
  // Lazy manager initialisation
  // ---------------------------------------------------------------------------

  /**
   * Get or create the SkillManager instance.
   * Safe to call concurrently — the init promise is memoised.
   */
  const getManager = useCallback(async (): Promise<SkillManager> => {
    if (managerRef.current) return managerRef.current;

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const [ceps, vault] = await Promise.all([
          getCepsClient(),
          getVault(),
        ]);
        const manager = new SkillManager(ceps, vault);
        managerRef.current = manager;
        return manager;
      })();
    }

    return initPromiseRef.current;
  }, []);

  // ---------------------------------------------------------------------------
  // Generic operation wrapper
  // ---------------------------------------------------------------------------

  /**
   * Wrap an async operation with loading/error state management.
   *
   * @internal
   */
  const withState = useCallback(
    async <T,>(operation: (manager: SkillManager) => Promise<T>): Promise<T> => {
      setIsLoading(true);
      setError(null);
      try {
        const manager = await getManager();
        return await operation(manager);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getManager]
  );

  // ---------------------------------------------------------------------------
  // Public operations
  // ---------------------------------------------------------------------------

  const registerSkill = useCallback(
    (params: SkillRegistrationParams) =>
      withState((m) => m.registerSkill(params)),
    [withState]
  );

  const attestSkill = useCallback(
    (manifestEventId: string, tier: VerificationTier, signerNsec: string) =>
      withState((m) => m.attestSkill(manifestEventId, tier, signerNsec)),
    [withState]
  );

  const updateSkillVersion = useCallback(
    (params: SkillVersionUpdateParams) =>
      withState((m) => m.updateSkillVersion(params)),
    [withState]
  );

  const revokeSkill = useCallback(
    (manifestEventId: string, signerNsec: string, reason?: string) =>
      withState((m) => m.revokeSkill(manifestEventId, signerNsec, reason)),
    [withState]
  );

  const listSkills = useCallback(
    async (publisherPubkey: string, relayUrl: string) => {
      const manifests = await withState((m) => m.listSkills(publisherPubkey, relayUrl));
      // Note: listSkills returns SkillManifest[], not SkillWithAttestations[]
      // Wrap into SkillWithAttestations shape for UI consumers
      const wrapped: SkillWithAttestations[] = manifests.map((m) => ({
        manifest: m,
        attestationResult: { valid: false, reason: 'not verified' },
        attestations: m.attestations ?? [],
      }));
      setSkills(wrapped);
      return manifests;
    },
    [withState]
  );

  const getSkillWithAttestations = useCallback(
    (scopeId: string, relayUrl: string) =>
      withState((m) => m.getSkillWithAttestations(scopeId, relayUrl)),
    [withState]
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      isLoading,
      error,
      skills,
      registerSkill,
      attestSkill,
      updateSkillVersion,
      revokeSkill,
      listSkills,
      getSkillWithAttestations,
      clearError,
    }),
    [
      isLoading,
      error,
      skills,
      registerSkill,
      attestSkill,
      updateSkillVersion,
      revokeSkill,
      listSkills,
      getSkillWithAttestations,
      clearError,
    ]
  );
}



