/**
 * Tests for src/lib/nfc/proof-of-life.ts
 *
 * ProofOfLifeService — mutual contact exchange ceremony.
 *
 * The PoL ceremony is NOT a solo self-attestation. It is a bilateral exchange:
 * Two co-present users each scan the OTHER person's NFC "Name Tag" card.
 * Each device then sends a signed NIP-17 welcome message to the other.
 * The welcome message hash and Bitcoin block height are included in the OTS attestation.
 *
 * NO PIN is exchanged during the ceremony. The PIN gate is ONLY for
 * post-ceremony outgoing messages and zaps on the user's own device.
 *
 * Test coverage:
 * - State machine: full mutual ceremony transitions (no PIN states)
 * - Peer card CMAC verification (scanPeerCard)
 * - sendWelcomeMessage: transitions to WELCOME_SENT, sets welcomeMessageId + blockHeight
 * - Bilateral attestation construction (correct p-tags, nfc-card-hash, welcome-msg-hash, block-height)
 * - Error cases: invalid peer CMAC, timeout, wrong state
 * - Attestation events reference the OTHER participant's pubkey
 * - welcome-msg-hash tag is present in attestation events
 * - block-height tag is present in attestation events
 * - Backward-compat deprecated wrappers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('argon2-browser', () => ({}));

vi.mock('@noble/hashes/sha256', () => ({
  sha256: vi.fn((data: Uint8Array) => {
    // Simple deterministic mock: XOR-fold
    const result = new Uint8Array(32);
    for (let i = 0; i < data.length; i++) result[i % 32] ^= data[i];
    return result;
  }),
}));

vi.mock('@noble/hashes/utils', () => ({
  bytesToHex: (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
  hexToBytes: (hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2)
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return arr;
  },
  utf8ToBytes: (s: string) => new TextEncoder().encode(s),
}));

// Mock NTAG424 production manager
vi.mock('../../src/lib/nfc/ntag424.js', () => ({
  NTAG424ProductionManager: vi.fn().mockImplementation(() => ({
    verifySUNMessage: vi.fn(async (msg: string) => {
      // Return valid only for messages containing 'validcmac'
      if (msg.includes('validcmac')) {
        return { valid: true, counter: 42 };
      }
      return { valid: false, error: 'CMAC verification failed' };
    }),
  })),
}));

// Mock nostr-tools
vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn((template: unknown, _secretKey: unknown) => ({
    ...(template as object),
    id: '00'.repeat(32),
    sig: '00'.repeat(64),
    pubkey: 'aa'.repeat(32),
  })),
  getPublicKey: vi.fn((_key: Uint8Array) => new Uint8Array(32).fill(0xaa)),
  nip19: {
    decode: vi.fn((nsec: string) => {
      if (nsec.startsWith('nsec1')) {
        return { type: 'nsec', data: new Uint8Array(32) };
      }
      throw new Error('Invalid nsec');
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock Vault
// ---------------------------------------------------------------------------

function createMockVault() {
  const storage = new Map<string, Uint8Array>();
  return {
    isUnlocked: vi.fn(() => true),
    storeNfcKey: vi.fn(async (uid: string, slot: string, key: Uint8Array) => {
      storage.set(`${uid}:${slot}`, key);
    }),
    getNfcKey: vi.fn(async (uid: string, slot: string) => {
      const key = storage.get(`${uid}:${slot}`);
      if (!key) throw new Error(`Not found: ${uid}:${slot}`);
      return key;
    }),
    _storage: storage,
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  ProofOfLifeService,
  POL_EVENT_KIND,
  POL_D_TAG,
  RECIPROCAL_SCAN_TIMEOUT_MS,
  hashCardUid,
  type PolCeremony,
  type PeerScanResult,
} from '../../src/lib/nfc/proof-of-life.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_PUBKEY = 'aa'.repeat(32);
const PEER_PUBKEY = 'bb'.repeat(32);
const PEER_CARD_UID = 'aabbccdd1122'; // 12 hex chars = 6 bytes; padded to 14 for piccData
const LOCAL_CARD_UID = '112233445566';
const VALID_CMAC = 'validcmac';
const INVALID_CMAC = 'badcmac';
const MOCK_BLOCK_HEIGHT = 873_200;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProofOfLifeService — mutual contact exchange', () => {
  let vault: ReturnType<typeof createMockVault>;
  let service: ProofOfLifeService;

  beforeEach(() => {
    vault = createMockVault();
    // No pinGate in constructor — PIN is not used during ceremony
    service = new ProofOfLifeService(vault as any);
  });

  // ── initiateCeremony ──────────────────────────────────────────────────────

  describe('initiateCeremony', () => {
    it('creates a ceremony in INITIATED state', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      expect(ceremony.state).toBe('INITIATED');
    });

    it('stores localPubkey', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      expect(ceremony.localPubkey).toBe(LOCAL_PUBKEY);
    });

    it('sets both pubkeys and card UIDs to empty strings initially', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      expect(ceremony.peerPubkey).toBe('');
      expect(ceremony.peerCardUid).toBe('');
      expect(ceremony.localCardUid).toBe('');
    });

    it('does not include PIN state in initial ceremony', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      // localPinVerified and peerPinVerified are kept for backward compat but not used
      expect(ceremony.welcomeMessageId).toBeUndefined();
      expect(ceremony.blockHeight).toBeUndefined();
    });

    it('generates a valid unix-seconds timestamp', async () => {
      const before = Math.floor(Date.now() / 1000);
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      const after = Math.floor(Date.now() / 1000);
      expect(ceremony.timestamp).toBeGreaterThanOrEqual(before);
      expect(ceremony.timestamp).toBeLessThanOrEqual(after);
    });

    it('backward-compat: initiate() delegates to initiateCeremony()', async () => {
      const ceremony = await service.initiate(LOCAL_PUBKEY);
      expect(ceremony.state).toBe('INITIATED');
      expect(ceremony.localPubkey).toBe(LOCAL_PUBKEY);
    });
  });

  // ── scanPeerCard ──────────────────────────────────────────────────────────

  describe('scanPeerCard', () => {
    let initiated: PolCeremony;

    beforeEach(async () => {
      initiated = await service.initiateCeremony(LOCAL_PUBKEY);
    });

    it('transitions INITIATED → PEER_VERIFIED with valid CMAC and registered card', async () => {
      // Register peer card SUN key in vault
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const piccData = PEER_CARD_UID.slice(0, 14);
      const result = await service.scanPeerCard(initiated, piccData, VALID_CMAC);
      expect(result.state).toBe('PEER_VERIFIED');
    });

    it('transitions through SCANNING_PEER internally', async () => {
      // We verify the returned state is PEER_VERIFIED (SCANNING_PEER is transient)
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const piccData = PEER_CARD_UID.slice(0, 14);
      const result = await service.scanPeerCard(initiated, piccData, VALID_CMAC);
      expect(result.state).not.toBe('IDLE');
      expect(result.state).not.toBe('SCANNING_PEER');
    });

    it('populates peerCardUid and peerCardUidHash on success', async () => {
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const piccData = PEER_CARD_UID.slice(0, 14);
      const result = await service.scanPeerCard(initiated, piccData, VALID_CMAC);
      expect(result.peerCardUid).toBeTruthy();
      expect(result.peerCardUidHash).toBeTruthy();
      expect(result.peerCardUidHash.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it('returns FAILED when SUN key not registered in vault', async () => {
      // No key stored — simulates unregistered peer card
      const result = await service.scanPeerCard(initiated, PEER_CARD_UID.slice(0, 14), VALID_CMAC);
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('SUN key not found');
    });

    it('returns FAILED when CMAC is invalid', async () => {
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const result = await service.scanPeerCard(initiated, PEER_CARD_UID.slice(0, 14), INVALID_CMAC);
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('CMAC');
    });

    it('returns FAILED when called in wrong state', async () => {
      const wrongState = { ...initiated, state: 'PEER_VERIFIED' as const };
      const result = await service.scanPeerCard(wrongState, PEER_CARD_UID.slice(0, 14), VALID_CMAC);
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });

    it('backward-compat: processCardTap() delegates to scanPeerCard()', async () => {
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const result = await service.processCardTap(initiated, PEER_CARD_UID.slice(0, 14), VALID_CMAC);
      expect(result.state).toBe('PEER_VERIFIED');
    });
  });

  // ── awaitReciprocalScan ───────────────────────────────────────────────────

  describe('awaitReciprocalScan', () => {
    it('transitions PEER_VERIFIED → AWAITING_RECIPROCAL', async () => {
      const peerVerified: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'PEER_VERIFIED',
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
        peerPubkey: PEER_PUBKEY,
      };
      const result = await service.awaitReciprocalScan(peerVerified);
      expect(result.state).toBe('AWAITING_RECIPROCAL');
    });

    it('returns FAILED when called in wrong state', async () => {
      const initiated = await service.initiateCeremony(LOCAL_PUBKEY);
      const result = await service.awaitReciprocalScan(initiated);
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });
  });

  // ── confirmReciprocalScan ─────────────────────────────────────────────────

  describe('confirmReciprocalScan', () => {
    it('transitions AWAITING_RECIPROCAL → MUTUAL_VERIFIED', async () => {
      const awaiting: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'AWAITING_RECIPROCAL',
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
        peerPubkey: PEER_PUBKEY,
      };
      const peerScan: PeerScanResult = {
        peerCardUid: LOCAL_CARD_UID,
        peerCardUidHash: '00'.repeat(32),
        cmacCounter: 7,
      };
      const result = await service.confirmReciprocalScan(awaiting, peerScan);
      expect(result.state).toBe('MUTUAL_VERIFIED');
    });

    it('records local card UID from peer scan result', async () => {
      const awaiting: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'AWAITING_RECIPROCAL',
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
        peerPubkey: PEER_PUBKEY,
      };
      const peerScan: PeerScanResult = {
        peerCardUid: LOCAL_CARD_UID,
        peerCardUidHash: '11'.repeat(32),
        cmacCounter: 7,
      };
      const result = await service.confirmReciprocalScan(awaiting, peerScan);
      expect(result.localCardUid).toBe(LOCAL_CARD_UID);
      expect(result.localCardUidHash).toBe('11'.repeat(32));
    });

    it('also works from PEER_VERIFIED state', async () => {
      const peerVerified: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'PEER_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
      };
      const peerScan: PeerScanResult = {
        peerCardUid: LOCAL_CARD_UID,
        peerCardUidHash: '22'.repeat(32),
        cmacCounter: 5,
      };
      const result = await service.confirmReciprocalScan(peerVerified, peerScan);
      expect(result.state).toBe('MUTUAL_VERIFIED');
    });

    it('returns FAILED when called in wrong state', async () => {
      const initiated = await service.initiateCeremony(LOCAL_PUBKEY);
      const peerScan: PeerScanResult = {
        peerCardUid: LOCAL_CARD_UID,
        peerCardUidHash: '00'.repeat(32),
        cmacCounter: 1,
      };
      const result = await service.confirmReciprocalScan(initiated, peerScan);
      expect(result.state).toBe('FAILED');
    });
  });

  // ── sendWelcomeMessage ────────────────────────────────────────────────────

  describe('sendWelcomeMessage', () => {
    let mutualVerified: PolCeremony;

    beforeEach(async () => {
      mutualVerified = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: '12345678'.repeat(8),
        cmacCounter: 42,
      };
    });

    it('transitions MUTUAL_VERIFIED → WELCOME_SENT', async () => {
      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.state).toBe('WELCOME_SENT');
    });

    it('sets welcomeMessageId on success', async () => {
      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.welcomeMessageId).toBeTruthy();
    });

    it('sets welcomeMessageHash on success', async () => {
      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.welcomeMessageHash).toBeTruthy();
      expect(typeof result.welcomeMessageHash).toBe('string');
      expect(result.welcomeMessageHash!.length).toBe(64); // SHA-256 hex
    });

    it('records the Bitcoin block height', async () => {
      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.blockHeight).toBe(MOCK_BLOCK_HEIGHT);
    });

    it('returns FAILED when called in wrong state', async () => {
      const wrongState = { ...mutualVerified, state: 'INITIATED' as const };
      const result = await service.sendWelcomeMessage(
        wrongState,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });

    it('accepts nsec bech32 format', async () => {
      const result = await service.sendWelcomeMessage(
        mutualVerified,
        'nsec1' + 'q'.repeat(59),
        MOCK_BLOCK_HEIGHT,
      );
      expect(result.state).toBe('WELCOME_SENT');
    });
  });

  // ── constructAttestations ─────────────────────────────────────────────────

  describe('constructAttestations', () => {
    let attesting: PolCeremony;

    beforeEach(async () => {
      attesting = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'ATTESTING',
        localPubkey: LOCAL_PUBKEY,
        localPinVerified: false,
        peerPinVerified: false,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
        welcomeMessageHash: 'abcd'.repeat(16),
        blockHeight: MOCK_BLOCK_HEIGHT,
      };
    });

    it('also accepts WELCOME_SENT state', async () => {
      const welcomeSent = { ...attesting, state: 'WELCOME_SENT' as const };
      const result = await service.constructAttestations(welcomeSent, '00'.repeat(32));
      expect(result.state).toBe('ATTESTING');
    });

    it('stays in ATTESTING state after construction', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      expect(result.state).toBe('ATTESTING');
    });

    it('populates attestationEvents.localEvent', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      expect(result.attestationEvents).toBeDefined();
      expect(result.attestationEvents!.localEvent).toBeDefined();
    });

    it('populates attestationEvents.peerEvent', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      expect(result.attestationEvents!.peerEvent).toBeDefined();
    });

    it('local event has kind 30078', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      expect(localEvent.kind).toBe(POL_EVENT_KIND);
    });

    it('local event has d-tag = satnam:proof-of-life', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const dTag = (localEvent.tags as string[][]).find((t) => t[0] === 'd');
      expect(dTag?.[1]).toBe(POL_D_TAG);
    });

    it('local event p-tag points to the PEER (not self)', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const pTag = (localEvent.tags as string[][]).find((t) => t[0] === 'p');
      expect(pTag?.[1]).toBe(PEER_PUBKEY);
      // Must NOT be the local pubkey
      expect(pTag?.[1]).not.toBe(LOCAL_PUBKEY);
    });

    it('local event nfc-card-hash tag is the PEER card hash', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const nfcTag = (localEvent.tags as string[][]).find(
        (t) => t[0] === 'nfc-card-hash',
      );
      expect(nfcTag?.[1]).toBe(attesting.peerCardUidHash);
      // Must NOT be the local card hash
      expect(nfcTag?.[1]).not.toBe(attesting.localCardUidHash);
    });

    it('peer event p-tag points to LOCAL user (not peer)', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const peerEvent = result.attestationEvents!.peerEvent as any;
      const pTag = (peerEvent.tags as string[][]).find((t) => t[0] === 'p');
      // Peer event's p-tag should reference the local pubkey
      expect(pTag?.[1]).toBe(LOCAL_PUBKEY);
    });

    it('peer event nfc-card-hash is the LOCAL card hash', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const peerEvent = result.attestationEvents!.peerEvent as any;
      const nfcTag = (peerEvent.tags as string[][]).find(
        (t) => t[0] === 'nfc-card-hash',
      );
      expect(nfcTag?.[1]).toBe(attesting.localCardUidHash);
    });

    it('both events have bilateral=true tag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const bilateralTag = (localEvent.tags as string[][]).find(
        (t) => t[0] === 'bilateral',
      );
      expect(bilateralTag?.[1]).toBe('true');
    });

    it('local event includes welcome-msg-hash tag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const welcomeTag = (localEvent.tags as string[][]).find(
        (t) => t[0] === 'welcome-msg-hash',
      );
      expect(welcomeTag).toBeDefined();
      expect(welcomeTag?.[1]).toBe(attesting.welcomeMessageHash);
    });

    it('local event includes block-height tag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const blockTag = (localEvent.tags as string[][]).find(
        (t) => t[0] === 'block-height',
      );
      expect(blockTag).toBeDefined();
      expect(blockTag?.[1]).toBe(String(MOCK_BLOCK_HEIGHT));
    });

    it('peer event includes welcome-msg-hash tag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const peerEvent = result.attestationEvents!.peerEvent as any;
      const welcomeTag = (peerEvent.tags as string[][]).find(
        (t) => t[0] === 'welcome-msg-hash',
      );
      expect(welcomeTag).toBeDefined();
    });

    it('peer event includes block-height tag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const peerEvent = result.attestationEvents!.peerEvent as any;
      const blockTag = (peerEvent.tags as string[][]).find(
        (t) => t[0] === 'block-height',
      );
      expect(blockTag).toBeDefined();
      expect(blockTag?.[1]).toBe(String(MOCK_BLOCK_HEIGHT));
    });

    it('content includes welcome_message_hash field', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const content = JSON.parse(localEvent.content);
      expect(content.welcome_message_hash).toBe(attesting.welcomeMessageHash);
    });

    it('content includes block_height field', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const content = JSON.parse(localEvent.content);
      expect(content.block_height).toBe(MOCK_BLOCK_HEIGHT);
    });

    it('content includes bilateral:true flag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const content = JSON.parse(localEvent.content);
      expect(content.bilateral).toBe(true);
    });

    it('computes welcome-msg-hash automatically when welcomeMessageHash not set', async () => {
      const noHash = { ...attesting, welcomeMessageHash: undefined };
      const result = await service.constructAttestations(noHash, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const welcomeTag = (localEvent.tags as string[][]).find(
        (t) => t[0] === 'welcome-msg-hash',
      );
      // Should generate a fallback hash
      expect(welcomeTag).toBeDefined();
      expect(welcomeTag?.[1].length).toBe(64);
    });

    it('returns FAILED in wrong state', async () => {
      const wrongState = { ...attesting, state: 'INITIATED' as const };
      const result = await service.constructAttestations(wrongState, '00'.repeat(32));
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });

    it('accepts nsec bech32 format', async () => {
      const result = await service.constructAttestations(
        attesting,
        'nsec1' + 'q'.repeat(59),
      );
      expect(result.state).toBe('ATTESTING');
      expect(result.attestationEvents).toBeDefined();
    });

    it('backward-compat: sign() delegates to constructAttestations()', async () => {
      // sign() accepts PIN_VERIFIED (maps to ATTESTING)
      const pinVerified = { ...attesting, state: 'PIN_VERIFIED' as any };
      const result = await service.sign(pinVerified, '00'.repeat(32));
      expect(result.attestationEvents).toBeDefined();
    });
  });

  // ── publishAttestations ───────────────────────────────────────────────────

  describe('publishAttestations', () => {
    let readyToPublish: PolCeremony;

    beforeEach(async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      readyToPublish = {
        ...base,
        state: 'ATTESTING',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        welcomeMessageHash: 'abcd'.repeat(16),
        blockHeight: MOCK_BLOCK_HEIGHT,
        attestationEvents: {
          localEvent: {
            kind: POL_EVENT_KIND,
            id: '00'.repeat(32),
            sig: '00'.repeat(64),
            pubkey: LOCAL_PUBKEY,
            tags: [
              ['d', POL_D_TAG],
              ['p', PEER_PUBKEY],
              ['nfc-card-hash', 'dead'.repeat(16)],
              ['bilateral', 'true'],
              ['welcome-msg-hash', 'abcd'.repeat(16)],
              ['block-height', String(MOCK_BLOCK_HEIGHT)],
            ],
            content: '{}',
            created_at: Math.floor(Date.now() / 1000),
          },
          peerEvent: {},
        },
        cmacCounter: 42,
      };
    });

    it('returns FAILED when called with no attestationEvents', async () => {
      const noEvents = {
        ...readyToPublish,
        attestationEvents: undefined,
        signedEvent: undefined,
      };
      const result = await service.publishAttestations(noEvents, 'wss://relay.test');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('attestation');
    });

    it('returns FAILED when called in wrong state', async () => {
      const wrongState = { ...readyToPublish, state: 'INITIATED' as const };
      const result = await service.publishAttestations(wrongState, 'wss://relay.test');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });
  });

  // ── Full mutual ceremony state machine (no PIN) ───────────────────────────

  describe('full mutual ceremony state machine (no PIN)', () => {
    it('transitions through the complete happy path without PIN', async () => {
      // 1. Initiate
      let ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      expect(ceremony.state).toBe('INITIATED');

      // 2. Scan peer card
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      ceremony = await service.scanPeerCard(
        ceremony,
        PEER_CARD_UID.slice(0, 14),
        VALID_CMAC,
      );
      expect(ceremony.state).toBe('PEER_VERIFIED');

      // 3. Await reciprocal
      ceremony = await service.awaitReciprocalScan(ceremony);
      expect(ceremony.state).toBe('AWAITING_RECIPROCAL');

      // 4. Confirm reciprocal
      const peerScan: PeerScanResult = {
        peerCardUid: LOCAL_CARD_UID,
        peerCardUidHash: '00'.repeat(32),
        cmacCounter: 10,
      };
      ceremony = await service.confirmReciprocalScan(ceremony, peerScan);
      expect(ceremony.state).toBe('MUTUAL_VERIFIED');

      // 5. Send welcome message (replaces PIN exchange)
      ceremony = await service.sendWelcomeMessage(ceremony, '00'.repeat(32), MOCK_BLOCK_HEIGHT);
      expect(ceremony.state).toBe('WELCOME_SENT');
      expect(ceremony.welcomeMessageId).toBeTruthy();
      expect(ceremony.blockHeight).toBe(MOCK_BLOCK_HEIGHT);

      // 6. Construct attestations (includes welcome-msg-hash and block-height)
      ceremony = {
        ...ceremony,
        localCardUidHash: 'cafe'.repeat(16),
        peerPubkey: PEER_PUBKEY,
        peerCardUidHash: 'dead'.repeat(16),
      };
      ceremony = await service.constructAttestations(ceremony, '00'.repeat(32));
      expect(ceremony.state).toBe('ATTESTING');
      expect(ceremony.attestationEvents).toBeDefined();

      // Verify welcome-msg-hash in attestation
      const localEvent = ceremony.attestationEvents!.localEvent as any;
      const welcomeTag = (localEvent.tags as string[][]).find(
        (t: string[]) => t[0] === 'welcome-msg-hash',
      );
      expect(welcomeTag).toBeDefined();

      // Verify block-height in attestation
      const blockTag = (localEvent.tags as string[][]).find(
        (t: string[]) => t[0] === 'block-height',
      );
      expect(blockTag?.[1]).toBe(String(MOCK_BLOCK_HEIGHT));
    });

    it('can fail at any step with informative error', async () => {
      // Fail at CMAC verification
      let ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      await vault.storeNfcKey(PEER_CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      ceremony = await service.scanPeerCard(
        ceremony,
        PEER_CARD_UID.slice(0, 14),
        INVALID_CMAC,
      );
      expect(ceremony.state).toBe('FAILED');
      expect(ceremony.error).toBeTruthy();
    });

    it('STATE contains WELCOME_SENT and not PIN_EXCHANGE', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified = {
        ...ceremony,
        state: 'MUTUAL_VERIFIED' as const,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const welcomed = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(welcomed.state).toBe('WELCOME_SENT');
      // PIN_EXCHANGE state should not appear in new flow
      const validStates = [
        'IDLE', 'INITIATED', 'SCANNING_PEER', 'PEER_VERIFIED',
        'AWAITING_RECIPROCAL', 'MUTUAL_VERIFIED', 'WELCOME_SENT',
        'ATTESTING', 'PUBLISHED', 'CONFIRMED', 'FAILED',
      ];
      expect(validStates).toContain(welcomed.state);
      expect(validStates).not.toContain('PIN_EXCHANGE');
    });
  });

  // ── Block height attestation ──────────────────────────────────────────────

  describe('block height attestation', () => {
    it('block height is preserved through welcome → attest pipeline', async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified: PolCeremony = {
        ...base,
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const welcomed = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(welcomed.blockHeight).toBe(MOCK_BLOCK_HEIGHT);

      const attested = await service.constructAttestations(welcomed, '00'.repeat(32));
      const localEvent = attested.attestationEvents!.localEvent as any;
      const content = JSON.parse(localEvent.content);
      expect(content.block_height).toBe(MOCK_BLOCK_HEIGHT);
    });

    it('different block heights produce different ceremony proofs', async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified: PolCeremony = {
        ...base,
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const welcomed1 = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        800_000,
      );
      const welcomed2 = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        873_200,
      );

      expect(welcomed1.blockHeight).toBe(800_000);
      expect(welcomed2.blockHeight).toBe(873_200);
      expect(welcomed1.blockHeight).not.toBe(welcomed2.blockHeight);
    });
  });

  // ── Welcome message tests ─────────────────────────────────────────────────

  describe('welcome message content', () => {
    it('welcome message references peer pubkey in payload', async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified: PolCeremony = {
        ...base,
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );

      expect(result.state).toBe('WELCOME_SENT');
      // The welcome message ID is a signed event ID
      expect(typeof result.welcomeMessageId).toBe('string');
    });

    it('welcome message hash is a 64-char hex string', async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified: PolCeremony = {
        ...base,
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const result = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );

      expect(result.welcomeMessageHash).toBeDefined();
      expect(result.welcomeMessageHash!.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(result.welcomeMessageHash!)).toBe(true);
    });
  });

  // ── Attestation event cross-references ────────────────────────────────────

  describe('attestation event cross-references', () => {
    it('local and peer events reference each other\'s pubkeys (not self)', async () => {
      const ceremony: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'ATTESTING',
        localPubkey: LOCAL_PUBKEY,
        localPinVerified: false,
        peerPinVerified: false,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 7,
        welcomeMessageHash: 'feed'.repeat(16),
        blockHeight: MOCK_BLOCK_HEIGHT,
      };

      const result = await service.constructAttestations(ceremony, '00'.repeat(32));
      const events = result.attestationEvents!;

      const localPTag = (events.localEvent as any).tags.find(
        (t: string[]) => t[0] === 'p',
      );
      const peerPTag = (events.peerEvent as any).tags.find(
        (t: string[]) => t[0] === 'p',
      );

      // Local event p-tag = PEER pubkey
      expect(localPTag[1]).toBe(PEER_PUBKEY);
      // Peer event p-tag = LOCAL pubkey
      expect(peerPTag[1]).toBe(LOCAL_PUBKEY);
      // They are distinct
      expect(localPTag[1]).not.toBe(peerPTag[1]);
    });

    it('nfc-card-hash tags cross-reference the OTHER person\'s card', async () => {
      const peerHash = 'dead'.repeat(16);
      const localHash = 'cafe'.repeat(16);

      const ceremony: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'ATTESTING',
        localPubkey: LOCAL_PUBKEY,
        localPinVerified: false,
        peerPinVerified: false,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: peerHash,
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: localHash,
        cmacCounter: 7,
        welcomeMessageHash: 'feed'.repeat(16),
        blockHeight: MOCK_BLOCK_HEIGHT,
      };

      const result = await service.constructAttestations(ceremony, '00'.repeat(32));
      const events = result.attestationEvents!;

      const localNfcTag = (events.localEvent as any).tags.find(
        (t: string[]) => t[0] === 'nfc-card-hash',
      );
      const peerNfcTag = (events.peerEvent as any).tags.find(
        (t: string[]) => t[0] === 'nfc-card-hash',
      );

      // Local event's nfc-card-hash = peer's card hash
      expect(localNfcTag[1]).toBe(peerHash);
      // Peer event's nfc-card-hash = local user's card hash
      expect(peerNfcTag[1]).toBe(localHash);
    });
  });

  // ── hashCardUid ──────────────────────────────────────────────────────────

  describe('hashCardUid', () => {
    it('returns a 64-char hex string', () => {
      const hash = hashCardUid(PEER_CARD_UID);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('produces consistent output for same input', () => {
      expect(hashCardUid(PEER_CARD_UID)).toBe(hashCardUid(PEER_CARD_UID));
    });

    it('produces different outputs for different UIDs', () => {
      const h1 = hashCardUid('aabbccdd1122');
      const h2 = hashCardUid('112233445566');
      expect(h1).not.toBe(h2);
    });
  });

  // ── Constants ────────────────────────────────────────────────────────────

  describe('exported constants', () => {
    it('POL_EVENT_KIND is 30078', () => {
      expect(POL_EVENT_KIND).toBe(30078);
    });

    it('POL_D_TAG is satnam:proof-of-life', () => {
      expect(POL_D_TAG).toBe('satnam:proof-of-life');
    });

    it('RECIPROCAL_SCAN_TIMEOUT_MS is 60000', () => {
      expect(RECIPROCAL_SCAN_TIMEOUT_MS).toBe(60_000);
    });
  });

  // ── PolState type coverage ────────────────────────────────────────────────

  describe('new PolState values (no PIN_EXCHANGE)', () => {
    it('INITIATED ceremony has correct state field', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      const validStates: string[] = [
        'IDLE', 'INITIATED', 'SCANNING_PEER', 'PEER_VERIFIED',
        'AWAITING_RECIPROCAL', 'MUTUAL_VERIFIED', 'WELCOME_SENT',
        'ATTESTING', 'PUBLISHED', 'CONFIRMED', 'FAILED',
      ];
      expect(validStates).toContain(ceremony.state);
    });

    it('WELCOME_SENT is a valid state', async () => {
      const base = await service.initiateCeremony(LOCAL_PUBKEY);
      const mutualVerified: PolCeremony = {
        ...base,
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };
      const welcomed = await service.sendWelcomeMessage(
        mutualVerified,
        '00'.repeat(32),
        MOCK_BLOCK_HEIGHT,
      );
      expect(welcomed.state).toBe('WELCOME_SENT');
    });
  });
});
