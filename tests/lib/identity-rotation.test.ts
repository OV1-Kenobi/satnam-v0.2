/**
 * CR-H — key rotation / succession tests.
 *
 * Plan acceptance coverage: succession event signed by the OLD key names the
 * successor; self-rotation and malformed keys rejected; deprecation record
 * captures old→new with event id; contact/relay lists rebuild under the NEW
 * key. Server pointer-move is exercised via action-routed contract below.
 */
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import {
  buildRotationRequestBody,
  buildSuccessionEvent,
  createDeprecationRecord,
  rebuildContactList,
  rebuildRelayList,
  SUCCESSION_KIND,
} from '../../src/lib/identity/rotation';

const OLD_SECRET = generateSecretKey();
const NEW_SECRET = generateSecretKey();
const oldHex = getPublicKey(OLD_SECRET);
const newHex = getPublicKey(NEW_SECRET);

describe('CR-H succession event', () => {
  it('is signed by the OLD key, kind 13, naming the successor in p tag + content', () => {
    const { event, oldPubkeyHex } = buildSuccessionEvent({
      oldSecret: OLD_SECRET,
      successorPubkeyHex: newHex,
      reason: 'upgrade',
    });
    expect(event.kind).toBe(SUCCESSION_KIND);
    expect(oldPubkeyHex).toBe(oldHex);
    expect(event.pubkey).toBe(oldHex);
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual(['p', newHex]);
    expect(event.tags).toContainEqual(['claim', 'upgrade']);
    const content = JSON.parse(event.content) as { successor: string };
    expect(content.successor).toBe(newHex);
  });

  it('rejects self-rotation', () => {
    expect(() =>
      buildSuccessionEvent({ oldSecret: OLD_SECRET, successorPubkeyHex: oldHex }),
    ).toThrow(/must differ/);
  });

  it('rejects malformed successor keys', () => {
    expect(() =>
      buildSuccessionEvent({ oldSecret: OLD_SECRET, successorPubkeyHex: 'nothex' }),
    ).toThrow(/64 hex/);
  });
});

describe('CR-H deprecation record', () => {
  it('captures old → new mapping bound to the succession event id', () => {
    const { event } = buildSuccessionEvent({
      oldSecret: OLD_SECRET,
      successorPubkeyHex: newHex,
    });
    const record = createDeprecationRecord({ successionEvent: event, newPubkeyHex: newHex });
    expect(record.oldPubkeyHex).toBe(oldHex);
    expect(record.newPubkeyHex).toBe(newHex);
    expect(record.successionEventId).toBe(event.id);
    expect(record.rotatedAt).toBeUndefined();
  });
});

describe('CR-H re-publication under the new key', () => {
  it('contact list (kind:3) is signed by the NEW key carrying following set', () => {
    const following = [getPublicKey(generateSecretKey()), getPublicKey(generateSecretKey())];
    const event = rebuildContactList({ newSecret: NEW_SECRET, followingHexPubkeys: following });
    expect(event.kind).toBe(3);
    expect(event.pubkey).toBe(newHex);
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual(following);
  });

  it('relay list (kind:10002) rebuilds with write/read split under the NEW key', () => {
    const event = rebuildRelayList({
      newSecret: NEW_SECRET,
      writeRelays: ['wss://pylon.satnam.pub'],
      readRelays: ['wss://nos.lol'],
    });
    expect(event.kind).toBe(10002);
    expect(event.pubkey).toBe(newHex);
    expect(event.tags).toContainEqual(['r', 'wss://pylon.satnam.pub']);
    expect(event.tags).toContainEqual(['r', 'wss://nos.lol', 'read']);
  });

  it('rotation request body carries username/domain/successor with rotate action', () => {
    const body = buildRotationRequestBody({
      username: 'satoshi',
      domain: 'satnam.pub',
      successorPubkeyHex: newHex,
    });
    const parsed = JSON.parse(body) as Record<string, string>;
    expect(parsed['action']).toBe('rotate');
    expect(parsed['username']).toBe('satoshi');
    // address string unchanged: domain stays; only pubkey moves server-side
    expect(parsed['domain']).toBe('satnam.pub');
    expect(parsed['successor_pubkey']).toBe(newHex);
  });
});
