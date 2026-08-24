/**
 * @module messaging/gift-wrap
 * @description CR-C — true NIP-17/NIP-59 private message transport.
 *
 * Pipeline (NIP-17 §Rumor → NIP-59 §Seal/Wrap):
 *   kind:14 rumor  (plaintext chat message, unsigned)
 *   → kind:13 seal (NIP-44 encrypted rumor under the SENDER's conversation
 *     key with itself, RANDOMIZED timestamps)
 *   → kind:1059 wrap (NIP-44 encrypted seal under a FRESH CSPRNG ephemeral
 *     key per wrap, zeroed after use — never reused, never logged).
 *
 * The wrap's `p` tag names the RECIPIENT pubkey (the only metadata a relay
 * sees). Sender identity, subject, and content are invisible to relays.
 *
 * Replaces the NIP-04 (kind:4) body previously used by CEPS send paths
 * (grep-proven removal; see tests/messaging/gift-wrap.test.ts).
 */

import { nip19, nip44 } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type EventTemplate,
} from 'nostr-tools';

// ---------------------------------------------------------------------------
// Timestamp randomization (NIP-59: defeat time-analysis of seals)
// ---------------------------------------------------------------------------

/** Seal created_at = real time minus a CSPRNG offset within this window. */
const SEAL_TIME_DRIFT_SECONDS = 60;

function randomizedTimestamp(nowSeconds: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const drift = (buf[0] ?? 0) % SEAL_TIME_DRIFT_SECONDS;
  return Math.max(0, nowSeconds - drift);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Accept npub or 64-hex; return lowercase hex pubkey. */
export function toHexPubkey(pubkeyOrNpub: string): string {
  if (/^[0-9a-f]{64}$/.test(pubkeyOrNpub)) return pubkeyOrNpub.toLowerCase();
  const decoded = nip19.decode(pubkeyOrNpub);
  if (decoded.type !== 'npub') throw new Error('gift-wrap: expected npub or hex pubkey');
  return decoded.data as string;
}

function hexPubkeyOfSecret(secret: Uint8Array): string {
  return getPublicKey(secret);
}

export interface RumorContent {
  readonly kind: 14;
  readonly content: string;
  readonly tags: string[][];
  readonly created_at: number;
  readonly pubkey: string;
}

export interface SignedEventLike {
  readonly id: string;
  readonly sig: string;
  readonly pubkey: string;
  readonly kind: number;
  readonly tags: string[][];
  readonly content: string;
  readonly created_at: number;
}

/** Build the unsigned kind:14 chat rumor (NIP-17). */
export function buildChatRumor(params: {
  senderPubkeyHex: string;
  recipientPubkeyHex: string;
  plaintext: string;
  subject?: string;
  now?: number;
}): RumorContent {
  const tags: string[][] = [['p', params.recipientPubkeyHex]];
  if (params.subject) tags.push(['subject', params.subject]);
  return {
    kind: 14,
    content: params.plaintext,
    tags,
    created_at: params.now ?? Math.floor(Date.now() / 1000),
    pubkey: params.senderPubkeyHex,
  };
}

// ---------------------------------------------------------------------------
// Seal + Wrap primitives
// ---------------------------------------------------------------------------

/**
 * Seal a rumor into a signed kind:13 event: NIP-44 encrypt the rumor JSON
 * under the SENDER↔RECIPIENT conversation key (so exactly the recipient can
 * unseal it after unwrapping); randomize the timestamp per NIP-59.
 */
export function sealRumor(params: {
  senderSecret: Uint8Array;
  rumor: RumorContent;
  recipientPubkeyHex: string;
  now?: number;
}): SignedEventLike {
  const ck = nip44.v2.utils.getConversationKey(
    params.senderSecret,
    params.recipientPubkeyHex,
  );
  const ciphertext = nip44.v2.encrypt(JSON.stringify(params.rumor), ck);
  const template: EventTemplate = {
    kind: 13,
    created_at: randomizedTimestamp(params.now ?? Math.floor(Date.now() / 1000)),
    tags: [],
    content: ciphertext,
  };
  return finalizeEvent(template, params.senderSecret);
}

/**
 * Wrap a sealed event into an anonymous kind:1059 gift wrap addressed to the
 * recipient. Ephemeral signing key is FRESH per call and zeroed in finally.
 */
export function giftWrapSeal(params: {
  sealJson: string;
  recipientPubkeyHex: string;
  now?: number;
}): { event: SignedEventLike } {
  const ephemeralSecret = generateSecretKey();
  try {
    const ck = nip44.v2.utils.getConversationKey(ephemeralSecret, params.recipientPubkeyHex);
    const ciphertext = nip44.v2.encrypt(params.sealJson, ck);
    const template: EventTemplate = {
      kind: 1059,
      created_at: params.now ?? Math.floor(Date.now() / 1000),
      tags: [['p', params.recipientPubkeyHex]],
      content: ciphertext,
    };
    return { event: finalizeEvent(template, ephemeralSecret) };
  } finally {
    ephemeralSecret.fill(0);
  }
}

export interface GiftWrapResult {
  event: SignedEventLike;
  rumorKind: 14;
  sealKind: 13;
  wrapKind: 1059;
}

/**
 * One typed send API (CR-C): rumor → seal → wrap.
 * Returns the kind:1059 event ready for publication via CEPS.
 * With noteToSelf, both p tags and the wrap key target the sender's npub.
 */
export function createGiftWrap(params: {
  senderSecret: Uint8Array;
  recipientNpubOrHex: string;
  plaintext: string;
  subject?: string;
  noteToSelf?: boolean;
  now?: number;
}): GiftWrapResult {
  const senderPubkeyHex = hexPubkeyOfSecret(params.senderSecret);
  const recipientPubkeyHex = params.noteToSelf
    ? senderPubkeyHex
    : toHexPubkey(params.recipientNpubOrHex);

  const rumor = buildChatRumor({
    senderPubkeyHex,
    recipientPubkeyHex,
    plaintext: params.plaintext,
    subject: params.subject,
    now: params.now,
  });

  const seal = sealRumor({
    senderSecret: params.senderSecret,
    rumor,
    recipientPubkeyHex,
    now: params.now,
  });
  const { event } = giftWrapSeal({
    sealJson: JSON.stringify(seal),
    recipientPubkeyHex,
    now: params.now,
  });
  return { event, rumorKind: 14, sealKind: 13, wrapKind: 1059 };
}

// ---------------------------------------------------------------------------
// Unwrap / Unseal (recipient + self-side reads; used by receive paths & tests)
// ---------------------------------------------------------------------------

/**
 * Unwrap kind:1059 → kind:13 seal JSON using the recipient secret.
 * The NIP-44 conversation key pairs the recipient's secret with the WRAP'S
 * OWN pubkey (the ephemeral sender key) — not the `p` tag, which names the
 * recipient themselves.
 */
export function unwrapGiftWrap(params: {
  wrapEvent: { pubkey: string; content: string; tags?: string[][] };
  recipientSecret: Uint8Array;
}): { sealJson: string; senderPubkeyHex: string } {
  // Counterparty for ECDH = the wrap author (fresh ephemeral key per NIP-59).
  const ephemeralPubkeyHex = params.wrapEvent.pubkey;
  const ck = nip44.v2.utils.getConversationKey(params.recipientSecret, ephemeralPubkeyHex);
  return {
    sealJson: nip44.v2.decrypt(params.wrapEvent.content, ck),
    senderPubkeyHex: ephemeralPubkeyHex,
  };
}

/** Unseal kind:13 → kind:14 rumor using the seal author's secret (self-read). */
export function unsealSelfRumor(params: {
  seal: { pubkey: string; content: string };
  readerSecret: Uint8Array;
}): RumorContent {
  const ck = nip44.v2.utils.getConversationKey(params.readerSecret, params.seal.pubkey);
  return JSON.parse(nip44.v2.decrypt(params.seal.content, ck)) as RumorContent;
}

/** Recipient-side read: unwrap with recipient secret, unseal via seal pubkey. */
export function openGiftWrap(params: {
  wrapEvent: { pubkey: string; content: string };
  recipientSecret: Uint8Array;
}): { rumor: RumorContent; sealPubkeyHex: string } {
  const { sealJson } = unwrapGiftWrap({
    wrapEvent: params.wrapEvent,
    recipientSecret: params.recipientSecret,
  });
  const seal = JSON.parse(sealJson) as { pubkey: string; content: string };
  const ck = nip44.v2.utils.getConversationKey(params.recipientSecret, seal.pubkey);
  const rumor = JSON.parse(nip44.v2.decrypt(seal.content, ck)) as RumorContent;
  return { rumor, sealPubkeyHex: seal.pubkey };
}

export { bytesToHex };
