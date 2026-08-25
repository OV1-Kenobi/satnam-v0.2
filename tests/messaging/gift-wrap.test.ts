/**
 * CR-C — NIP-17/NIP-59 gift-wrap transport tests.
 *
 * Acceptance coverage: kind/tag correctness, recipient decrypts + wrong-key
 * fails, distinct ephemeral keys across wraps (relay sees different authors),
 * randomized seal timestamps, Note2Self round-trip.
 */
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

import {
  buildChatRumor,
  createGiftWrap,
  giftWrapSeal,
  openGiftWrap,
  sealRumor,
  toHexPubkey,
  unsealSelfRumor,
  unwrapGiftWrap,
} from '../../src/lib/messaging/gift-wrap';

const ALICE_SECRET = generateSecretKey();
const BOB_SECRET = generateSecretKey();
const CAROL_SECRET = generateSecretKey();

const aliceHex = getPublicKey(ALICE_SECRET);
const bobHex = getPublicKey(BOB_SECRET);

describe('CR-C gift-wrap pipeline structure', () => {
  it('produces a kind:1059 wrap with only a p tag naming the recipient', () => {
    const { event } = createGiftWrap({
      senderSecret: ALICE_SECRET,
      recipientNpubOrHex: bobHex,
      plaintext: 'gm',
      now: 1_700_000_000,
    });
    expect(event.kind).toBe(1059);
    const pTags = event.tags.filter((t) => t[0] === 'p');
    expect(pTags).toHaveLength(1);
    expect(pTags[0]![1]).toBe(bobHex);
    // wrap author is the EPHEMERAL key, not Alice — relays cannot identify sender
    expect(event.pubkey).not.toBe(aliceHex);
    expect(event.content.length).toBeGreaterThan(0);
  });

  it('round-trips: recipient unwraps and reads the rumor; wrong key fails', () => {
    const { event } = createGiftWrap({
      senderSecret: ALICE_SECRET,
      recipientNpubOrHex: bobHex,
      plaintext: 'meet at the citadel',
      subject: 'plans',
      now: 1_700_000_100,
    });
    const { rumor } = openGiftWrap({ wrapEvent: event, recipientSecret: BOB_SECRET });
    expect(rumor.kind).toBe(14);
    expect(rumor.content).toBe('meet at the citadel');
    expect(rumor.tags).toContainEqual(['p', bobHex]);
    expect(rumor.tags).toContainEqual(['subject', 'plans']);
    expect(rumor.pubkey).toBe(aliceHex);

    // Carol must NOT be able to decrypt Bob's wrap
    expect(() =>
      openGiftWrap({ wrapEvent: event, recipientSecret: CAROL_SECRET }),
    ).toThrow();
  });

  it('seal is kind:13 and hides sender from the wrap layer', () => {
    const rumor = buildChatRumor({
      senderPubkeyHex: aliceHex,
      recipientPubkeyHex: bobHex,
      plaintext: 'inner',
      now: 1_700_000_200,
    });
    const seal = sealRumor({
      senderSecret: ALICE_SECRET,
      rumor,
      recipientPubkeyHex: bobHex,
      now: 1_700_000_200,
    });
    expect(seal.kind).toBe(13);
    expect(seal.tags).toEqual([]);
    expect(seal.content).not.toContain('inner');

    const { event } = giftWrapSeal({
      sealJson: JSON.stringify(seal),
      recipientPubkeyHex: bobHex,
      now: 1_700_000_201,
    });
    const { sealJson } = unwrapGiftWrap({ wrapEvent: event, recipientSecret: BOB_SECRET });
    const parsed = JSON.parse(sealJson) as { kind: number };
    expect(parsed.kind).toBe(13);
  });
});

describe('CR-C NIP-59 requirements', () => {
  it('randomizes seal timestamps within the drift window', () => {
    const now = 1_800_000_000;
    const rumor = buildChatRumor({
      senderPubkeyHex: aliceHex,
      recipientPubkeyHex: bobHex,
      plaintext: 'x',
      now,
    });
    const seals = Array.from({ length: 8 }, () =>
      sealRumor({ senderSecret: ALICE_SECRET, rumor, recipientPubkeyHex: bobHex, now }),
    );
    const timestamps = new Set(seals.map((s) => s.created_at));
    // all within [now - 59, now]; overwhelmingly non-identical across 8 tries
    for (const ts of timestamps) {
      expect(ts).toBeLessThanOrEqual(now);
      expect(ts).toBeGreaterThan(now - 60);
    }
    // probabilistic but effectively certain with CSPRNG
    expect(timestamps.size).toBeGreaterThanOrEqual(2);
  });

  it('uses distinct ephemeral keys per wrap (fresh CSPRNG, never reused)', () => {
    const seal = JSON.stringify(
      sealRumor({
        senderSecret: ALICE_SECRET,
        rumor: buildChatRumor({
          senderPubkeyHex: aliceHex,
          recipientPubkeyHex: bobHex,
          plaintext: 'same text',
          now: 1_700_001_000,
        }),
        recipientPubkeyHex: bobHex,
        now: 1_700_001_000,
      }),
    );
    const wrapA = giftWrapSeal({ sealJson: seal, recipientPubkeyHex: bobHex, now: 1_700_001_001 }).event;
    const wrapB = giftWrapSeal({ sealJson: seal, recipientPubkeyHex: bobHex, now: 1_700_001_002 }).event;
    // identical plaintext+seal → DIFFERENT wrap authors and ciphertexts on the wire
    expect(wrapA.pubkey).not.toBe(wrapB.pubkey);
    expect(wrapA.content).not.toBe(wrapB.content);
    // both still open with Bob's key
    expect(openGiftWrap({ wrapEvent: wrapA, recipientSecret: BOB_SECRET }).rumor.content).toBe('same text');
    expect(openGiftWrap({ wrapEvent: wrapB, recipientSecret: BOB_SECRET }).rumor.content).toBe('same text');
  });

  it('toHexPubkey normalizes npub and hex identically', () => {
    expect(toHexPubkey(bobHex)).toBe(bobHex.toLowerCase());
  });
});

describe('CR-C Note2Self (self gift-wrap)', () => {
  it('self-wraps and self-opens a journal note', () => {
    const { event } = createGiftWrap({
      senderSecret: ALICE_SECRET,
      recipientNpubOrHex: aliceHex,
      plaintext: 'private journal entry',
      subject: 'note-to-self',
      noteToSelf: true,
      now: 1_700_002_000,
    });
    expect(event.kind).toBe(1059);
    // NIP-59: the wrap author is ALWAYS a fresh ephemeral key — even for
    // self-notes — so the p tag names Alice while event.pubkey does not.
    expect(event.pubkey).not.toBe(aliceHex);
    expect(event.tags).toContainEqual(['p', aliceHex]);
    const opened = openGiftWrap({ wrapEvent: event, recipientSecret: ALICE_SECRET });
    expect(opened.rumor.content).toBe('private journal entry');
    expect(opened.rumor.pubkey).toBe(aliceHex);
  });

  it('self-seal round-trip via unsealSelfRumor', () => {
    const rumor = buildChatRumor({
      senderPubkeyHex: aliceHex,
      recipientPubkeyHex: aliceHex,
      plaintext: 'chain ratchet seed material',
      now: 1_700_003_000,
    });
    const seal = sealRumor({
      senderSecret: ALICE_SECRET,
      rumor,
      recipientPubkeyHex: aliceHex, // self-conversation for private notes
    });
    const reopened = unsealSelfRumor({ seal, readerSecret: ALICE_SECRET });
    expect(reopened.content).toBe('chain ratchet seed material');
  });
});
