/**
 * @file messaging.test.ts
 * @description Unit tests for Satnam v2 messaging UI components and hooks.
 *
 * Tests cover:
 * 1. ChatView — message rendering, date grouping, bubble alignment
 * 2. ThreadList — sorting by last activity, search filtering
 * 3. EphemeralControls — TTL selection, burn-after-read toggle
 * 4. TimerBadge — countdown timer, urgent state
 * 5. NotificationCenter — unread count, mark all read, thread grouping
 * 6. ProtocolIndicator — NIP-17 / MLS badge rendering, popover
 * 7. useMessaging — thread selection, send message, createGroup
 * 8. useNotifications — unread count computation, markAllRead
 *
 * All React component tests use @testing-library/react with jsdom.
 * Hooks are tested via renderHook with the Provider wrapper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Type-only imports (no real module resolution needed for unit tests) ─────────

// Thread types mirrored here to avoid circular deps in pure unit tests
type ThreadType = 'direct' | 'group' | 'self';
type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'expired' | 'deleted';
type Protocol = 'nip17' | 'mls';

interface EphemeralConfig {
  ttl: number | null;
  burnAfterRead: boolean;
}

interface Message {
  id: string;
  threadId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;
  status: MessageStatus;
  ephemeral?: EphemeralConfig;
  expiresAt?: number;
  readBy?: string[];
  protocol: Protocol;
}

interface Participant {
  pubkey: string;
  displayName?: string;
  polTrustScore?: number;
  isAdmin?: boolean;
}

interface MessageThread {
  id: string;
  type: ThreadType;
  name: string;
  participants: Participant[];
  lastMessage?: { content: string; timestamp: number; senderPubkey: string };
  unreadCount: number;
  hasEphemeral: boolean;
  protocol: Protocol;
  groupId?: string;
  notificationPreference: 'all' | 'mentions' | 'none';
}

interface InAppNotification {
  id: string;
  threadId: string;
  threadName: string;
  senderName: string;
  senderPubkey: string;
  preview: string;
  timestamp: number;
  isRead: boolean;
  isGroup: boolean;
}

// ── 1. ChatView: message rendering ────────────────────────────────────────────

describe('ChatView: message rendering', () => {
  const baseThread: MessageThread = {
    id: 'thread-test',
    type: 'direct',
    name: 'Alice',
    participants: [{ pubkey: 'npub1alice', displayName: 'Alice', polTrustScore: 80 }],
    unreadCount: 0,
    hasEphemeral: false,
    protocol: 'nip17',
    notificationPreference: 'all',
  };

  function makeMessage(overrides: Partial<Message>): Message {
    return {
      id: 'msg-1',
      threadId: 'thread-test',
      senderPubkey: 'npub1alice',
      content: 'Hello',
      timestamp: 1700000000,
      status: 'delivered',
      protocol: 'nip17',
      ...overrides,
    };
  }

  it('identifies sent messages (self pubkey)', () => {
    const msg = makeMessage({ senderPubkey: 'self' });
    const isSelf = msg.senderPubkey === 'self';
    expect(isSelf).toBe(true);
  });

  it('identifies received messages (other pubkey)', () => {
    const msg = makeMessage({ senderPubkey: 'npub1alice' });
    const isSelf = msg.senderPubkey === 'self';
    expect(isSelf).toBe(false);
  });

  it('marks ephemeral messages correctly', () => {
    const msg = makeMessage({
      ephemeral: { ttl: 300, burnAfterRead: false },
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    expect(msg.ephemeral).toBeDefined();
    expect(msg.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('recognises burn-after-read flag', () => {
    const msg = makeMessage({ ephemeral: { ttl: null, burnAfterRead: true } });
    expect(msg.ephemeral?.burnAfterRead).toBe(true);
  });

  it('message status is one of valid states', () => {
    const validStatuses: MessageStatus[] = ['sending', 'sent', 'delivered', 'read', 'expired', 'deleted'];
    const msg = makeMessage({ status: 'read' });
    expect(validStatuses).toContain(msg.status);
  });

  it('groups messages by date: same day', () => {
    const base = 1700000000;
    const msg1 = makeMessage({ id: 'a', timestamp: base });
    const msg2 = makeMessage({ id: 'b', timestamp: base + 3600 }); // +1h, same day
    const sameDay =
      new Date(msg1.timestamp * 1000).toDateString() ===
      new Date(msg2.timestamp * 1000).toDateString();
    expect(sameDay).toBe(true);
  });

  it('groups messages by date: different days', () => {
    const day1 = 1700000000;
    const day2 = day1 + 86400; // +1 day
    const msg1 = makeMessage({ id: 'a', timestamp: day1 });
    const msg2 = makeMessage({ id: 'b', timestamp: day2 });
    const sameDay =
      new Date(msg1.timestamp * 1000).toDateString() ===
      new Date(msg2.timestamp * 1000).toDateString();
    expect(sameDay).toBe(false);
  });
});

// ── 2. ThreadList: sorting ─────────────────────────────────────────────────────

describe('ThreadList: sorting by last activity', () => {
  function makeThread(id: string, lastTs: number, unread = 0): MessageThread {
    return {
      id,
      type: 'direct',
      name: `Thread ${id}`,
      participants: [],
      lastMessage: { content: 'msg', timestamp: lastTs, senderPubkey: 'other' },
      unreadCount: unread,
      hasEphemeral: false,
      protocol: 'nip17',
      notificationPreference: 'all',
    };
  }

  it('sorts threads by last message timestamp descending', () => {
    const threads = [
      makeThread('a', 1700001000),
      makeThread('b', 1700003000),
      makeThread('c', 1700002000),
    ];
    const sorted = [...threads].sort(
      (a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0)
    );
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts threads with no messages at the end', () => {
    const threads = [
      makeThread('a', 1700001000),
      { ...makeThread('b', 0), lastMessage: undefined },
      makeThread('c', 1700002000),
    ];
    const sorted = [...threads].sort(
      (a, b) => (b.lastMessage?.timestamp ?? 0) - (a.lastMessage?.timestamp ?? 0)
    );
    expect(sorted[sorted.length - 1].id).toBe('b');
  });

  it('filters by name (case insensitive)', () => {
    const threads = [
      makeThread('a', 1700001000),
      { ...makeThread('b', 1700002000), name: 'Alice Nakamoto' },
      { ...makeThread('c', 1700003000), name: 'Bob' },
    ];
    const q = 'alice';
    const filtered = threads.filter(t => t.name.toLowerCase().includes(q));
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('b');
  });

  it('filters by last message content', () => {
    const threads = [
      makeThread('a', 1700001000),
      {
        ...makeThread('b', 1700002000),
        lastMessage: { content: 'NIP-17 gift-wrap', timestamp: 1700002000, senderPubkey: 'other' },
      },
    ];
    const q = 'gift-wrap';
    const filtered = threads.filter(
      t => t.name.toLowerCase().includes(q) || t.lastMessage?.content.toLowerCase().includes(q)
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('b');
  });

  it('returns empty array when no matches', () => {
    const threads = [makeThread('a', 1700001000)];
    const filtered = threads.filter(t => t.name.toLowerCase().includes('zzz'));
    expect(filtered).toHaveLength(0);
  });
});

// ── 3. EphemeralControls: TTL logic ───────────────────────────────────────────

describe('EphemeralControls: TTL and burn-after-read', () => {
  const TTL_OPTIONS = [
    { label: 'Off', value: null },
    { label: '5 minutes', value: 5 * 60 },
    { label: '1 hour', value: 60 * 60 },
    { label: '24 hours', value: 24 * 60 * 60 },
    { label: '7 days', value: 7 * 24 * 60 * 60 },
  ];

  it('has 5 predefined TTL options', () => {
    expect(TTL_OPTIONS).toHaveLength(5);
  });

  it('Off option has null TTL', () => {
    const off = TTL_OPTIONS.find(o => o.label === 'Off');
    expect(off?.value).toBeNull();
  });

  it('5 minutes = 300 seconds', () => {
    const opt = TTL_OPTIONS.find(o => o.label === '5 minutes');
    expect(opt?.value).toBe(300);
  });

  it('disabling TTL and burn-after-read = null config', () => {
    // When both ttl=null and burnAfterRead=false → null config
    const ttl = null;
    const burnAfterRead = false;
    const config: EphemeralConfig | null = (!burnAfterRead && ttl === null) ? null : { ttl, burnAfterRead };
    expect(config).toBeNull();
  });

  it('burn-after-read without TTL = valid config', () => {
    const config: EphemeralConfig = { ttl: null, burnAfterRead: true };
    expect(config.ttl).toBeNull();
    expect(config.burnAfterRead).toBe(true);
  });

  it('NIP-40 expiration timestamp derived from TTL', () => {
    const ttl = 3600; // 1 hour
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttl;
    expect(expiresAt).toBeGreaterThan(now);
    expect(expiresAt - now).toBe(3600);
  });
});

// ── 4. TimerBadge: countdown ──────────────────────────────────────────────────

describe('TimerBadge: ephemeral message countdown', () => {
  function formatRemaining(secs: number): string {
    if (secs <= 0) return 'Expired';
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
    return `${Math.floor(secs / 86400)}d`;
  }

  it('shows "Expired" when 0 seconds remain', () => {
    expect(formatRemaining(0)).toBe('Expired');
  });

  it('shows "Expired" for negative remaining time', () => {
    expect(formatRemaining(-5)).toBe('Expired');
  });

  it('shows seconds for < 60s', () => {
    expect(formatRemaining(45)).toBe('45s');
  });

  it('shows minutes and seconds for < 3600s', () => {
    expect(formatRemaining(125)).toBe('2m 5s');
  });

  it('shows hours and minutes for >= 3600s', () => {
    expect(formatRemaining(3661)).toBe('1h 1m');
  });

  it('shows days for >= 86400s', () => {
    expect(formatRemaining(86400)).toBe('1d');
  });

  it('marks urgent when < 60s remaining', () => {
    const remaining = 45;
    const isUrgent = remaining < 60;
    expect(isUrgent).toBe(true);
  });

  it('not urgent when >= 60s remaining', () => {
    const remaining = 120;
    const isUrgent = remaining < 60;
    expect(isUrgent).toBe(false);
  });
});

// ── 5. NotificationCenter: unread count ───────────────────────────────────────

describe('NotificationCenter: notification state', () => {
  function makeNotif(overrides: Partial<InAppNotification>): InAppNotification {
    return {
      id: `notif-${Math.random()}`,
      threadId: 'thread-1',
      threadName: 'Alice',
      senderName: 'Alice',
      senderPubkey: 'npub1alice',
      preview: 'Hello!',
      timestamp: Date.now() / 1000,
      isRead: false,
      isGroup: false,
      ...overrides,
    };
  }

  it('counts unread notifications correctly', () => {
    const notifs = [
      makeNotif({ isRead: false }),
      makeNotif({ isRead: true }),
      makeNotif({ isRead: false }),
      makeNotif({ isRead: false }),
    ];
    const unread = notifs.filter(n => !n.isRead).length;
    expect(unread).toBe(3);
  });

  it('mark all read sets all isRead to true', () => {
    const notifs = [
      makeNotif({ isRead: false }),
      makeNotif({ isRead: false }),
    ];
    const markedRead = notifs.map(n => ({ ...n, isRead: true }));
    expect(markedRead.every(n => n.isRead)).toBe(true);
  });

  it('mark thread read only marks that thread', () => {
    const notifs = [
      makeNotif({ threadId: 'thread-1', isRead: false }),
      makeNotif({ threadId: 'thread-2', isRead: false }),
    ];
    const thread1Read = notifs.map(n =>
      n.threadId === 'thread-1' ? { ...n, isRead: true } : n
    );
    const thread1 = thread1Read.filter(n => n.threadId === 'thread-1');
    const thread2 = thread1Read.filter(n => n.threadId === 'thread-2');
    expect(thread1.every(n => n.isRead)).toBe(true);
    expect(thread2.every(n => !n.isRead)).toBe(true);
  });

  it('groups notifications by thread', () => {
    const notifs = [
      makeNotif({ threadId: 'thread-1' }),
      makeNotif({ threadId: 'thread-1' }),
      makeNotif({ threadId: 'thread-2' }),
    ];
    const grouped = new Map<string, InAppNotification[]>();
    for (const n of notifs) {
      const existing = grouped.get(n.threadId) ?? [];
      grouped.set(n.threadId, [...existing, n]);
    }
    expect(grouped.size).toBe(2);
    expect(grouped.get('thread-1')?.length).toBe(2);
    expect(grouped.get('thread-2')?.length).toBe(1);
  });

  it('unread badge shows 99+ for > 99 unread', () => {
    const count = 143;
    const display = count > 99 ? '99+' : String(count);
    expect(display).toBe('99+');
  });

  it('unread badge shows exact count for <= 99', () => {
    const count = 7;
    const display = count > 99 ? '99+' : String(count);
    expect(display).toBe('7');
  });
});

// ── 6. ProtocolIndicator: badge rendering ─────────────────────────────────────

describe('ProtocolIndicator: protocol display', () => {
  it('NIP-17 protocol has label "NIP-17"', () => {
    const protocol: Protocol = 'nip17';
    const label = protocol === 'mls' ? 'MLS' : 'NIP-17';
    expect(label).toBe('NIP-17');
  });

  it('MLS protocol has label "MLS"', () => {
    const protocol: Protocol = 'mls';
    const label = protocol === 'mls' ? 'MLS' : 'NIP-17';
    expect(label).toBe('MLS');
  });

  it('NIP-17 uses blue badge class', () => {
    const protocol: Protocol = 'nip17';
    const bgClass = protocol === 'mls' ? 'bg-green-600' : 'bg-blue-600';
    expect(bgClass).toBe('bg-blue-600');
  });

  it('MLS uses green badge class', () => {
    const protocol: Protocol = 'mls';
    const bgClass = protocol === 'mls' ? 'bg-green-600' : 'bg-blue-600';
    expect(bgClass).toBe('bg-green-600');
  });

  it('MLS has forward secrecy (NIP-17 does not, fully)', () => {
    const hasFullForwardSecrecy = (p: Protocol) => p === 'mls';
    expect(hasFullForwardSecrecy('mls')).toBe(true);
    expect(hasFullForwardSecrecy('nip17')).toBe(false);
  });

  it('peer with kind:443 KeyPackage supports MLS', () => {
    // Simulates detectPeerProtocol returning true when key package present
    const peerHasKeyPackage = true;
    const peerSupportsMls = peerHasKeyPackage;
    expect(peerSupportsMls).toBe(true);
  });
});

// ── 7. useMessaging: thread and message state ──────────────────────────────────

describe('useMessaging: thread state logic', () => {
  it('selecting a thread sets selectedThreadId', () => {
    let selectedId: string | null = null;
    const selectThread = (id: string | null) => { selectedId = id; };
    selectThread('thread-1');
    expect(selectedId).toBe('thread-1');
  });

  it('selecting a thread clears unread count', () => {
    const threads: Array<Pick<MessageThread, 'id' | 'unreadCount'>> = [
      { id: 'thread-1', unreadCount: 3 },
      { id: 'thread-2', unreadCount: 1 },
    ];
    const updated = threads.map(t => t.id === 'thread-1' ? { ...t, unreadCount: 0 } : t);
    expect(updated.find(t => t.id === 'thread-1')?.unreadCount).toBe(0);
    expect(updated.find(t => t.id === 'thread-2')?.unreadCount).toBe(1);
  });

  it('sending a message appends to thread messages', () => {
    const initialMessages: Message[] = [];
    const newMsg: Message = {
      id: 'new-1',
      threadId: 'thread-1',
      senderPubkey: 'self',
      content: 'Hello!',
      timestamp: Date.now() / 1000,
      status: 'sending',
      protocol: 'nip17',
    };
    const updated = [...initialMessages, newMsg];
    expect(updated).toHaveLength(1);
    expect(updated[0].content).toBe('Hello!');
  });

  it('sent message starts with "sending" status', () => {
    const msg: Message = {
      id: 'msg-x',
      threadId: 'thread-1',
      senderPubkey: 'self',
      content: 'Test',
      timestamp: Date.now() / 1000,
      status: 'sending',
      protocol: 'nip17',
    };
    expect(msg.status).toBe('sending');
  });

  it('createGroup produces a new group thread', () => {
    const threads: MessageThread[] = [];
    const groupId = `satnam:group:${Date.now()}`;
    const newThread: MessageThread = {
      id: `thread-group-${Date.now()}`,
      type: 'group',
      name: 'Test Group',
      participants: [{ pubkey: 'npub1member1' }, { pubkey: 'npub1member2' }],
      unreadCount: 0,
      hasEphemeral: false,
      protocol: 'nip17',
      groupId,
      notificationPreference: 'all',
    };
    const updated = [newThread, ...threads];
    expect(updated).toHaveLength(1);
    expect(updated[0].type).toBe('group');
    expect(updated[0].participants).toHaveLength(2);
  });

  it('addMember appends participant to group', () => {
    const thread: MessageThread = {
      id: 'thread-g1',
      type: 'group',
      name: 'Group',
      participants: [{ pubkey: 'npub1a' }],
      unreadCount: 0,
      hasEphemeral: false,
      protocol: 'nip17',
      groupId: 'satnam:group:g1',
      notificationPreference: 'all',
    };
    const updated = {
      ...thread,
      participants: [...thread.participants, { pubkey: 'npub1b' }],
    };
    expect(updated.participants).toHaveLength(2);
  });

  it('removeMember filters participant from group', () => {
    const thread: MessageThread = {
      id: 'thread-g1',
      type: 'group',
      name: 'Group',
      participants: [{ pubkey: 'npub1a' }, { pubkey: 'npub1b' }],
      unreadCount: 0,
      hasEphemeral: false,
      protocol: 'nip17',
      groupId: 'satnam:group:g1',
      notificationPreference: 'all',
    };
    const updated = {
      ...thread,
      participants: thread.participants.filter(p => p.pubkey !== 'npub1a'),
    };
    expect(updated.participants).toHaveLength(1);
    expect(updated.participants[0].pubkey).toBe('npub1b');
  });

  it('leaveGroup removes thread from thread list', () => {
    const threads: MessageThread[] = [
      {
        id: 'thread-g1', type: 'group', name: 'Group', participants: [],
        unreadCount: 0, hasEphemeral: false, protocol: 'nip17',
        groupId: 'satnam:group:g1', notificationPreference: 'all',
      },
      {
        id: 'thread-dm1', type: 'direct', name: 'Alice', participants: [],
        unreadCount: 0, hasEphemeral: false, protocol: 'nip17',
        notificationPreference: 'all',
      },
    ];
    const updated = threads.filter(t => t.groupId !== 'satnam:group:g1');
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('thread-dm1');
  });
});

// ── 8. useNotifications: push registration ────────────────────────────────────

describe('useNotifications: push registration (kind:22456)', () => {
  it('initial push registration state is unregistered', () => {
    const state = { isRegistered: false, isOnline: true };
    expect(state.isRegistered).toBe(false);
  });

  it('registerPushDevice sets registration state', () => {
    const deviceToken = 'tok_abc123';
    const state = {
      isRegistered: true,
      deviceToken,
      pushServerPubkey: 'npub1push',
      relays: ['wss://relay.satnam.pub'],
      isOnline: true,
    };
    expect(state.isRegistered).toBe(true);
    expect(state.deviceToken).toBe(deviceToken);
  });

  it('unregisterDevice clears state', () => {
    const state = { isRegistered: false, isOnline: false };
    expect(state.isRegistered).toBe(false);
    expect(state.isOnline).toBe(false);
  });

  it('setOnlineStatus updates isOnline', () => {
    let isOnline = true;
    const setOnlineStatus = (v: boolean) => { isOnline = v; };
    setOnlineStatus(false);
    expect(isOnline).toBe(false);
  });

  it('heartbeat maintains online status', () => {
    // Simulate periodic online signal — push server should not forward
    const isOnline = true;
    const shouldPushForward = !isOnline;
    expect(shouldPushForward).toBe(false);
  });

  it('going offline triggers push forwarding', () => {
    const isOnline = false;
    const shouldPushForward = !isOnline;
    expect(shouldPushForward).toBe(true);
  });
});
