/**
 * @module hooks/useFrost
 * @description React hook providing access to FROST threshold signing operations.
 *
 * useFrost wraps the {@link FrostClient} with React state management, providing:
 * - `groups`: all BfProfiles stored in the OPFS Vault for this participant
 * - `createGroup`: initiate a DKG ceremony as Guardian
 * - `joinGroup`: join an existing DKG ceremony as Steward
 * - `requestGroupSignature`: publish a signing request to the coordinator relay
 * - `respondToSigning`: respond to an active signing request with a partial sig
 * - `rotateShares`: rotate FROST shares for a group
 * - `backupShare`: create a backup event for a group share
 * - `restoreShare`: restore a share from a backup event
 * - `isLoading`: true while any async operation is in progress
 * - `error`: error message from the most recent failed operation
 *
 * ## Usage
 *
 * ```tsx
 * function GroupsPage() {
 *   const {
 *     groups,
 *     createGroup,
 *     requestGroupSignature,
 *     isLoading,
 *     error,
 *   } = useFrost();
 *
 *   const handleCreate = async () => {
 *     await createGroup({
 *       name: 'Family Safe',
 *       threshold: 2,
 *       participants: [guardianPubkey, stewardPubkey],
 *       guardianNsec: myNsec,
 *     });
 *   };
 *
 *   return (
 *     <div>
 *       {isLoading && <Spinner />}
 *       {error && <ErrorBanner message={error} />}
 *       {groups.map((g) => <GroupCard key={g.groupPubkey} profile={g} />)}
 *       <button onClick={handleCreate}>Create Group</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * ## Security
 *
 * - The hook never holds key material in React state.
 * - All secret operations are delegated to FrostClient, which reads from the
 *   OPFS Vault. The Vault must be unlocked (via useVault) before calling any
 *   operation that requires a bfshare.
 * - Error messages are sanitized — no key material appears in the `error` state.
 *
 * @see src/lib/frost/client.ts — FrostClient implementation
 * @see src/hooks/useVault.tsx — Vault unlock hook
 * @see SPECIFICATION.md §4.3 — FROST Threshold Signatures
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getVault } from '../lib/vault/vault.js';
import { FrostClient } from '../lib/frost/client.js';
import {
  type BfProfile,
  type BfOnboard,
  type SigningSession,
  type UnsignedNostrEvent,
  type NostrEvent,
  type FrostConfig,
  DEFAULT_FROST_CONFIG,
  FrostError,
} from '../lib/frost/types.js';

// ---------------------------------------------------------------------------
// Context Value Type
// ---------------------------------------------------------------------------

/**
 * The value provided by {@link FrostProvider} and consumed by {@link useFrost}.
 */
export interface FrostState {
  /**
   * All FROST groups this participant belongs to.
   * Populated from OPFS Vault on mount and after each group operation.
   * Empty array if the vault is locked or no groups are registered.
   */
  groups: BfProfile[];

  /**
   * Create a new FROST group (Guardian only).
   *
   * Initiates a full DKG ceremony and stores the resulting bfprofile and
   * bfshare in the OPFS Vault. Other participants are invited via the
   * coordinator relay.
   *
   * @param params - Group creation parameters
   * @returns The BfProfile for the new group
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  createGroup: (params: {
    name: string;
    description?: string;
    threshold: number;
    participants: string[];
    guardianNsec: string;
  }) => Promise<BfProfile>;

  /**
   * Join an existing FROST group (Steward/participant).
   *
   * Processes the onboarding invitation, participates in the DKG ceremony,
   * and stores the resulting bfprofile and bfshare in the vault.
   *
   * @param invitation - The BfOnboard invitation from the Guardian
   * @param participantNsec - Hex-encoded participant secret key
   * @returns The BfProfile for the joined group
   */
  joinGroup: (invitation: BfOnboard, participantNsec: string) => Promise<BfProfile>;

  /**
   * Request a group signing ceremony for an unsigned Nostr event.
   *
   * Publishes a signing request to the coordinator relay and returns the
   * session immediately. Other threshold participants respond asynchronously.
   * Monitor the session via the signing session state.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param unsignedEvent - The event to sign
   * @returns The SigningSession in `request_published` or `collecting_partial_sigs` state
   */
  requestGroupSignature: (
    groupPubkey: string,
    unsignedEvent: UnsignedNostrEvent,
  ) => Promise<SigningSession>;

  /**
   * Respond to an active signing request with this participant's partial signature.
   *
   * Called when a signing request event (kind 20100) is received from the
   * coordinator relay and this participant is a threshold signer.
   *
   * @param sessionId - Signing session ID from the coordinator event
   * @param groupPubkey - Group pubkey for share lookup
   */
  respondToSigning: (sessionId: string, groupPubkey: string) => Promise<void>;

  /**
   * Sign a Nostr event using the group threshold (blocking variant).
   *
   * Waits until threshold partial signatures are collected or timeout expires.
   * For the async/non-blocking variant, use {@link requestGroupSignature}.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param unsignedEvent - The event to sign
   * @returns The 64-byte Schnorr signature as a hex string
   */
  groupSign: (groupPubkey: string, unsignedEvent: UnsignedNostrEvent) => Promise<string>;

  /**
   * Rotate FROST shares for a group without changing the group public key.
   *
   * @param groupPubkey - Hex-encoded group public key
   */
  rotateShares: (groupPubkey: string) => Promise<void>;

  /**
   * Create a backup event for a group share (kind:10000).
   *
   * Returns the unsigned event. The caller is responsible for signing it
   * with their nsec and publishing to a relay.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param userPubkey - Hex-encoded user public key
   */
  backupShare: (groupPubkey: string) => Promise<NostrEvent>;

  /**
   * Restore a bfshare from a backup event.
   *
   * @param event - The kind:10000 backup event from a relay
   * @param userNsec - Hex-encoded user secret key for NIP-44 decryption
   */
  restoreShare: (event: NostrEvent) => Promise<void>;

  /** Refresh the groups list from the vault. */
  refreshGroups: () => Promise<void>;

  /**
   * True while any async FROST operation is in progress.
   * Use to show loading indicators.
   */
  isLoading: boolean;

  /**
   * Error message from the most recent failed operation.
   * null if no error has occurred or the error has been cleared.
   * Set to null by calling {@link clearError} or starting a new operation.
   */
  error: string | null;

  /** Clear the current error state. */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const FrostContext = createContext<FrostState | null>(null);
FrostContext.displayName = 'FrostContext';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface FrostProviderProps {
  children: React.ReactNode;

  /**
   * Optional FrostConfig override.
   * If not provided, uses DEFAULT_FROST_CONFIG.
   */
  config?: Partial<FrostConfig>;
}

/**
 * FrostProvider — wraps the app (or subtree) with FROST context.
 *
 * Mount inside VaultProvider to ensure vault access is available.
 *
 * ```tsx
 * <VaultProvider>
 *   <FrostProvider>
 *     <App />
 *   </FrostProvider>
 * </VaultProvider>
 * ```
 */
export function FrostProvider({ children, config }: FrostProviderProps) {
  const [groups, setGroups] = useState<BfProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable FrostClient reference — created once on mount
  const clientRef = useRef<FrostClient | null>(null);

  function getClient(): FrostClient {
    if (!clientRef.current) {
      const vault = getVault();
      const mergedConfig: FrostConfig = { ...DEFAULT_FROST_CONFIG, ...config };
      clientRef.current = new FrostClient(vault, mergedConfig);
    }
    return clientRef.current;
  }

  // ---------------------------------------------------------------------------
  // Error helper
  // ---------------------------------------------------------------------------

  function extractErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      // Sanitize: only surface the error variant name for known FROST/Vault errors
      // to prevent key material from appearing in the UI
      if (Object.values(FrostError).includes(err.message as FrostError)) {
        return err.message;
      }
      // Generic error — surface message but avoid exposing internal paths
      const safeMessage = err.message.replace(/\/home\/[^:]+:/g, '').replace(/at .+/g, '').trim();
      return safeMessage || 'An unexpected error occurred';
    }
    return 'An unexpected error occurred';
  }

  // ---------------------------------------------------------------------------
  // Groups Refresh
  // ---------------------------------------------------------------------------

  const refreshGroups = useCallback(async () => {
    try {
      const client = getClient();
      const updatedGroups = await client.listGroups();
      setGroups(updatedGroups);
    } catch (err) {
      // If vault is locked, groups will be empty — don't surface as an error
      const message = extractErrorMessage(err);
      if (!message.includes('VaultLocked')) {
        setError(message);
      }
      setGroups([]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load groups on mount
  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * Wrap an async operation with loading/error state management.
   * @internal
   */
  async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
    setIsLoading(true);
    setError(null);
    try {
      const result = await operation();
      return result;
    } catch (err) {
      const message = extractErrorMessage(err);
      setError(message);
      throw err; // Re-throw so callers can handle if needed
    } finally {
      setIsLoading(false);
    }
  }

  const createGroup = useCallback(
    async (params: {
      name: string;
      description?: string;
      threshold: number;
      participants: string[];
      guardianNsec: string;
    }): Promise<BfProfile> => {
      return withLoading(async () => {
        const client = getClient();
        const profile = await client.createGroup(params);
        await refreshGroups();
        return profile;
      });
    },
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const joinGroup = useCallback(
    async (invitation: BfOnboard, participantNsec: string): Promise<BfProfile> => {
      return withLoading(async () => {
        const client = getClient();
        const profile = await client.joinGroup(invitation, participantNsec);
        await refreshGroups();
        return profile;
      });
    },
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const requestGroupSignature = useCallback(
    async (groupPubkey: string, unsignedEvent: UnsignedNostrEvent): Promise<SigningSession> => {
      return withLoading(async () => {
        const client = getClient();
        return client.requestGroupSignature(groupPubkey, unsignedEvent);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const respondToSigning = useCallback(
    async (sessionId: string, groupPubkey: string): Promise<void> => {
      return withLoading(async () => {
        const client = getClient();
        return client.respondToSigning(sessionId, groupPubkey);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const groupSign = useCallback(
    async (groupPubkey: string, unsignedEvent: UnsignedNostrEvent): Promise<string> => {
      return withLoading(async () => {
        const client = getClient();
        return client.groupSign(groupPubkey, unsignedEvent);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const rotateShares = useCallback(
    async (groupPubkey: string): Promise<void> => {
      return withLoading(async () => {
        const client = getClient();
        await client.rotateShares(groupPubkey);
        await refreshGroups();
      });
    },
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const backupShare = useCallback(
    async (groupPubkey: string): Promise<NostrEvent> => {
      return withLoading(async () => {
        const client = getClient();
        return client.backupShare(groupPubkey);
      });
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const restoreShare = useCallback(
    async (event: NostrEvent): Promise<void> => {
      return withLoading(async () => {
        const client = getClient();
        await client.restoreShare(event);
        await refreshGroups();
      });
    },
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Context Value
  // ---------------------------------------------------------------------------

  const value: FrostState = {
    groups,
    createGroup,
    joinGroup,
    requestGroupSignature,
    respondToSigning,
    groupSign,
    rotateShares,
    backupShare,
    restoreShare,
    refreshGroups,
    isLoading,
    error,
    clearError,
  };

  return (
    <FrostContext.Provider value={value}>
      {children}
    </FrostContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useFrost — access FROST threshold signing state from any component
 * inside {@link FrostProvider}.
 *
 * @example
 * ```tsx
 * function GroupCard({ profile }: { profile: BfProfile }) {
 *   const { requestGroupSignature, isLoading, error } = useFrost();
 *
 *   const handleSign = async () => {
 *     const session = await requestGroupSignature(profile.groupPubkey, unsignedEvent);
 *     console.log('Signing session:', session.sessionId);
 *   };
 *
 *   return (
 *     <div>
 *       <h2>{profile.metadata.name}</h2>
 *       <button onClick={handleSign} disabled={isLoading}>Sign</button>
 *       {error && <p className="error">{error}</p>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @throws {Error} if called outside of {@link FrostProvider}
 */
export function useFrost(): FrostState {
  const context = useContext(FrostContext);

  if (context === null) {
    throw new Error(
      'useFrost must be called inside a <FrostProvider>. ' +
        'Wrap your component tree with <FrostProvider> in App.tsx.',
    );
  }

  return context;
}

// ---------------------------------------------------------------------------
// Convenience: Direct hook without Provider (uses singleton client)
// ---------------------------------------------------------------------------

/**
 * Standalone useFrost hook that does not require a FrostProvider.
 * Uses the module-level singleton FrostClient and manages its own state.
 *
 * Prefer using FrostProvider + useFrost for app-wide state sharing.
 * Use this variant for isolated components or pages that don't need to
 * share FROST state with siblings.
 *
 * @param config - Optional FrostConfig override
 */
export function useFrostStandalone(config?: Partial<FrostConfig>): FrostState {
  const [groups, setGroups] = useState<BfProfile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<FrostClient | null>(null);

  function getClient(): FrostClient {
    if (!clientRef.current) {
      const vault = getVault();
      const mergedConfig: FrostConfig = { ...DEFAULT_FROST_CONFIG, ...config };
      clientRef.current = new FrostClient(vault, mergedConfig);
    }
    return clientRef.current;
  }

  function extractErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      if (Object.values(FrostError).includes(err.message as FrostError)) {
        return err.message;
      }
      return err.message.replace(/\/home\/[^:]+:/g, '').trim() || 'An unexpected error occurred';
    }
    return 'An unexpected error occurred';
  }

  const refreshGroups = useCallback(async () => {
    try {
      const client = getClient();
      setGroups(await client.listGroups());
    } catch {
      setGroups([]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refreshGroups();
  }, [refreshGroups]);

  async function withLoading<T>(op: () => Promise<T>): Promise<T> {
    setIsLoading(true);
    setError(null);
    try {
      return await op();
    } catch (err) {
      setError(extractErrorMessage(err));
      throw err;
    } finally {
      setIsLoading(false);
    }
  }

  const createGroup = useCallback(
    (params: Parameters<FrostState['createGroup']>[0]) =>
      withLoading(async () => {
        const p = await getClient().createGroup(params);
        await refreshGroups();
        return p;
      }),
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const joinGroup = useCallback(
    (inv: BfOnboard, nsec: string) =>
      withLoading(async () => {
        const p = await getClient().joinGroup(inv, nsec);
        await refreshGroups();
        return p;
      }),
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const requestGroupSignature = useCallback(
    (gp: string, ue: UnsignedNostrEvent) =>
      withLoading(() => getClient().requestGroupSignature(gp, ue)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const respondToSigning = useCallback(
    (sid: string, gp: string) => withLoading(() => getClient().respondToSigning(sid, gp)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const groupSign = useCallback(
    (gp: string, ue: UnsignedNostrEvent) => withLoading(() => getClient().groupSign(gp, ue)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const rotateShares = useCallback(
    (gp: string) =>
      withLoading(async () => {
        await getClient().rotateShares(gp);
        await refreshGroups();
      }),
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const backupShare = useCallback(
    (gp: string) => withLoading(() => getClient().backupShare(gp)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const restoreShare = useCallback(
    (event: NostrEvent) =>
      withLoading(async () => {
        await getClient().restoreShare(event);
        await refreshGroups();
      }),
    [refreshGroups], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    groups,
    createGroup,
    joinGroup,
    requestGroupSignature,
    respondToSigning,
    groupSign,
    rotateShares,
    backupShare,
    restoreShare,
    refreshGroups,
    isLoading,
    error,
    clearError,
  };
}
