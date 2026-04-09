/**
 * @module circle-of-trust/trust-engine
 * @description Trust scoring engine for the Circle of Trust.
 *
 * Computes composite trust scores (0-100) from four weighted factors:
 * - meetingDepth    0-30: based on number of PoL meetings (log scale, diminishing returns)
 * - timeConsistency 0-30: based on age of relationship in days
 * - mutualContacts  0-20: based on number of shared trusted contacts
 * - financialTrust  0-20: based on successful payment history
 *
 * Multiple PoL ceremonies with the same contact at different Bitcoin block
 * heights accumulate trust depth. Geographic diversity (different locations/timestamps)
 * and time span between meetings further strengthen the relationship.
 *
 * @see circle-of-trust-spec.md — Trust Engine
 */

import type {
  TrustedContact,
  TrustScore,
  CircleOfTrustStats,
  IdentityTrustProfile,
  HandshakeLedgerEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

/** Max score for meeting depth factor (0-30) */
const MAX_MEETING_DEPTH = 30;

/** Max score for time consistency factor (0-30) */
const MAX_TIME_CONSISTENCY = 30;

/** Max score for mutual contacts factor (0-20) */
const MAX_MUTUAL_CONTACTS = 20;

/** Max score for financial trust factor (0-20) */
const MAX_FINANCIAL_TRUST = 20;

/**
 * Number of days at which time consistency reaches its maximum.
 * A relationship spanning this many days or more scores full points.
 */
const TIME_CONSISTENCY_MAX_DAYS = 365;

/**
 * Maximum number of mutual contacts at which mutualContacts factor caps.
 */
const MUTUAL_CONTACTS_CAP = 10;

/**
 * High trust threshold (score > 70) — inner ring contacts.
 */
export const HIGH_TRUST_THRESHOLD = 70;

/**
 * New contact threshold (score < 30) — outer ring contacts.
 */
export const NEW_CONTACT_THRESHOLD = 30;

// ---------------------------------------------------------------------------
// TrustEngine
// ---------------------------------------------------------------------------

/**
 * Stateless trust scoring engine.
 *
 * Methods are pure functions of the contact data and optional circle state.
 * No I/O — all persistence is handled by TrustStore.
 */
export class TrustEngine {
  constructor(
    /** All contacts in the circle (used for mutual contact calculations) */
    private readonly contacts: Map<string, TrustedContact> = new Map(),
    /** Handshake ledger for financial trust calculations */
    private readonly ledger: Map<string, HandshakeLedgerEntry[]> = new Map(),
  ) {}

  // -------------------------------------------------------------------------
  // Core scoring
  // -------------------------------------------------------------------------

  /**
   * Calculate the full trust score for a contact.
   *
   * @param contact - The contact to score
   * @param mutualContactPubkeys - Optional pre-computed set of mutual contacts
   * @returns TrustScore with composite score and factor breakdown
   */
  calculateTrustScore(
    contact: TrustedContact,
    mutualContactPubkeys?: string[],
  ): TrustScore {
    const meetingCount = contact.meetings.length;
    const timeSpanDays = this._computeTimeSpanDays(contact);
    const sharedContacts = mutualContactPubkeys?.length
      ?? this._countMutualContacts(contact.pubkey);
    const paymentScore = this._computeFinancialScore(contact.pubkey);

    const meetingDepth = this._scoreMeetingDepth(meetingCount);
    const timeConsistency = this._scoreTimeConsistency(timeSpanDays);
    const mutualContacts = this._scoreMutualContacts(sharedContacts);
    const financialTrust = paymentScore;

    const composite = Math.min(
      100,
      Math.round(meetingDepth + timeConsistency + mutualContacts + financialTrust),
    );

    return {
      meetingCount,
      timeSpanDays,
      composite,
      factors: {
        meetingDepth,
        timeConsistency,
        mutualContacts,
        financialTrust,
      },
    };
  }

  /**
   * Calculate aggregate statistics across the entire Circle of Trust.
   *
   * @returns CircleOfTrustStats with totals, averages, and tier counts
   */
  calculateCircleStats(): CircleOfTrustStats {
    const contacts = Array.from(this.contacts.values());

    if (contacts.length === 0) {
      return {
        totalContacts: 0,
        avgTrustScore: 0,
        highTrustContacts: 0,
        mediumTrustContacts: 0,
        newContacts: 0,
        totalMeetings: 0,
        oldestRelationshipDays: 0,
      };
    }

    const scores = contacts.map((c) => this.calculateTrustScore(c));
    const totalScore = scores.reduce((sum, s) => sum + s.composite, 0);
    const avgTrustScore = Math.round(totalScore / contacts.length);

    const highTrustContacts = scores.filter((s) => s.composite > HIGH_TRUST_THRESHOLD).length;
    const newContacts = scores.filter((s) => s.composite < NEW_CONTACT_THRESHOLD).length;
    const mediumTrustContacts = contacts.length - highTrustContacts - newContacts;

    const totalMeetings = contacts.reduce((sum, c) => sum + c.meetings.length, 0);

    // Oldest relationship in days
    const now = Math.floor(Date.now() / 1000);
    const oldestAddedAt = contacts.reduce(
      (oldest, c) => Math.min(oldest, c.addedAt),
      now,
    );
    const oldestRelationshipDays = Math.floor((now - oldestAddedAt) / 86400);

    return {
      totalContacts: contacts.length,
      avgTrustScore,
      highTrustContacts,
      mediumTrustContacts,
      newContacts,
      totalMeetings,
      oldestRelationshipDays,
    };
  }

  /**
   * Get the identity trust profile for a given pubkey.
   * Describes how many PoL-verified contacts can attest to this identity.
   *
   * @param pubkey - Hex pubkey to build the profile for
   * @returns IdentityTrustProfile
   */
  getIdentityProfile(pubkey: string): IdentityTrustProfile {
    // Count how many contacts in our circle have this pubkey verified
    const verifiers = Array.from(this.contacts.values()).filter(
      (c) => c.pubkey === pubkey,
    );

    // Chain depth: 1 if directly in our circle, 0 if unknown
    const chainDepth = verifiers.length > 0 ? 1 : 0;

    // Financial reputation from payment history
    const financialReputation = this._computeFinancialReputation(pubkey);

    // Attested skills — aggregated from ledger attestation entries
    const attestedSkills = this._gatherAttestedSkills(pubkey);

    const contact = this.contacts.get(pubkey);

    return {
      pubkey,
      nip05: contact?.nip05,
      verificationCount: verifiers.length,
      chainDepth,
      attestedSkills,
      financialReputation,
    };
  }

  /**
   * Validate whether a verifier pubkey can vouch for a given pubkey.
   *
   * A verifier can vouch if:
   * 1. The verifier is in our trusted contacts, AND
   * 2. The target pubkey is in the verifier's attestation history
   *    (i.e., we have seen their kind:30078 event referencing the target)
   *
   * @param pubkey - The identity to validate
   * @param verifierPubkey - The verifier to check
   * @returns true if verifier can vouch for pubkey
   */
  validateThirdParty(pubkey: string, verifierPubkey: string): boolean {
    // Verifier must be in our trusted contacts
    if (!this.contacts.has(verifierPubkey)) {
      return false;
    }

    // Check if there's a meeting or attestation entry linking verifier → pubkey
    const verifierLedger = this.ledger.get(verifierPubkey) ?? [];
    return verifierLedger.some(
      (entry) =>
        entry.type === 'attestation' &&
        entry.contactPubkey === pubkey,
    );
  }

  /**
   * Get all contacts that are mutually PoL-verified with the given pubkey.
   * Returns pubkeys of contacts that both we and the given pubkey have verified.
   *
   * @param pubkey - The contact whose shared contacts to find
   * @returns Array of shared contact pubkeys
   */
  getSharedContacts(pubkey: string): string[] {
    if (!this.contacts.has(pubkey)) {
      return [];
    }

    // For each of our other contacts, check if they appear in the target's ledger
    const targetLedger = this.ledger.get(pubkey) ?? [];
    const targetVerifiedPubkeys = new Set(
      targetLedger
        .filter((e) => e.type === 'meeting' || e.type === 'attestation')
        .map((e) => e.contactPubkey),
    );

    return Array.from(this.contacts.keys()).filter(
      (pk) => pk !== pubkey && targetVerifiedPubkeys.has(pk),
    );
  }

  /**
   * Get the chronological handshake ledger for a contact.
   *
   * @param contactPubkey - The contact to get ledger entries for
   * @returns Sorted array of HandshakeLedgerEntry (oldest first)
   */
  getHandshakeLedger(contactPubkey: string): HandshakeLedgerEntry[] {
    const entries = this.ledger.get(contactPubkey) ?? [];
    return [...entries].sort((a, b) => a.timestamp - b.timestamp);
  }

  // -------------------------------------------------------------------------
  // Scoring sub-functions
  // -------------------------------------------------------------------------

  /**
   * Score meeting depth (0-30) using a log scale for diminishing returns.
   *
   * Formula: 30 * log2(meetings + 1) / log2(MAX_MEETINGS + 1)
   * where MAX_MEETINGS = 10 (caps at full points)
   *
   * Examples:
   * - 1 meeting  → ~10 pts
   * - 2 meetings → ~15 pts
   * - 3 meetings → ~19 pts
   * - 5 meetings → ~23 pts
   * - 10+ meetings → 30 pts
   */
  _scoreMeetingDepth(meetingCount: number): number {
    if (meetingCount <= 0) return 0;
    const MAX_MEETINGS = 10;
    const logScore = Math.log2(meetingCount + 1) / Math.log2(MAX_MEETINGS + 1);
    return Math.min(MAX_MEETING_DEPTH, Math.round(MAX_MEETING_DEPTH * logScore));
  }

  /**
   * Score time consistency (0-30) based on relationship age in days.
   *
   * Formula: linear up to TIME_CONSISTENCY_MAX_DAYS (365 days), then capped.
   * - 0 days  → 0 pts
   * - 30 days → ~2.5 pts
   * - 90 days → ~7 pts
   * - 180 days → ~15 pts
   * - 365+ days → 30 pts
   */
  _scoreTimeConsistency(timeSpanDays: number): number {
    if (timeSpanDays <= 0) return 0;
    const ratio = Math.min(1, timeSpanDays / TIME_CONSISTENCY_MAX_DAYS);
    return Math.round(MAX_TIME_CONSISTENCY * ratio);
  }

  /**
   * Score mutual contacts (0-20) based on number of shared trusted contacts.
   *
   * Formula: linear up to MUTUAL_CONTACTS_CAP (10 mutual contacts), then capped.
   * Each shared contact adds 2 points.
   */
  _scoreMutualContacts(sharedCount: number): number {
    if (sharedCount <= 0) return 0;
    const cappedCount = Math.min(sharedCount, MUTUAL_CONTACTS_CAP);
    return Math.round((cappedCount / MUTUAL_CONTACTS_CAP) * MAX_MUTUAL_CONTACTS);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _computeTimeSpanDays(contact: TrustedContact): number {
    if (contact.meetings.length <= 1) return 0;
    const timestamps = contact.meetings.map((m) => m.timestamp).sort();
    const first = timestamps[0];
    const last = timestamps[timestamps.length - 1];
    return Math.floor((last - first) / 86400);
  }

  private _countMutualContacts(pubkey: string): number {
    return this.getSharedContacts(pubkey).length;
  }

  private _computeFinancialScore(pubkey: string): number {
    const entries = this.ledger.get(pubkey) ?? [];
    const payments = entries.filter((e) => e.type === 'payment');

    if (payments.length === 0) return 0;

    // In a full implementation, encryptedDetails would be decrypted to check
    // success/failure. For now, we score based on count (all recorded payments
    // are assumed successful unless marked otherwise via encryptedDetails prefix).
    const successCount = payments.filter((p) => {
      if (!p.encryptedDetails) return true; // no details = assumed success
      return !p.encryptedDetails.startsWith('FAILED:');
    }).length;

    const rate = successCount / payments.length;
    // Scale to 0-20: full payment success rate → 20 pts, with volume bonus
    const volumeBonus = Math.min(5, Math.floor(payments.length / 3));
    return Math.min(MAX_FINANCIAL_TRUST, Math.round(rate * 15 + volumeBonus));
  }

  private _computeFinancialReputation(pubkey: string): number {
    const entries = this.ledger.get(pubkey) ?? [];
    const payments = entries.filter((e) => e.type === 'payment');
    if (payments.length === 0) return 0;

    const successful = payments.filter((p) =>
      !p.encryptedDetails?.startsWith('FAILED:'),
    ).length;

    return Math.round((successful / payments.length) * 100) / 100;
  }

  private _gatherAttestedSkills(_pubkey: string): string[] {
    // Skills are encoded in attestation ledger entries' encryptedDetails.
    // In a full implementation, we'd decrypt and parse these.
    // For now, return empty array — skills are populated at the UI layer
    // from kind:30078 events with skill tags.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TrustEngine pre-loaded with the provided contacts and ledger.
 */
export function createTrustEngine(
  contacts: TrustedContact[],
  ledger: Map<string, HandshakeLedgerEntry[]> = new Map(),
): TrustEngine {
  const contactMap = new Map<string, TrustedContact>(
    contacts.map((c) => [c.pubkey, c]),
  );
  return new TrustEngine(contactMap, ledger);
}


// ---------------------------------------------------------------------------
// Standalone helper — convenience wrapper around TrustEngine.calculateTrustScore
// ---------------------------------------------------------------------------

/**
 * Calculate the composite trust score for a single contact without constructing
 * a full TrustEngine. Useful for one-off calculations in components like
 * CircleOfTrustPage.
 *
 * @param contact - The TrustedContact to score
 * @returns Numeric score in range 0–100
 */
export function calculateTrustScore(contact: TrustedContact): number {
  const engine = new TrustEngine(
    new Map([[contact.pubkey, contact]]),
  );
  return engine.calculateTrustScore(contact);
}

// ---------------------------------------------------------------------------
// Standalone helpers — operate on plain arrays (no TrustEngine instance needed)
// ---------------------------------------------------------------------------

/**
 * Aggregate statistics across an array of contacts.
 *
 * Mirrors TrustEngine.calculateCircleStats() but works on a plain
 * TrustedContact[] so component tests don't need an engine instance.
 *
 * @param contacts - Array of TrustedContact objects
 * @returns CircleOfTrustStats aggregates
 */
export function calculateCircleStats(contacts: TrustedContact[]): CircleOfTrustStats {
  if (contacts.length === 0) {
    return {
      totalContacts: 0,
      avgTrustScore: 0,
      highTrustContacts: 0,
      mediumTrustContacts: 0,
      newContacts: 0,
      totalMeetings: 0,
      oldestRelationshipDays: 0,
    };
  }

  const engine = createTrustEngine(contacts);
  return engine.calculateCircleStats();
}

/**
 * Filter and sort a flat HandshakeLedgerEntry[] for a given contact pubkey.
 *
 * Returns entries matching contactPubkey, sorted descending by timestamp
 * (most recent first), which is the display order expected by the ledger UI.
 *
 * @param contactPubkey - The pubkey to filter by
 * @param entries - All HandshakeLedgerEntry records
 * @returns Filtered + sorted entries
 */
export function getHandshakeLedger(
  contactPubkey: string,
  entries: HandshakeLedgerEntry[],
): HandshakeLedgerEntry[] {
  return entries
    .filter((e) => e.contactPubkey === contactPubkey)
    .sort((a, b) => b.timestamp - a.timestamp);
}

