/**
 * @hook useCircleOfTrust
 * @description React hook for Circle of Trust operations.
 *
 * Provides:
 * - contacts: all trusted contacts, sorted by addedAt descending
 * - stats: aggregate CircleOfTrustStats across the circle
 * - trustScore(pubkey): compute TrustScore for a specific contact
 * - addContact(contact): add/update a trusted contact
 * - addMeetingProof(pubkey, proof): accumulate a new meeting proof
 * - handshakeLedger(pubkey): get chronological handshake history
 * - appendLedgerEntry(pubkey, entry): add an interaction to the ledger
 * - identityProfile(pubkey): how the network sees a given pubkey
 * - sharedContacts(pubkey): contacts we both have PoL-verified
 * - isLoading: true while vault operations are in flight
 *
 * All contact data is encrypted in the OPFS Vault via TrustStore.
 * TrustEngine computes scores as a pure function of stored data.
 *
 * @example
 * ```tsx
 * const { contacts, stats, trustScore, addContact } = useCircleOfTrust({ vault });
 * ```
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import {
  TrustStore,
  TrustEngine,
  createTrustStore,
  createTrustEngine,
} from '../lib/circle-of-trust/index.js';
import type {
  TrustedContact,
  MeetingProof,
  TrustScore,
  CircleOfTrustStats,
  IdentityTrustProfile,
  HandshakeLedgerEntry,
} from '../lib/circle-of-trust/index.js';
import type { VaultOps } from '../lib/vault/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseCircleOfTrustOptions {
  /** Unlocked vault instance for encrypted persistence */
  vault?: VaultOps;
  /** Auto-load contacts on mount (default: true) */
  autoLoad?: boolean;
}

interface UseCircleOfTrustReturn {
  /** All trusted contacts, sorted by addedAt descending */
  contacts: TrustedContact[];

  /** Aggregate stats across the circle */
  stats: CircleOfTrustStats;

  /**
   * Compute the trust score for a specific contact.
   * Returns null if contact is not found.
   */
  trustScore: (pubkey: string) => TrustScore | null;

  /**
   * Add or update a trusted contact in the circle.
   * Persists to vault.
   */
  addContact: (contact: TrustedContact) => Promise<void>;

  /**
   * Remove a trusted contact from the circle.
   * Persists to vault.
   */
  removeContact: (pubkey: string) => Promise<void>;

  /**
   * Accumulate a new meeting proof for an existing contact.
   * Call after each Proof of Life ceremony with the same contact.
   */
  addMeetingProof: (pubkey: string, proof: MeetingProof) => Promise<void>;

  /**
   * Get the chronological handshake ledger for a contact.
   * Returns empty array if contact has no ledger entries.
   */
  handshakeLedger: (pubkey: string) => HandshakeLedgerEntry[];

  /**
   * Append an interaction entry to the handshake ledger.
   */
  appendLedgerEntry: (pubkey: string, entry: HandshakeLedgerEntry) => Promise<void>;

  /**
   * Build the identity trust profile for a pubkey.
   * Describes how many verified contacts can attest to this identity.
   */
  identityProfile: (pubkey: string) => IdentityTrustProfile;

  /**
   * Get contacts that are mutually PoL-verified with a given pubkey.
   * Returns pubkeys of shared trusted contacts.
   */
  sharedContacts: (pubkey: string) => string[];

  /**
   * Check if a verifier can vouch for a target pubkey.
   */
  validateThirdParty: (pubkey: string, verifierPubkey: string) => boolean;

  /** True while vault operations are in flight */
  isLoading: boolean;

  /** Error message if an operation failed */
  error: string | null;

  /** Clear the current error */
  clearError: () => void;

  /** Refresh contacts from vault */
  reload: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Default empty stats
// ---------------------------------------------------------------------------

const EMPTY_STATS: CircleOfTrustStats = {
  totalContacts: 0,
  avgTrustScore: 0,
  highTrustContacts: 0,
  mediumTrustContacts: 0,
  newContacts: 0,
  totalMeetings: 0,
  oldestRelationshipDays: 0,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCircleOfTrust(
  options: UseCircleOfTrustOptions = {},
): UseCircleOfTrustReturn {
  const { vault, autoLoad = true } = options;

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [ledgerCache, setLedgerCache] = useState<Map<string, HandshakeLedgerEntry[]>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeRef = useRef<TrustStore | null>(null);
  const engineRef = useRef<TrustEngine | null>(null);

  // ── Get or create store ────────────────────────────────────────────────────

  const _getStore = useCallback((): TrustStore | null => {
    if (!vault) return null;
    if (!storeRef.current) {
      storeRef.current = createTrustStore(vault);
    }
    return storeRef.current;
  }, [vault]);

  // ── Rebuild engine from current contacts ───────────────────────────────────

  const _rebuildEngine = useCallback(
    (currentContacts: TrustedContact[], currentLedger: Map<string, HandshakeLedgerEntry[]>) => {
      engineRef.current = createTrustEngine(currentContacts, currentLedger);
    },
    [],
  );

  // ── Load contacts from vault ───────────────────────────────────────────────

  const reload = useCallback(async () => {
    const store = _getStore();
    if (!store) return;

    setIsLoading(true);
    setError(null);

    try {
      const loaded = await store.listTrustedContacts();

      // Load ledger for each contact
      const ledger = new Map<string, HandshakeLedgerEntry[]>();
      await Promise.all(
        loaded.map(async (c) => {
          const entries = await store.getHandshakeLedger(c.pubkey);
          if (entries.length > 0) {
            ledger.set(c.pubkey, entries);
          }
        }),
      );

      setContacts(loaded);
      setLedgerCache(ledger);
      _rebuildEngine(loaded, ledger);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setIsLoading(false);
    }
  }, [_getStore, _rebuildEngine]);

  // ── Auto-load on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    if (autoLoad && vault) {
      void reload();
    }
  }, [autoLoad, vault]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived engine (always up-to-date) ────────────────────────────────────

  const _getEngine = useCallback((): TrustEngine => {
    if (!engineRef.current) {
      engineRef.current = createTrustEngine(contacts, ledgerCache);
    }
    return engineRef.current;
  }, [contacts, ledgerCache]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const stats = React.useMemo((): CircleOfTrustStats => {
    if (contacts.length === 0) return EMPTY_STATS;
    return _getEngine().calculateCircleStats();
  }, [contacts, _getEngine]);

  const trustScore = useCallback(
    (pubkey: string): TrustScore | null => {
      const contact = contacts.find((c) => c.pubkey === pubkey);
      if (!contact) return null;
      return _getEngine().calculateTrustScore(contact);
    },
    [contacts, _getEngine],
  );

  const addContact = useCallback(
    async (contact: TrustedContact) => {
      const store = _getStore();
      if (!store) {
        setError('Vault not available');
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await store.addTrustedContact(contact);
        // Update local state
        setContacts((prev) => {
          const existing = prev.findIndex((c) => c.pubkey === contact.pubkey);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = contact;
            return updated;
          }
          return [contact, ...prev];
        });
        _rebuildEngine(
          contacts.some((c) => c.pubkey === contact.pubkey)
            ? contacts.map((c) => (c.pubkey === contact.pubkey ? contact : c))
            : [contact, ...contacts],
          ledgerCache,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add contact');
      } finally {
        setIsLoading(false);
      }
    },
    [_getStore, _rebuildEngine, contacts, ledgerCache],
  );

  const removeContact = useCallback(
    async (pubkey: string) => {
      const store = _getStore();
      if (!store) {
        setError('Vault not available');
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await store.removeTrustedContact(pubkey);
        const updated = contacts.filter((c) => c.pubkey !== pubkey);
        const updatedLedger = new Map(ledgerCache);
        updatedLedger.delete(pubkey);
        setContacts(updated);
        setLedgerCache(updatedLedger);
        _rebuildEngine(updated, updatedLedger);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove contact');
      } finally {
        setIsLoading(false);
      }
    },
    [_getStore, _rebuildEngine, contacts, ledgerCache],
  );

  const addMeetingProof = useCallback(
    async (pubkey: string, proof: MeetingProof) => {
      const store = _getStore();
      if (!store) {
        setError('Vault not available');
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await store.addMeetingProof(pubkey, proof);
        // Update local contact
        const updated = contacts.map((c) => {
          if (c.pubkey !== pubkey) return c;
          const meetings = [...c.meetings, proof];
          return {
            ...c,
            meetings,
            trustDepth: meetings.length,
          };
        });
        setContacts(updated);
        _rebuildEngine(updated, ledgerCache);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add meeting proof');
      } finally {
        setIsLoading(false);
      }
    },
    [_getStore, _rebuildEngine, contacts, ledgerCache],
  );

  const handshakeLedger = useCallback(
    (pubkey: string): HandshakeLedgerEntry[] => {
      return (ledgerCache.get(pubkey) ?? []).sort(
        (a, b) => a.timestamp - b.timestamp,
      );
    },
    [ledgerCache],
  );

  const appendLedgerEntry = useCallback(
    async (pubkey: string, entry: HandshakeLedgerEntry) => {
      const store = _getStore();
      if (!store) {
        setError('Vault not available');
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        await store.appendHandshakeEntry(pubkey, entry);
        const updatedLedger = new Map(ledgerCache);
        const existing = updatedLedger.get(pubkey) ?? [];
        // Deduplicate by eventId
        if (!existing.some((e) => e.eventId === entry.eventId)) {
          updatedLedger.set(pubkey, [...existing, entry]);
        }
        setLedgerCache(updatedLedger);
        _rebuildEngine(contacts, updatedLedger);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to append ledger entry');
      } finally {
        setIsLoading(false);
      }
    },
    [_getStore, _rebuildEngine, contacts, ledgerCache],
  );

  const identityProfile = useCallback(
    (pubkey: string): IdentityTrustProfile => {
      return _getEngine().getIdentityProfile(pubkey);
    },
    [_getEngine],
  );

  const sharedContacts = useCallback(
    (pubkey: string): string[] => {
      return _getEngine().getSharedContacts(pubkey);
    },
    [_getEngine],
  );

  const validateThirdParty = useCallback(
    (pubkey: string, verifierPubkey: string): boolean => {
      return _getEngine().validateThirdParty(pubkey, verifierPubkey);
    },
    [_getEngine],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    contacts,
    stats,
    trustScore,
    addContact,
    removeContact,
    addMeetingProof,
    handshakeLedger,
    appendLedgerEntry,
    identityProfile,
    sharedContacts,
    validateThirdParty,
    isLoading,
    error,
    clearError,
    reload,
  };
}

export default useCircleOfTrust;
