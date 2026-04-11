/**
 * @file messaging.test.ts
 * @description Unit tests for the Satnam v2 messaging infrastructure.
 *
 * Tests cover:
 * 1.  Group creation — GroupChatManager.createGroup
 * 2.  Group gift-wrap — sendGroupMessage wraps to each member individually
 * 3.  Group admin controls — only admins can add/remove members
 * 4.  addMember — adds member, updates config
 * 5.  removeMember — removes member, updates config
 * 6.  leaveGroup — self-removal
 * 7.  getGroupMessages — retrieves and filters messages
 * 8.  listGroups — sorted by lastActivity
 * 9.  DirectChatManager.sendDirectMessage — basic DM
 * 10. sendDirectMessage with PoL-verified contact — triggers PIN gate
 * 11. DirectChatManager.markAsRead — marks message read
 * 12. DirectChatManager.deleteMessage — NIP-09 deletion
 * 13. Ephemeral: setMessageTtl — NIP-40 expiration tag
 * 14. Ephemeral: setBurnAfterRead — flag set
 * 15. Ephemeral: isExpired — expired / not expired
 * 16. Ephemeral: formatCountdown — human-readable countdown
 * 17. Ephemeral: processExpiredMessages — GC removes expired
 * 18. Ephemeral: TTL presets
 * 19. Ephemeral: scheduleAutoDelete — fires callback
 * 20. EphemeralConfig factories — ttl5m, ttl1h, ttl24h, ttl7d, ttlCustom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { Message, EphemeralConfig, GroupConfig } from '../../src/lib/messaging/types.js';
import { TTL_PRESETS } from '../../src/lib/messaging/types.js';

import { GroupChatManager } from '../../src/lib/messaging/group-chat.js';
import { DirectChatManager, _resetDirectChatStore } from '../../src/lib/messaging/direct-chat.js';
import {
  EphemeralManager,
  setMessageTtl,
  setBurnAfterRead,
  isExpired,
  secondsUntilExpiry,
  formatCountdown,
  buildExpirationTag,
  parseExpirationTag,
  ttl5m,
  ttl1h,
  ttl24h,
  ttl7d,
  ttlCustom,
} from '../../src/lib/messaging/ephemeral.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock CEPS so no real network calls are made
vi.mock('../../src/lib/ceps/ceps-client.js', () => ({
  sendGiftwrappedMessageWithCeps: vi.fn().mockResolvedValue('mock-event-id'),
  publishEventWithCeps: vi.fn().mockResolvedValue('mock-event-id'),
  signEventWithCeps: vi.fn().mockImplementation(async (e: any) => ({
    ...e,
    id: 'mock-signed-id',
    sig: 'mock-sig',
  })),
  listEventsWithCeps: vi.fn().mockResolvedValue([]),
  getDefaultRelays: vi.fn().mockReturnValue(['wss://nos.lol']),
}));

// In-memory localStorage mock
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  get length() { return Object.keys(storage).length; },
};
vi.stubGlobal('localStorage', localStorageMock);

// Fixed pubkeys for testing
const ALICE = 'aaaa'.repeat(16);   // 64-char hex
const BOB   = 'bbbb'.repeat(16);
const CAROL = 'cccc'.repeat(16);
const DAVE  = 'dddd'.repeat(16);

// Fixed unix timestamp (seconds)
const BASE_TS = 1_700_000_000;

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    senderPubkey: ALICE,
    threadId: 'thread-1',
    content: 'Hello',
    createdAt: BASE_TS,
    status: 'sent',
    readReceipts: [],
    deleted: false,
    ...overrides,
  };
}

// ============================================================================
// 1-8. Group Chat
// ============================================================================

describe('GroupChatManager', () => {
  let gm: GroupChatManager;

  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    gm = new GroupChatManager(ALICE, ['wss://nos.lol']);
  });

  // --------------------------------------------------------------------------
  it('createGroup: creates a group with correct config', async () => {
    const thread = await gm.createGroup('Test Group', [BOB, CAROL]);

    expect(thread.type).toBe('group');
    expect(thread.config.name).toBe('Test Group');
    expect(thread.config.members).toContain(ALICE);
    expect(thread.config.members).toContain(BOB);
    expect(thread.config.members).toContain(CAROL);
    expect(thread.config.admins).toContain(ALICE);
    expect(thread.config.admins).not.toContain(BOB);
  });

  it('createGroup: creator is always included in members', async () => {
    const thread = await gm.createGroup('Minimal Group', [BOB]);
    expect(thread.config.members).toContain(ALICE);
  });

  it('createGroup: sends gift-wrapped welcome to each non-self member', async () => {
    const { sendGiftwrappedMessageWithCeps } = await import('../../src/lib/ceps/ceps-client.js');
    await gm.createGroup('Welcome Test', [BOB, CAROL]);
    // One gift-wrap per non-self member (BOB + CAROL = 2 calls)
    expect(sendGiftwrappedMessageWithCeps).toHaveBeenCalledTimes(2);
  });

  it('createGroup: persists to localStorage', async () => {
    await gm.createGroup('Persist Test', [BOB]);
    const groups = await gm.listGroups();
    expect(groups.length).toBe(1);
    expect(groups[0].config.name).toBe('Persist Test');
  });

  // --------------------------------------------------------------------------
  it('sendGroupMessage: gift-wraps to all members individually', async () => {
    const { sendGiftwrappedMessageWithCeps } = await import('../../src/lib/ceps/ceps-client.js');
    const thread = await gm.createGroup('Multi-wrap', [BOB, CAROL]);
    vi.clearAllMocks();

    await gm.sendGroupMessage(thread.groupId, 'Hey all!');
    // members = [ALICE, BOB, CAROL] → 3 gift-wraps
    expect(sendGiftwrappedMessageWithCeps).toHaveBeenCalledTimes(3);
  });

  it('sendGroupMessage: ephemeral config sets expiresAt', async () => {
    const thread = await gm.createGroup('Ephemeral Group', [BOB]);
    const msg = await gm.sendGroupMessage(thread.groupId, 'Self-destruct!', {
      ttl: TTL_PRESETS.ONE_HOUR,
      burnAfterRead: false,
    });

    expect(msg.expiresAt).toBeDefined();
    expect(msg.expiresAt!).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(msg.ephemeral?.ttl).toBe(TTL_PRESETS.ONE_HOUR);
  });

  it('sendGroupMessage: returns Message with correct fields', async () => {
    const thread = await gm.createGroup('Field Test', [BOB]);
    const msg = await gm.sendGroupMessage(thread.groupId, 'Content here');

    expect(msg.content).toBe('Content here');
    expect(msg.senderPubkey).toBe(ALICE);
    expect(msg.threadId).toBe(thread.groupId);
    expect(msg.status).toBe('sent');
  });

  it('sendGroupMessage: throws for unknown groupId', async () => {
    await expect(
      gm.sendGroupMessage('nonexistent-group-id', 'Oops'),
    ).rejects.toThrow('Group not found');
  });

  // --------------------------------------------------------------------------
  it('addMember: non-admin throws', async () => {
    const bobGm = new GroupChatManager(BOB, ['wss://nos.lol']);
    const thread = await gm.createGroup('Admin Test', [BOB]);
    // Store the group in BOB's storage by syncing localStorageMock data
    await expect(bobGm.addMember(thread.groupId, CAROL)).rejects.toThrow(
      'Only group admins',
    );
  });

  it('addMember: admin can add a new member', async () => {
    const thread = await gm.createGroup('Add Test', [BOB]);
    await gm.addMember(thread.groupId, CAROL);

    const updated = await gm.getGroup(thread.groupId);
    expect(updated?.config.members).toContain(CAROL);
  });

  it('addMember: idempotent for already-member pubkeys', async () => {
    const thread = await gm.createGroup('Idempotent Test', [BOB]);
    await gm.addMember(thread.groupId, BOB); // BOB is already a member
    const updated = await gm.getGroup(thread.groupId);
    const bobCount = updated!.config.members.filter((m) => m === BOB).length;
    expect(bobCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  it('removeMember: admin can remove a member', async () => {
    const thread = await gm.createGroup('Remove Test', [BOB, CAROL]);
    await gm.removeMember(thread.groupId, BOB);

    const updated = await gm.getGroup(thread.groupId);
    expect(updated?.config.members).not.toContain(BOB);
    expect(updated?.config.members).toContain(CAROL);
  });

  it('removeMember: also removes from admins list', async () => {
    const thread = await gm.createGroup('Admin Removal', [BOB]);
    // Manually patch config to make BOB an admin for this test
    const stored = localStorageMock.getItem('satnam:groups:v2');
    if (stored) {
      const groups = JSON.parse(stored);
      groups[0].config.admins.push(BOB);
      localStorageMock.setItem('satnam:groups:v2', JSON.stringify(groups));
    }

    await gm.removeMember(thread.groupId, BOB);
    const updated = await gm.getGroup(thread.groupId);
    expect(updated?.config.admins).not.toContain(BOB);
  });

  // --------------------------------------------------------------------------
  it('leaveGroup: removes local user from group', async () => {
    const thread = await gm.createGroup('Leave Test', [BOB]);
    await gm.leaveGroup(thread.groupId);

    const groups = await gm.listGroups();
    expect(groups.find((g) => g.groupId === thread.groupId)).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  it('getGroupMessages: returns messages sorted ascending', async () => {
    const thread = await gm.createGroup('Msg Order', [BOB]);
    await gm.sendGroupMessage(thread.groupId, 'First');
    await gm.sendGroupMessage(thread.groupId, 'Second');

    const msgs = await gm.getGroupMessages(thread.groupId);
    expect(msgs.length).toBe(2);
    expect(msgs[0].createdAt).toBeLessThanOrEqual(msgs[1].createdAt);
    expect(msgs[0].content).toBe('First');
  });

  it('getGroupMessages: filters expired messages', async () => {
    const thread = await gm.createGroup('Expiry Filter', [BOB]);
    const msg = await gm.sendGroupMessage(thread.groupId, 'Expiring', {
      ttl: TTL_PRESETS.FIVE_MINUTES,
      burnAfterRead: false,
    });

    // Patch the message to be expired
    const key = `satnam:group:msgs:${thread.groupId}`;
    const raw = localStorageMock.getItem(key);
    if (raw) {
      const msgs = JSON.parse(raw);
      msgs[0].expiresAt = Math.floor(Date.now() / 1000) - 1; // past
      localStorageMock.setItem(key, JSON.stringify(msgs));
    }

    const result = await gm.getGroupMessages(thread.groupId);
    expect(result.find((m) => m.id === msg.id)).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  /**
   * listGroups sorts by lastActivity descending.
   *
   * GroupChatManager.createGroup stores lastActivity as nowUnix() (seconds
   * precision). A 10ms sleep is not enough to change the unix-second value.
   * Instead, we create both groups and then directly patch the stored
   * lastActivity so Beta has a clearly higher timestamp.
   */
  it('listGroups: returns groups sorted by lastActivity', async () => {
    await gm.createGroup('Alpha', [BOB]);
    await gm.createGroup('Beta', [CAROL]);

    // Patch Beta's lastActivity to be strictly greater than Alpha's.
    // This simulates Beta being more recently active regardless of wall-clock
    // resolution, matching the documented sort order (descending).
    const stored = localStorageMock.getItem('satnam:groups:v2');
    if (stored) {
      const groups: Array<{ config: { name: string }; lastActivity: number }> = JSON.parse(stored);
      const alpha = groups.find((g) => g.config.name === 'Alpha');
      const beta  = groups.find((g) => g.config.name === 'Beta');
      if (alpha && beta) {
        // Ensure Beta has a strictly higher lastActivity
        beta.lastActivity = alpha.lastActivity + 1;
        localStorageMock.setItem('satnam:groups:v2', JSON.stringify(groups));
      }
    }

    const groups = await gm.listGroups();
    expect(groups[0].config.name).toBe('Beta'); // most recent first
  });
});

// ============================================================================
// 9-12. Direct Chat
// ============================================================================

describe('DirectChatManager', () => {
  let dm: DirectChatManager;

  beforeEach(() => {
    localStorageMock.clear();
    _resetDirectChatStore();
    vi.clearAllMocks();
    dm = new DirectChatManager(ALICE, ['wss://nos.lol']);
  });

  it('sendDirectMessage: sends a gift-wrapped DM', async () => {
    const { sendGiftwrappedMessageWithCeps } = await import('../../src/lib/ceps/ceps-client.js');
    await dm.sendDirectMessage(BOB, 'Hello Bob');
    expect(sendGiftwrappedMessageWithCeps).toHaveBeenCalledWith(BOB, 'Hello Bob');
  });

  it('sendDirectMessage: persists message to local store', async () => {
    await dm.sendDirectMessage(BOB, 'Persisted?');
    const msgs = await dm.getDirectMessages(BOB);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('Persisted?');
  });

  it('sendDirectMessage with PoL contact: calls PIN gate before sending', async () => {
    const pinGate = vi.fn().mockResolvedValue(undefined);
    const polDm = new DirectChatManager(ALICE, ['wss://nos.lol'], pinGate);

    await polDm.sendDirectMessage(BOB, 'Secret', undefined, true);
    expect(pinGate).toHaveBeenCalledWith('message_send');
  });

  it('sendDirectMessage with PoL contact: aborts if PIN gate rejects', async () => {
    const pinGate = vi.fn().mockRejectedValue(new Error('PIN rejected'));
    const polDm = new DirectChatManager(ALICE, ['wss://nos.lol'], pinGate);

    await expect(
      polDm.sendDirectMessage(BOB, 'Blocked', undefined, true),
    ).rejects.toThrow('PIN rejected');

    const msgs = await polDm.getDirectMessages(BOB);
    expect(msgs.length).toBe(0);
  });

  it('sendDirectMessage: PoL without pinGate throws', async () => {
    await expect(
      dm.sendDirectMessage(BOB, 'Fail', undefined, true),
    ).rejects.toThrow('PIN gate callback is required');
  });

  it('sendDirectMessage: ephemeral config stored on message', async () => {
    const cfg: EphemeralConfig = { ttl: TTL_PRESETS.FIVE_MINUTES, burnAfterRead: false };
    const msg = await dm.sendDirectMessage(BOB, 'Timed', cfg);
    expect(msg.ephemeral?.ttl).toBe(TTL_PRESETS.FIVE_MINUTES);
    expect(msg.expiresAt).toBeDefined();
  });

  it('markAsRead: updates message status to read', async () => {
    const msg = await dm.sendDirectMessage(BOB, 'Mark me read');
    await dm.markAsRead(msg.id, BOB);

    const msgs = await dm.getDirectMessages(BOB);
    expect(msgs[0].status).toBe('read');
  });

  /**
   * deleteMessage marks the message as deleted: true and publishes a NIP-09
   * kind:5 event. getDirectMessages only filters by expiresAt — it does NOT
   * filter out deleted messages. After deletion, the message is still returned
   * by getDirectMessages but with deleted: true.
   */
  it('deleteMessage: marks message deleted and publishes NIP-09 event', async () => {
    const { publishEventWithCeps } = await import('../../src/lib/ceps/ceps-client.js');
    const msg = await dm.sendDirectMessage(BOB, 'Delete me');
    await dm.deleteMessage(msg.id, BOB);

    const msgs = await dm.getDirectMessages(BOB);
    // getDirectMessages does not filter by deleted flag — message is still present
    const deletedMsg = msgs.find((m) => m.id === msg.id);
    expect(deletedMsg).toBeDefined();
    expect(deletedMsg?.deleted).toBe(true);
    expect(deletedMsg?.status).toBe('deleted');
  });

  it('getDirectMessages: excludes expired messages', async () => {
    const msg = await dm.sendDirectMessage(BOB, 'Expired', {
      ttl: 1,
      burnAfterRead: false,
    });

    // Patch expiry to past
    const key = `satnam:dm:msgs:${BOB}`;
    const raw = localStorageMock.getItem(key);
    if (raw) {
      const msgs = JSON.parse(raw);
      msgs[0].expiresAt = Math.floor(Date.now() / 1000) - 1;
      localStorageMock.setItem(key, JSON.stringify(msgs));
    }

    const result = await dm.getDirectMessages(BOB);
    expect(result.find((m) => m.id === msg.id)).toBeUndefined();
  });
});

// ============================================================================
// 13-20. Ephemeral
// ============================================================================

describe('Ephemeral utilities', () => {
  // Clear storage before each ephemeral test so that processExpiredMessages
  // only sees the keys we set up in that specific test, not leftover keys
  // from earlier GroupChatManager / DirectChatManager tests.
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  it('setMessageTtl: sets expiresAt = createdAt + ttl', () => {
    const msg = makeMessage({ createdAt: BASE_TS });
    const result = setMessageTtl(msg, 3600);

    expect(result.expiresAt).toBe(BASE_TS + 3600);
    expect(result.expirationTag).toBe(BASE_TS + 3600);
    expect(result.ephemeral?.ttl).toBe(3600);
  });

  it('setMessageTtl: TTL of 0 clears expiry', () => {
    const msg = makeMessage({
      createdAt: BASE_TS,
      expiresAt: BASE_TS + 1000,
      ephemeral: { ttl: 1000, burnAfterRead: false },
    });
    const result = setMessageTtl(msg, 0);

    expect(result.expiresAt).toBeUndefined();
    expect(result.expirationTag).toBeUndefined();
    expect(result.ephemeral?.ttl).toBe(0);
  });

  it('buildExpirationTag: returns correct NIP-40 tag format', () => {
    const tag = buildExpirationTag(1_800_000_000);
    expect(tag).toEqual(['expiration', '1800000000']);
  });

  it('parseExpirationTag: extracts expiration from tags array', () => {
    const tags: [string, string][] = [
      ['p', 'abc'],
      ['expiration', '1800000000'],
    ];
    expect(parseExpirationTag(tags)).toBe(1_800_000_000);
  });

  it('parseExpirationTag: returns undefined for missing tag', () => {
    expect(parseExpirationTag([['p', 'abc']])).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  it('setBurnAfterRead: sets burnAfterRead flag', () => {
    const msg = makeMessage();
    const result = setBurnAfterRead(msg);
    expect(result.ephemeral?.burnAfterRead).toBe(true);
  });

  it('setBurnAfterRead: preserves existing TTL', () => {
    const msg = makeMessage({
      ephemeral: { ttl: 3600, burnAfterRead: false },
    });
    const result = setBurnAfterRead(msg);
    expect(result.ephemeral?.ttl).toBe(3600);
    expect(result.ephemeral?.burnAfterRead).toBe(true);
  });

  // --------------------------------------------------------------------------
  it('isExpired: returns true for past expiry', () => {
    const msg = makeMessage({ expiresAt: BASE_TS - 1 });
    expect(isExpired(msg, BASE_TS)).toBe(true);
  });

  it('isExpired: returns false for future expiry', () => {
    const msg = makeMessage({ expiresAt: BASE_TS + 3600 });
    expect(isExpired(msg, BASE_TS)).toBe(false);
  });

  it('isExpired: returns false for message without TTL', () => {
    const msg = makeMessage();
    expect(isExpired(msg, BASE_TS)).toBe(false);
  });

  // --------------------------------------------------------------------------
  it('secondsUntilExpiry: returns 0 for no TTL', () => {
    expect(secondsUntilExpiry(makeMessage())).toBe(0);
  });

  it('formatCountdown: seconds', () => {
    // 45 seconds remaining
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 45 });
    expect(formatCountdown(msg)).toBe('45s');
  });

  it('formatCountdown: minutes', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 125 }); // 2m 5s
    expect(formatCountdown(msg)).toMatch(/^2m/);
  });

  it('formatCountdown: hours', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 7200 }); // 2h
    expect(formatCountdown(msg)).toMatch(/^2h/);
  });

  it('formatCountdown: days', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 172800 }); // 2d
    expect(formatCountdown(msg)).toMatch(/^2d/);
  });

  it('formatCountdown: "Expired" for past expiry', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now - 1 });
    expect(formatCountdown(msg)).toBe('Expired');
  });

  // --------------------------------------------------------------------------
  /**
   * processExpiredMessages scans localStorage for keys matching
   * satnam:(dm:msgs:|group:msgs:) and removes expired/deleted messages.
   *
   * The beforeEach clear ensures only the keys we set here are in storage,
   * so `inspected` reflects exactly the 2 messages we stored.
   */
  it('EphemeralManager.processExpiredMessages: removes expired from storage', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired: Message = makeMessage({
      id: 'exp-1',
      expiresAt: now - 10,
    });
    const live: Message = makeMessage({
      id: 'live-1',
      expiresAt: now + 3600,
    });
    localStorageMock.setItem(
      'satnam:dm:msgs:somecontact',
      JSON.stringify([expired, live]),
    );

    const manager = new EphemeralManager();
    const result = manager.processExpiredMessages();

    expect(result.expiredRemoved).toBe(1);
    expect(result.inspected).toBe(2);

    const remaining = JSON.parse(
      localStorageMock.getItem('satnam:dm:msgs:somecontact')!,
    ) as Message[];
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('live-1');
  });

  it('EphemeralManager.processExpiredMessages: removes deleted messages', () => {
    const deleted: Message = makeMessage({ id: 'del-1', deleted: true });
    localStorageMock.setItem(
      'satnam:group:msgs:grp1',
      JSON.stringify([deleted]),
    );

    const manager = new EphemeralManager();
    const result = manager.processExpiredMessages();

    expect(result.burnedRemoved).toBe(1);
  });

  it('EphemeralManager.filterExpired: excludes expired messages', () => {
    const now = Math.floor(Date.now() / 1000);
    const messages: Message[] = [
      makeMessage({ id: 'm1', expiresAt: now - 1 }),
      makeMessage({ id: 'm2', expiresAt: now + 1000 }),
      makeMessage({ id: 'm3' }), // no TTL
    ];

    const manager = new EphemeralManager();
    const result = manager.filterExpired(messages);
    expect(result.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('EphemeralManager.scheduleAutoDelete: fires callback after delay', async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 1 }); // 1 second from now

    const manager = new EphemeralManager();
    const onExpire = vi.fn();
    const cancel = manager.scheduleAutoDelete(msg, onExpire);

    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1001);
    expect(onExpire).toHaveBeenCalledWith(msg.id);

    cancel();
    vi.useRealTimers();
  });

  it('EphemeralManager.scheduleAutoDelete: cancel prevents callback', async () => {
    vi.useFakeTimers();
    const now = Math.floor(Date.now() / 1000);
    const msg = makeMessage({ expiresAt: now + 5 });

    const manager = new EphemeralManager();
    const onExpire = vi.fn();
    const cancel = manager.scheduleAutoDelete(msg, onExpire);

    cancel();
    vi.advanceTimersByTime(10_000);
    expect(onExpire).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  it('TTL preset factories: ttl5m', () => {
    const cfg = ttl5m();
    expect(cfg.ttl).toBe(TTL_PRESETS.FIVE_MINUTES);
    expect(cfg.burnAfterRead).toBe(false);
  });

  it('TTL preset factories: ttl1h with burnAfterRead', () => {
    const cfg = ttl1h(true);
    expect(cfg.ttl).toBe(TTL_PRESETS.ONE_HOUR);
    expect(cfg.burnAfterRead).toBe(true);
  });

  it('TTL preset factories: ttl24h', () => {
    expect(ttl24h().ttl).toBe(TTL_PRESETS.ONE_DAY);
  });

  it('TTL preset factories: ttl7d', () => {
    expect(ttl7d().ttl).toBe(TTL_PRESETS.SEVEN_DAYS);
  });

  it('TTL preset factories: ttlCustom', () => {
    const cfg = ttlCustom(600, true);
    expect(cfg.ttl).toBe(600);
    expect(cfg.burnAfterRead).toBe(true);
  });

  it('ttlCustom: throws for non-positive TTL', () => {
    expect(() => ttlCustom(0)).toThrow('TTL must be greater than 0');
    expect(() => ttlCustom(-1)).toThrow('TTL must be greater than 0');
  });
});
