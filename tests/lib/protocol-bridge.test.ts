/**
 * @file protocol-bridge.test.ts
 * @description Unit tests for the Satnam v2 ProtocolBridge.
 *
 * Tests cover:
 * 1.  detectPeerProtocol: peer without kind:443 → 'nip17'
 * 2.  detectPeerProtocol: peer with valid kind:443 → 'mls'
 * 3.  detectPeerProtocol: kind:443 without MLS protocol tag → 'nip17'
 * 4.  detectPeerProtocol: relay query failure → 'nip17' (graceful fallback)
 * 5.  negotiateProtocol: no MLS support → NIP-17
 * 6.  negotiateProtocol: peer has MLS but local does not → NIP-17 fallback
 * 7.  negotiateProtocol: both have MLS → MLS (Phase 2 ready)
 * 8.  publishKeyPackage: publishes kind:443 event
 * 9.  publishKeyPackage: updates local protocol status
 * 10. publishKeyPackage: contains protocol tag 'mls-1.0'
 * 11. publishKeyPackage: expiration tag 30 days in future
 * 12. publishKeyPackage: cipher_suite tag present
 * 13. wrapMessage: NIP-17 → calls sendGiftwrappedMessageWithCeps
 * 14. wrapMessage: MLS → falls back to NIP-17 (Phase 1)
 * 15. unwrapMessage: kind:1059 → nip17 protocol
 * 16. unwrapMessage: kind:443 → null (not a message)
 * 17. unwrapMessage: unknown kind → null
 * 18. getProtocolStatus: default status
 * 19. getProtocolStatus: after publishKeyPackage
 * 20. getPeerKeyPackage: parses KeyPackage from event
 * 21. getReplyProtocol: mirrors incoming protocol
 * 22. MLS types: isKeyPackageEvent helper
 * 23. MLS types: extractCiphersuite helper
 * 24. MLS types: extractClientName helper
 * 25. Backward compatibility: getReplyProtocol(mls) → nip17 in Phase 1
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { ProtocolBridge } from '../../src/lib/messaging/protocol-bridge.js';
import {
  KIND_MLS_KEY_PACKAGE,
  MARMOT_PROTOCOL_VERSION,
  isKeyPackageEvent,
  extractCiphersuite,
  extractClientName,
} from '../../src/lib/messaging/mls-types.js';

import type { KeyPackageEvent } from '../../src/lib/messaging/mls-types.js';

// ============================================================================
// Hoisted mock variables — vi.hoisted() runs before vi.mock() factories
// ============================================================================

const {
  mockSendGiftwrapped,
  mockPublishEvent,
  mockSignEvent,
  mockListEvents,
} = vi.hoisted(() => ({
  mockSendGiftwrapped: vi.fn().mockResolvedValue('gift-wrap-event-id'),
  mockPublishEvent: vi.fn().mockResolvedValue('published-event-id'),
  mockSignEvent: vi.fn().mockImplementation(async (e: any) => ({
    ...e,
    id: 'signed-event-id',
    sig: 'mock-sig',
  })),
  mockListEvents: vi.fn().mockResolvedValue([]),
}));

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/lib/ceps/ceps-client.js', () => ({
  sendGiftwrappedMessageWithCeps: mockSendGiftwrapped,
  publishEventWithCeps: mockPublishEvent,
  signEventWithCeps: mockSignEvent,
  listEventsWithCeps: mockListEvents,
  getDefaultRelays: vi.fn().mockReturnValue(['wss://nos.lol']),
}));

// In-memory localStorage mock
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  get length() { return Object.keys(storage).length; },
});

// ============================================================================
// Test data
// ============================================================================

const LOCAL_PUBKEY = 'aaaa'.repeat(16);
const PEER_PUBKEY  = 'bbbb'.repeat(16);

const NOW = Math.floor(Date.now() / 1000);

/** A valid kind:443 event as CEPS would return it */
function makeKeyPackageEvent(overrides: Partial<KeyPackageEvent & { id: string; pubkey: string }> = {}): any {
  return {
    id: 'kp-event-id',
    pubkey: PEER_PUBKEY,
    kind: KIND_MLS_KEY_PACKAGE,
    created_at: NOW,
    content: btoa('stub-key-package-tlv'),
    tags: [
      ['protocol', MARMOT_PROTOCOL_VERSION],
      ['cipher_suite', '1'],
      ['client', 'white-noise'],
      ['expiration', String(NOW + 30 * 24 * 60 * 60)],
    ],
    sig: 'mock-sig',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProtocolBridge', () => {
  let bridge: ProtocolBridge;

  beforeEach(() => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    vi.clearAllMocks();
    bridge = new ProtocolBridge(LOCAL_PUBKEY, ['wss://nos.lol']);
  });

  // --------------------------------------------------------------------------
  // detectPeerProtocol
  // --------------------------------------------------------------------------

  describe('detectPeerProtocol', () => {
    it('returns nip17 when peer has no kind:443 events', async () => {
      mockListEvents.mockResolvedValueOnce([]);
      const protocol = await bridge.detectPeerProtocol(PEER_PUBKEY);
      expect(protocol).toBe('nip17');
    });

    it('returns mls when peer has a valid kind:443 with mls-1.0 tag', async () => {
      mockListEvents.mockResolvedValueOnce([makeKeyPackageEvent()]);
      const protocol = await bridge.detectPeerProtocol(PEER_PUBKEY);
      expect(protocol).toBe('mls');
    });

    it('returns nip17 when kind:443 lacks mls-1.0 protocol tag', async () => {
      const event = makeKeyPackageEvent({
        tags: [
          ['protocol', 'unknown-protocol'],
          ['cipher_suite', '1'],
        ],
      } as any);
      mockListEvents.mockResolvedValueOnce([event]);
      const protocol = await bridge.detectPeerProtocol(PEER_PUBKEY);
      expect(protocol).toBe('nip17');
    });

    it('returns nip17 gracefully on relay query failure', async () => {
      mockListEvents.mockRejectedValueOnce(new Error('Relay timeout'));
      const protocol = await bridge.detectPeerProtocol(PEER_PUBKEY);
      expect(protocol).toBe('nip17');
    });

    it('queries relays with kind:443 filter', async () => {
      await bridge.detectPeerProtocol(PEER_PUBKEY);
      expect(mockListEvents).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            kinds: [KIND_MLS_KEY_PACKAGE],
            authors: [PEER_PUBKEY],
          }),
        ]),
        expect.any(Array),
        expect.objectContaining({ eoseTimeout: 3000 }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // negotiateProtocol
  // --------------------------------------------------------------------------

  describe('negotiateProtocol', () => {
    it('returns nip17 when peer has no MLS', async () => {
      mockListEvents.mockResolvedValueOnce([]);
      const result = await bridge.negotiateProtocol(PEER_PUBKEY);
      expect(result.protocol).toBe('nip17');
      expect(result.isFallback).toBe(false);
    });

    it('returns nip17 fallback when peer has MLS but local does not', async () => {
      // Peer has MLS
      mockListEvents.mockResolvedValueOnce([makeKeyPackageEvent()]);
      const result = await bridge.negotiateProtocol(PEER_PUBKEY);
      // Phase 1: local doesn't have MLS active → fallback
      expect(result.protocol).toBe('nip17');
      expect(result.isFallback).toBe(true);
      expect(result.reason).toContain('fallback');
    });

    it('returns mls when both have MLS and local has published KeyPackage', async () => {
      // Simulate local having published a KeyPackage and MLS active
      storage['satnam:protocol:status:v2'] = JSON.stringify({
        localProtocol: 'mls',
        hasPublishedKeyPackage: true,
        keyPackageEventId: 'local-kp-id',
        supportedProtocols: ['nip17', 'mls'],
      });

      // Peer has MLS
      mockListEvents.mockResolvedValueOnce([makeKeyPackageEvent()]);
      const result = await bridge.negotiateProtocol(PEER_PUBKEY);
      expect(result.protocol).toBe('mls');
      expect(result.isFallback).toBe(false);
      expect(result.mlsKeyPackageEventId).toBe('local-kp-id');
    });
  });

  // --------------------------------------------------------------------------
  // publishKeyPackage
  // --------------------------------------------------------------------------

  describe('publishKeyPackage', () => {
    it('publishes a kind:443 event', async () => {
      await bridge.publishKeyPackage();
      expect(mockSignEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: KIND_MLS_KEY_PACKAGE }),
      );
      expect(mockPublishEvent).toHaveBeenCalled();
    });

    it('updates local protocol status after publishing', async () => {
      await bridge.publishKeyPackage();
      const status = bridge.getProtocolStatus();
      expect(status.hasPublishedKeyPackage).toBe(true);
    });

    it('event has protocol tag mls-1.0', async () => {
      await bridge.publishKeyPackage();
      const call = mockSignEvent.mock.calls[0][0];
      const protocolTag = call.tags.find((t: string[]) => t[0] === 'protocol');
      expect(protocolTag?.[1]).toBe(MARMOT_PROTOCOL_VERSION);
    });

    it('event has expiration tag 30 days in future', async () => {
      await bridge.publishKeyPackage();
      const call = mockSignEvent.mock.calls[0][0];
      const expirationTag = call.tags.find((t: string[]) => t[0] === 'expiration');
      const expiration = parseInt(expirationTag?.[1] ?? '0', 10);
      const expectedMin = NOW + 29 * 24 * 60 * 60;
      const expectedMax = NOW + 31 * 24 * 60 * 60;
      expect(expiration).toBeGreaterThan(expectedMin);
      expect(expiration).toBeLessThan(expectedMax);
    });

    it('event has cipher_suite tag', async () => {
      await bridge.publishKeyPackage(0x0001);
      const call = mockSignEvent.mock.calls[0][0];
      const csTag = call.tags.find((t: string[]) => t[0] === 'cipher_suite');
      expect(csTag?.[1]).toBe('1');
    });

    it('returns KeyPackage with correct fields', async () => {
      const kp = await bridge.publishKeyPackage();
      expect(kp.authorPubkey).toBe(LOCAL_PUBKEY);
      expect(kp.protocol).toBe(MARMOT_PROTOCOL_VERSION);
      expect(kp.client).toBe('satnam-v2');
      expect(kp.notAfter).toBeGreaterThan(kp.notBefore);
    });

    it('works with different ciphersuites', async () => {
      const kp = await bridge.publishKeyPackage(0x0007);
      expect(kp.ciphersuite).toBe(0x0007);
      const call = mockSignEvent.mock.calls[0][0];
      const csTag = call.tags.find((t: string[]) => t[0] === 'cipher_suite');
      expect(csTag?.[1]).toBe('7');
    });
  });

  // --------------------------------------------------------------------------
  // wrapMessage
  // --------------------------------------------------------------------------

  describe('wrapMessage', () => {
    it('NIP-17: calls sendGiftwrappedMessageWithCeps', async () => {
      const id = await bridge.wrapMessage('hello', PEER_PUBKEY, 'nip17');
      expect(mockSendGiftwrapped).toHaveBeenCalledWith(PEER_PUBKEY, 'hello');
      expect(id).toBe('gift-wrap-event-id');
    });

    it('MLS: falls back to NIP-17 in Phase 1', async () => {
      // Should not throw, just warn and use NIP-17
      const id = await bridge.wrapMessage('hello', PEER_PUBKEY, 'mls');
      expect(mockSendGiftwrapped).toHaveBeenCalledWith(PEER_PUBKEY, 'hello');
      expect(id).toBe('gift-wrap-event-id');
    });

    it('defaults to nip17 protocol', async () => {
      await bridge.wrapMessage('hello', PEER_PUBKEY);
      expect(mockSendGiftwrapped).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // unwrapMessage
  // --------------------------------------------------------------------------

  describe('unwrapMessage', () => {
    it('kind:1059 returns nip17 protocol with content', async () => {
      const event = {
        kind: 1059,
        content: 'decrypted content',
        tags: [],
      };
      const result = await bridge.unwrapMessage(event);
      expect(result).not.toBeNull();
      expect(result?.protocol).toBe('nip17');
      expect(result?.content).toBe('decrypted content');
    });

    it('kind:443 returns null (KeyPackage, not a message)', async () => {
      const event = {
        kind: 443,
        content: 'key-package-bytes',
        tags: [],
      };
      const result = await bridge.unwrapMessage(event);
      expect(result).toBeNull();
    });

    it('unknown kind returns null', async () => {
      const event = {
        kind: 1,
        content: 'public note',
        tags: [],
      };
      const result = await bridge.unwrapMessage(event);
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // getProtocolStatus
  // --------------------------------------------------------------------------

  describe('getProtocolStatus', () => {
    it('returns default status without any storage', () => {
      const status = bridge.getProtocolStatus();
      expect(status.localProtocol).toBe('nip17');
      expect(status.hasPublishedKeyPackage).toBe(false);
      expect(status.supportedProtocols).toContain('nip17');
    });

    it('returns stored status after publishKeyPackage', async () => {
      await bridge.publishKeyPackage();
      const status = bridge.getProtocolStatus();
      expect(status.hasPublishedKeyPackage).toBe(true);
      expect(status.keyPackageEventId).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // getPeerKeyPackage
  // --------------------------------------------------------------------------

  describe('getPeerKeyPackage', () => {
    it('returns undefined when peer has no KeyPackage', async () => {
      mockListEvents.mockResolvedValueOnce([]);
      const kp = await bridge.getPeerKeyPackage(PEER_PUBKEY);
      expect(kp).toBeUndefined();
    });

    it('parses KeyPackage fields from kind:443 event', async () => {
      mockListEvents.mockResolvedValueOnce([makeKeyPackageEvent()]);
      const kp = await bridge.getPeerKeyPackage(PEER_PUBKEY);

      expect(kp).toBeDefined();
      expect(kp?.authorPubkey).toBe(PEER_PUBKEY);
      expect(kp?.protocol).toBe(MARMOT_PROTOCOL_VERSION);
      expect(kp?.ciphersuite).toBe(1);
      expect(kp?.client).toBe('white-noise');
      expect(kp?.eventId).toBe('kp-event-id');
    });

    it('returns undefined on relay failure', async () => {
      mockListEvents.mockRejectedValueOnce(new Error('Timeout'));
      const kp = await bridge.getPeerKeyPackage(PEER_PUBKEY);
      expect(kp).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // getReplyProtocol / backward compat
  // --------------------------------------------------------------------------

  describe('getReplyProtocol', () => {
    it('mirrors nip17 → nip17', () => {
      expect(bridge.getReplyProtocol('nip17')).toBe('nip17');
    });

    it('MLS incoming → nip17 reply in Phase 1 (backward compat)', () => {
      // In Phase 1 we can't do MLS, so reply in NIP-17
      expect(bridge.getReplyProtocol('mls')).toBe('nip17');
    });
  });
});

// ============================================================================
// MLS Types helpers
// ============================================================================

describe('MLS type utilities', () => {
  it('isKeyPackageEvent: true for kind:443', () => {
    expect(isKeyPackageEvent({ kind: 443 })).toBe(true);
  });

  it('isKeyPackageEvent: false for other kinds', () => {
    expect(isKeyPackageEvent({ kind: 1 })).toBe(false);
    expect(isKeyPackageEvent({ kind: 1059 })).toBe(false);
    expect(isKeyPackageEvent({ kind: 0 })).toBe(false);
  });

  it('extractCiphersuite: parses cipher_suite tag', () => {
    const tags = [['cipher_suite', '1']];
    expect(extractCiphersuite(tags)).toBe(1);
  });

  it('extractCiphersuite: returns undefined for missing tag', () => {
    expect(extractCiphersuite([['p', 'abc']])).toBeUndefined();
  });

  it('extractCiphersuite: handles ciphersuite 7', () => {
    const tags = [['cipher_suite', '7']];
    expect(extractCiphersuite(tags)).toBe(7);
  });

  it('extractClientName: parses client tag', () => {
    const tags = [['client', 'white-noise']];
    expect(extractClientName(tags)).toBe('white-noise');
  });

  it('extractClientName: returns undefined for missing tag', () => {
    expect(extractClientName([['p', 'abc']])).toBeUndefined();
  });

  it('KIND_MLS_KEY_PACKAGE: is 443', () => {
    expect(KIND_MLS_KEY_PACKAGE).toBe(443);
  });

  it('MARMOT_PROTOCOL_VERSION: is mls-1.0', () => {
    expect(MARMOT_PROTOCOL_VERSION).toBe('mls-1.0');
  });
});
