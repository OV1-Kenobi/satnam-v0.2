/**
 * @module hooks/useMessaging
 * @description React hook for Satnam v2 messaging functionality.
 *
 * Provides:
 * - threads: all message threads (DM + group), sorted by lastActivity
 * - messages: messages for the activeThread
 * - sendMessage: send to the active thread (DM or group)
 * - createGroup: create a new group
 * - addMember / removeMember: group membership management
 * - markRead: mark a message as read
 * - setEphemeral: apply ephemeral config to next outbound message
 * - activeThread / setActiveThread: thread selection
 * - isLoading: loading state
 *
 * No new production dependencies.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import type {
  MessageThread,
  Message,
  EphemeralConfig,
  GroupConfig,
  DirectThread,
  GroupThread,
} from '../lib/messaging/types.js';

import { GroupChatManager } from '../lib/messaging/group-chat.js';
import { DirectChatManager } from '../lib/messaging/direct-chat.js';
import {
  ephemeralManager,
  setMessageTtl,
  setBurnAfterRead,
} from '../lib/messaging/ephemeral.js';
import type { PinGateCallback } from '../lib/messaging/direct-chat.js';

// ============================================================================
// Types
// ============================================================================

export interface UseMessagingOptions {
  /** hex pubkey of the local user */
  localPubkeyHex: string;
  /** Relay URLs override */
  relays?: string[];
  /** PIN gate callback for PoL-verified DMs */
  pinGate?: PinGateCallback;
  /** Auto-refresh interval in ms (default: 30000) */
  refreshInterval?: number;
}

export interface UseMessagingReturn {
  /** All threads sorted by lastActivity */
  threads: MessageThread[];
  /** Messages for the currently active thread */
  messages: Message[];
  /** Send a message to the active thread */
  sendMessage: (content: string, ephemeralConfig?: EphemeralConfig) => Promise<void>;
  /** Create a new group and switch to it */
  createGroup: (
    name: string,
    memberPubkeys: string[],
    config?: Partial<Pick<GroupConfig, 'relayUrls' | 'avatar' | 'description'>>,
  ) => Promise<GroupThread>;
  /** Add a member to a group (admin only) */
  addMember: (groupId: string, pubkeyHex: string) => Promise<void>;
  /** Remove a member from a group (admin only) */
  removeMember: (groupId: string, pubkeyHex: string) => Promise<void>;
  /** Mark a message as read in the active thread */
  markRead: (messageId: string) => Promise<void>;
  /** Set ephemeral config that will be applied to the next outbound message */
  setEphemeral: (config: EphemeralConfig | undefined) => void;
  /** Currently selected thread */
  activeThread: MessageThread | null;
  /** Select a thread by id */
  setActiveThread: (threadId: string | null) => void;
  /** Whether any async operation is in flight */
  isLoading: boolean;
  /** Last error (cleared on next action) */
  error: string | null;
  /** Manually refresh threads and messages */
  refresh: () => void;
}

// ============================================================================
// useMessaging hook
// ============================================================================

export function useMessaging({
  localPubkeyHex,
  relays,
  pinGate,
  refreshInterval = 30_000,
}: UseMessagingOptions): UseMessagingReturn {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEphemeral, setPendingEphemeral] = useState<
    EphemeralConfig | undefined
  >(undefined);

  // Stable manager refs — recreated only when localPubkeyHex / relays change
  const groupManagerRef = useRef<GroupChatManager | null>(null);
  const directManagerRef = useRef<DirectChatManager | null>(null);

  if (!groupManagerRef.current || groupManagerRef.current['localPubkeyHex'] !== localPubkeyHex) {
    groupManagerRef.current = new GroupChatManager(localPubkeyHex, relays);
  }
  if (!directManagerRef.current || directManagerRef.current['localPubkeyHex'] !== localPubkeyHex) {
    directManagerRef.current = new DirectChatManager(
      localPubkeyHex,
      relays,
      pinGate,
    );
  }

  // --------------------------------------------------------------------------
  // Load threads
  // --------------------------------------------------------------------------

  const loadThreads = useCallback(async () => {
    const gm = groupManagerRef.current!;
    const dm = directManagerRef.current!;

    const [groupThreads, directThreads] = await Promise.all([
      gm.listGroups(),
      Promise.resolve(dm.listThreads()),
    ]);

    const allThreads: MessageThread[] = [
      ...groupThreads,
      ...directThreads,
    ].sort((a, b) => b.lastActivity - a.lastActivity);

    setThreads(allThreads);
  }, []);

  // --------------------------------------------------------------------------
  // Load messages for active thread
  // --------------------------------------------------------------------------

  const loadMessages = useCallback(
    async (threadId: string | null) => {
      if (!threadId) {
        setMessages([]);
        return;
      }

      const gm = groupManagerRef.current!;
      const dm = directManagerRef.current!;

      // Determine thread type from loaded threads
      const thread = threads.find((t) => t.id === threadId);
      let msgs: Message[] = [];

      if (thread?.type === 'group') {
        msgs = await gm.getGroupMessages(threadId);
      } else if (thread?.type === 'direct') {
        msgs = await dm.getDirectMessages(
          (thread as DirectThread).recipientPubkey,
        );
      }

      // Filter expired ephemeral messages
      setMessages(ephemeralManager.filterExpired(msgs));
    },
    [threads],
  );

  // --------------------------------------------------------------------------
  // Initial load + refresh interval
  // --------------------------------------------------------------------------

  useEffect(() => {
    void loadThreads();
  }, [localPubkeyHex]);

  useEffect(() => {
    void loadMessages(activeThreadId);
  }, [activeThreadId, threads]);

  useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(() => {
      void loadThreads();
      if (activeThreadId) {
        void loadMessages(activeThreadId);
      }
      // Run ephemeral GC on each refresh
      ephemeralManager.processExpiredMessages();
    }, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, activeThreadId, loadThreads, loadMessages]);

  // --------------------------------------------------------------------------
  // setActiveThread
  // --------------------------------------------------------------------------

  const setActiveThread = useCallback((threadId: string | null) => {
    setActiveThreadId(threadId);
  }, []);

  // --------------------------------------------------------------------------
  // sendMessage
  // --------------------------------------------------------------------------

  const sendMessage = useCallback(
    async (content: string, ephemeralConfig?: EphemeralConfig) => {
      if (!activeThreadId) throw new Error('No active thread selected');

      const gm = groupManagerRef.current!;
      const dm = directManagerRef.current!;
      const effectiveEphemeral = ephemeralConfig ?? pendingEphemeral;

      setIsLoading(true);
      setError(null);

      try {
        const thread = threads.find((t) => t.id === activeThreadId);

        if (thread?.type === 'group') {
          const msg = await gm.sendGroupMessage(
            (thread as GroupThread).groupId,
            content,
            effectiveEphemeral,
          );
          setMessages((prev) => [...prev, msg]);
        } else if (thread?.type === 'direct') {
          const dt = thread as DirectThread;
          const msg = await dm.sendDirectMessage(
            dt.recipientPubkey,
            content,
            effectiveEphemeral,
            dt.polVerified,
          );
          setMessages((prev) => [...prev, msg]);
        }

        // Clear pending ephemeral after send
        if (pendingEphemeral) setPendingEphemeral(undefined);

        // Refresh threads to update lastActivity / preview
        await loadThreads();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [activeThreadId, pendingEphemeral, threads, loadThreads],
  );

  // --------------------------------------------------------------------------
  // createGroup
  // --------------------------------------------------------------------------

  const createGroup = useCallback(
    async (
      name: string,
      memberPubkeys: string[],
      config?: Partial<Pick<GroupConfig, 'relayUrls' | 'avatar' | 'description'>>,
    ): Promise<GroupThread> => {
      const gm = groupManagerRef.current!;

      setIsLoading(true);
      setError(null);

      try {
        const thread = await gm.createGroup(name, memberPubkeys, config);
        await loadThreads();
        setActiveThreadId(thread.id);
        return thread;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadThreads],
  );

  // --------------------------------------------------------------------------
  // addMember
  // --------------------------------------------------------------------------

  const addMember = useCallback(
    async (groupId: string, pubkeyHex: string) => {
      const gm = groupManagerRef.current!;

      setIsLoading(true);
      setError(null);

      try {
        await gm.addMember(groupId, pubkeyHex);
        await loadThreads();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadThreads],
  );

  // --------------------------------------------------------------------------
  // removeMember
  // --------------------------------------------------------------------------

  const removeMember = useCallback(
    async (groupId: string, pubkeyHex: string) => {
      const gm = groupManagerRef.current!;

      setIsLoading(true);
      setError(null);

      try {
        await gm.removeMember(groupId, pubkeyHex);
        await loadThreads();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [loadThreads],
  );

  // --------------------------------------------------------------------------
  // markRead
  // --------------------------------------------------------------------------

  const markRead = useCallback(
    async (messageId: string) => {
      const dm = directManagerRef.current!;
      const thread = threads.find((t) => t.id === activeThreadId);

      if (thread?.type === 'direct') {
        await dm.markAsRead(messageId, (thread as DirectThread).recipientPubkey);
        // Update local message status
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, status: 'read' as const } : m,
          ),
        );
      }
      // Group read receipts: future implementation
    },
    [activeThreadId, threads],
  );

  // --------------------------------------------------------------------------
  // setEphemeral
  // --------------------------------------------------------------------------

  const setEphemeral = useCallback((config: EphemeralConfig | undefined) => {
    setPendingEphemeral(config);
  }, []);

  // --------------------------------------------------------------------------
  // refresh
  // --------------------------------------------------------------------------

  const refresh = useCallback(() => {
    void loadThreads();
    if (activeThreadId) void loadMessages(activeThreadId);
  }, [loadThreads, loadMessages, activeThreadId]);

  // --------------------------------------------------------------------------
  // Derived activeThread
  // --------------------------------------------------------------------------

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  return {
    threads,
    messages,
    sendMessage,
    createGroup,
    addMember,
    removeMember,
    markRead,
    setEphemeral,
    activeThread,
    setActiveThread,
    isLoading,
    error,
    refresh,
  };
}
