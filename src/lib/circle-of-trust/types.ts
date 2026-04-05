/**
 * @module circle-of-trust/types
 * @description Type definitions for the Circle of Trust library.
 *
 * The Circle of Trust tracks face-to-face verified contacts established through
 * the Proof of Life ceremony. Each contact has a trust score computed from
 * four factors: meeting depth, time consistency, mutual contacts, and financial trust.
 *
 * Trust accumulates over time — multiple PoL ceremonies with the same contact
 * at different Bitcoin block heights deepen the trust relationship.
 *
 * @see circle-of-trust-spec.md — Circle of Trust Library
 */

/**
 * A trusted contact in the Circle of Trust.
 * Established via one or more Proof of Life ceremonies.
 */
export interface TrustedContact {
  /** Hex-encoded Nostr pubkey of this contact */
  pubkey: string;
  /** NIP-05 identifier, if verified */
  nip05?: string;
  /** SHA-256 hash of the contact's NFC card UID */
  nfcCardHash: string;
  /** Bitcoin block height at the time of the first meeting */
  firstMeetingBlockHeight: number;
  /** All PoL ceremonies with this contact (accumulated over time) */
  meetings: MeetingProof[];
  /**
   * Trust depth = number of unique PoL ceremonies with this contact.
   * Increments with each new meeting at a different block height.
   */
  trustDepth: number;
  /** Composite trust score 0-100 (recalculated by TrustEngine) */
  trustScore: number;
  /** Event ID of the signed NIP-17 welcome message from the first meeting */
  welcomeMessageId: string;
  /** Unix timestamp (seconds) when this contact was first added */
  addedAt: number;
}

/**
 * A single Proof of Life meeting proof.
 * Each ceremony adds one entry; multiple entries = deeper trust.
 */
export interface MeetingProof {
  /** Nostr event ID of the kind:30078 attestation event */
  attestationEventId: string;
  /** Bitcoin block height at the time of this meeting */
  blockHeight: number;
  /** Unix timestamp (seconds) of this meeting */
  timestamp: number;
  /** SHA-256 of both welcome messages concatenated for this ceremony */
  welcomeMessageHash: string;
  /**
   * Optional local note (only stored locally — never published to relay).
   * May include location, context, or other personal annotations.
   */
  localNote?: string;
}

/**
 * Trust score breakdown for a contact.
 * Composite 0-100, decomposed into four factor scores.
 */
export interface TrustScore {
  /** Number of distinct PoL meetings with this contact */
  meetingCount: number;
  /** Time span from first to last meeting, in days */
  timeSpanDays: number;
  /** Composite score 0-100 */
  composite: number;
  /** Per-factor breakdown */
  factors: {
    /**
     * 0-30 points based on number of meetings.
     * Uses diminishing returns (log scale): each additional meeting adds less.
     * 1 meeting → ~10 pts, 3 → ~19 pts, 10 → ~30 pts
     */
    meetingDepth: number;
    /**
     * 0-30 points based on how long the relationship has lasted.
     * A brand-new contact scores 0; one that spans months/years scores higher.
     * Rewards long-term consistency over one-time interactions.
     */
    timeConsistency: number;
    /**
     * 0-20 points based on shared trusted contacts.
     * Contacts who share mutual PoL-verified people get a web-of-trust bonus.
     */
    mutualContacts: number;
    /**
     * 0-20 points based on financial interaction history.
     * Tracks successful payment/zap history; failed/reversed payments reduce score.
     */
    financialTrust: number;
  };
}

/**
 * Aggregate statistics across the entire Circle of Trust.
 */
export interface CircleOfTrustStats {
  /** Total number of trusted contacts */
  totalContacts: number;
  /** Average trust score across all contacts (0-100) */
  avgTrustScore: number;
  /** Number of contacts with score > 70 (high trust — inner circle) */
  highTrustContacts: number;
  /** Number of contacts with score 30-70 (medium trust — middle ring) */
  mediumTrustContacts: number;
  /** Number of contacts with score < 30 (new contacts — outer ring) */
  newContacts: number;
  /** Total number of PoL meetings across all contacts */
  totalMeetings: number;
  /** Age in days of the oldest trusted relationship */
  oldestRelationshipDays: number;
}

/**
 * Trust profile for a Nostr identity — how the network sees this identity.
 * Aggregates attestations from multiple verifiers.
 */
export interface IdentityTrustProfile {
  /** Hex-encoded Nostr pubkey */
  pubkey: string;
  /** NIP-05 identifier, if verified */
  nip05?: string;
  /** Number of distinct PoL-verified identities that have attested this pubkey */
  verificationCount: number;
  /**
   * Longest trust chain depth to well-known identities.
   * Depth 1 = directly PoL-verified by you.
   * Depth 2 = PoL-verified by someone you've PoL-verified.
   */
  chainDepth: number;
  /** Skills attested by PoL-verified contacts */
  attestedSkills: string[];
  /**
   * Financial reputation: ratio of successful payments to total (0-1).
   * Based on completed Cashu/Lightning transactions with this contact.
   */
  financialReputation: number;
}

/**
 * An entry in the handshake ledger — chronological history of all interactions
 * with a specific contact (meetings, messages, payments, attestations).
 */
export type HandshakeLedgerEntry = {
  /** Type of interaction */
  type: 'meeting' | 'message' | 'payment' | 'attestation';
  /** Hex-encoded pubkey of the contact */
  contactPubkey: string;
  /** Unix timestamp (seconds) of the interaction */
  timestamp: number;
  /** Bitcoin block height at time of interaction (for meetings/attestations) */
  blockHeight?: number;
  /** Nostr event ID associated with this interaction */
  eventId: string;
  /**
   * Encrypted details (NIP-44 encrypted, only readable by the two parties).
   * May contain amounts, notes, or other interaction-specific data.
   */
  encryptedDetails?: string;
};

/**
 * Internal storage format for contacts in the vault.
 * Contacts are grouped by the first 8 chars of their pubkey prefix.
 */
export interface ContactStorageBlob {
  /** Schema version for forward compatibility */
  version: number;
  /** Contacts keyed by pubkey */
  contacts: Record<string, TrustedContact>;
  /** Handshake ledger keyed by contact pubkey */
  ledger: Record<string, HandshakeLedgerEntry[]>;
  /** Last updated timestamp (unix seconds) */
  updatedAt: number;
}
