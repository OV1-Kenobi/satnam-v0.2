/**
 * Tests for src/lib/nfc/proof-of-life.ts
 *
 * ProofOfLifeService — mutual contact exchange ceremony.
 *
 * The PoL ceremony is NOT a solo self-attestation. It is a bilateral exchange:
 * Two co-present users each scan the OTHER person's NFC "Name Tag" card,
 * then both enter their PINs to authorize bilateral kind:30078 attestation events.
 *
 * Test coverage:
 * - State machine: full mutual ceremony transitions
 * - Peer card CMAC verification (scanPeerCard)
 * - Bilateral attestation construction (correct p-tags, nfc-card-hash)
 * - PIN verification for both parties
 * - Error cases: invalid peer CMAC, PIN lockout, timeout, wrong state
 * - Attestation events reference the OTHER participant's pubkey
 * - Backward-compat deprecated wrappers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('argon2-browser', () => ({
  default: {
    hash: vi.fn(async ({ pass }: { pass: string }) => ({
      hash: new Uint8Array(32).fill(pass.charCodeAt(0) % 256),
    })),
    ArgonType: { Argon2id: 2 },
  },
}));

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
// Mock PinGate
// ---------------------------------------------------------------------------

function createMockPinGate(verifyResult = true, locked = false) {
  return {
    isLockedOut: vi.fn(() => locked),
    getRemainingLockout: vi.fn(() => (locked ? 300_000 : 0)),
    getRemainingAttempts: vi.fn(() => (locked ? 0 : 3)),
    verifyPin: vi.fn(async (_pin: string) => verifyResult),
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProofOfLifeService — mutual contact exchange', () => {
  let vault: ReturnType<typeof createMockVault>;
  let pinGate: ReturnType<typeof createMockPinGate>;
  let service: ProofOfLifeService;

  beforeEach(() => {
    vault = createMockVault();
    pinGate = createMockPinGate();
    service = new ProofOfLifeService(vault as any, pinGate as any);
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

    it('sets localPinVerified and peerPinVerified to false', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      expect(ceremony.localPinVerified).toBe(false);
      expect(ceremony.peerPinVerified).toBe(false);
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

  // ── verifyLocalPin ────────────────────────────────────────────────────────

  describe('verifyLocalPin', () => {
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

    it('sets localPinVerified = true and transitions to PIN_EXCHANGE on correct PIN', async () => {
      const result = await service.verifyLocalPin(mutualVerified, '1234');
      expect(result.localPinVerified).toBe(true);
      expect(result.state).toBe('PIN_EXCHANGE');
    });

    it('advances to ATTESTING immediately if peerPinVerified is already true', async () => {
      const withPeerPin = { ...mutualVerified, peerPinVerified: true };
      const result = await service.verifyLocalPin(withPeerPin, '1234');
      expect(result.state).toBe('ATTESTING');
    });

    it('returns FAILED on incorrect PIN', async () => {
      pinGate.verifyPin.mockResolvedValueOnce(false);
      const result = await service.verifyLocalPin(mutualVerified, '9999');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('Incorrect PIN');
    });

    it('returns FAILED when gate is locked out', async () => {
      pinGate.isLockedOut.mockReturnValueOnce(true);
      const result = await service.verifyLocalPin(mutualVerified, '1234');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('locked out');
    });

    it('returns FAILED when called in wrong state', async () => {
      const wrongState = { ...mutualVerified, state: 'INITIATED' as const };
      const result = await service.verifyLocalPin(wrongState, '1234');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
    });

    it('backward-compat: processPin() delegates to verifyLocalPin()', async () => {
      // processPin maps CARD_TAPPED → MUTUAL_VERIFIED
      const cardTapped = { ...mutualVerified, state: 'CARD_TAPPED' as any };
      const result = await service.processPin(cardTapped, '1234');
      expect(result.localPinVerified).toBe(true);
    });
  });

  // ── verifyPeerPin ─────────────────────────────────────────────────────────

  describe('verifyPeerPin', () => {
    let pinExchange: PolCeremony;

    beforeEach(async () => {
      pinExchange = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'PIN_EXCHANGE',
        localPinVerified: false,
        peerPinVerified: false,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'deadbeef'.repeat(8),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: '12345678'.repeat(8),
        cmacCounter: 42,
      };
    });

    it('sets peerPinVerified = true and stays in PIN_EXCHANGE if localPinVerified is false', async () => {
      const result = await service.verifyPeerPin(pinExchange);
      expect(result.peerPinVerified).toBe(true);
      expect(result.state).toBe('PIN_EXCHANGE');
    });

    it('advances to ATTESTING if localPinVerified is already true', async () => {
      const withLocalPin = { ...pinExchange, localPinVerified: true };
      const result = await service.verifyPeerPin(withLocalPin);
      expect(result.peerPinVerified).toBe(true);
      expect(result.state).toBe('ATTESTING');
    });

    it('returns FAILED when called in wrong state', async () => {
      const wrongState = { ...pinExchange, state: 'INITIATED' as const };
      const result = await service.verifyPeerPin(wrongState);
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('invalid state');
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
        localPinVerified: true,
        peerPinVerified: true,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };
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

    it('content includes bilateral:true flag', async () => {
      const result = await service.constructAttestations(attesting, '00'.repeat(32));
      const localEvent = result.attestationEvents!.localEvent as any;
      const content = JSON.parse(localEvent.content);
      expect(content.bilateral).toBe(true);
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

  // ── Full mutual ceremony state machine ────────────────────────────────────

  describe('full mutual ceremony state machine', () => {
    it('transitions through the complete happy path', async () => {
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

      // 5. Local PIN
      ceremony = await service.verifyLocalPin(ceremony, '1234');
      expect(ceremony.state).toBe('PIN_EXCHANGE');
      expect(ceremony.localPinVerified).toBe(true);

      // 6. Peer PIN
      ceremony = await service.verifyPeerPin(ceremony);
      expect(ceremony.state).toBe('ATTESTING');
      expect(ceremony.peerPinVerified).toBe(true);

      // 7. Construct attestations
      ceremony = {
        ...ceremony,
        localCardUidHash: 'cafe'.repeat(16),
        peerPubkey: PEER_PUBKEY,
        peerCardUidHash: 'dead'.repeat(16),
      };
      ceremony = await service.constructAttestations(ceremony, '00'.repeat(32));
      expect(ceremony.state).toBe('ATTESTING');
      expect(ceremony.attestationEvents).toBeDefined();
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

    it('PIN lockout fails ceremony with lockout error', async () => {
      const lockedPinGate = createMockPinGate(true, true);
      const lockedService = new ProofOfLifeService(vault as any, lockedPinGate as any);

      const ceremony: PolCeremony = {
        ...(await lockedService.initiateCeremony(LOCAL_PUBKEY)),
        state: 'MUTUAL_VERIFIED',
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 42,
      };

      const result = await lockedService.verifyLocalPin(ceremony, '1234');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('locked out');
    });
  });

  // ── Attestation event cross-references ────────────────────────────────────

  describe('attestation event cross-references', () => {
    it('local and peer events reference each other\'s pubkeys (not self)', async () => {
      const ceremony: PolCeremony = {
        ...(await service.initiateCeremony(LOCAL_PUBKEY)),
        state: 'ATTESTING',
        localPubkey: LOCAL_PUBKEY,
        localPinVerified: true,
        peerPinVerified: true,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: 'dead'.repeat(16),
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: 'cafe'.repeat(16),
        cmacCounter: 7,
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
        localPinVerified: true,
        peerPinVerified: true,
        peerPubkey: PEER_PUBKEY,
        peerCardUid: PEER_CARD_UID,
        peerCardUidHash: peerHash,
        localCardUid: LOCAL_CARD_UID,
        localCardUidHash: localHash,
        cmacCounter: 7,
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

  describe('new PolState values', () => {
    it('INITIATED ceremony has new state field', async () => {
      const ceremony = await service.initiateCeremony(LOCAL_PUBKEY);
      const validStates: string[] = [
        'IDLE', 'INITIATED', 'SCANNING_PEER', 'PEER_VERIFIED',
        'AWAITING_RECIPROCAL', 'MUTUAL_VERIFIED', 'PIN_EXCHANGE',
        'ATTESTING', 'PUBLISHED', 'CONFIRMED', 'FAILED',
      ];
      expect(validStates).toContain(ceremony.state);
    });
  });
});
