/**
 * @module circle-of-trust
 * @description Circle of Trust — face-to-face verified contact management.
 *
 * Barrel export for all Circle of Trust types, engine, and store.
 *
 * Usage:
 * ```ts
 * import type { TrustedContact, TrustScore } from './lib/circle-of-trust/index.js';
 * import { TrustEngine, TrustStore, createTrustEngine, createTrustStore } from './lib/circle-of-trust/index.js';
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  TrustedContact,
  MeetingProof,
  TrustScore,
  CircleOfTrustStats,
  IdentityTrustProfile,
  HandshakeLedgerEntry,
  ContactStorageBlob,
} from './types.js';

// ── Trust Engine ───────────────────────────────────────────────────────────
export {
  TrustEngine,
  createTrustEngine,
  HIGH_TRUST_THRESHOLD,
  NEW_CONTACT_THRESHOLD,
} from './trust-engine.js';

// ── Trust Store ────────────────────────────────────────────────────────────
export {
  TrustStore,
  createTrustStore,
  CIRCLE_OF_TRUST_VAULT_PREFIX,
} from './trust-store.js';
