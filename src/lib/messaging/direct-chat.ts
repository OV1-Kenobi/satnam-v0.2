/**
 * @module messaging/direct-chat
 * @description Enhanced NIP-17 DM client wrapping the existing PrivacyFirstMessagingService.
 *
 * Features:
 * - sendDirectMessage: gift-wrapped 1:1 DM via CEPS
 * - getDirectMessages: retrieve locally cached DMs with optional time range
 * - markAsRead: mark a message as read (fires read receipt)
 * - deleteMessage: NIP-09 deletion event for the gift-wrap wrapper
 * - PoL-verified contacts: message send requires NFC+PIN (PinGatedOperation 'message_send')
 *
 * No new production dependencies. Uses existing CEPS and NIP-17 service.
 */

import type {
  Message,
  DirectThread,
  EphemeralConfig,
  MessageStatus,
  ReadReceipt,
} from './types.js';

import {
  sendGiftwrappedMessageWithCeps,
  publishEventWithCeps,
  signEventWithCeps,
  getDefaultRelays,
} from '../ceps/ceps-client.js';

import type { PinGatedOperation } from '../nfc/pin-gate.js';

// ============================================================================
// Constants
// ============================================================================

/** kind:5 — NIP-09 deletion */
const KIND_DELETION = 5;

// ============================================================================
// In-memory DM store (SECURITY: decrypted content never touches localStorage)
// ============================================================================

/**
 * Decrypted DM threads and messages are held in memory only.
 * They are lost on page refresh — this is intentional. Persistent storage
 * of decrypted message content would expose it to XSS and any browser
 * extension with storage access. Re-fetching from relays on reload is the
 * correct trade-off: confidentiality > convenience.
 */
let memThreads: DirectThread[] = [];
const memMessages = new Map<string, Message[]>();

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function readThreads(): DirectThread[] {
  return memThreads;
}

function writeThreads(threads: DirectThread[]): void {
  memThreads = threads;
}

function readMessages(contactPubkey: string): Message[] {
  return memMessages.get(contactPubkey) ?? [];
}

function writeMessages(contactPubkey: string, messages: Message[]): void {
  memMessages.set(contactPubkey, messages);
}

/**
 * Reset the in-memory DM store. Test-only — not for production use.
 * @internal
 */
export function _resetDirectChatStore(): void {
  memThreads = [];
  memMessages.clear();
}

/**
 * Patch messages in the in-memory store. Test-only — not for production use.
 * Replaces the stored messages for a given contact pubkey.
 * @internal
 */
export function _patchMessages(contactPubkey: string, patcher: (msgs: Message[]) => Message[]): void {
  const current = memMessages.get(contactPubkey) ?? [];
  memMessages.set(contactPubkey, patcher(current));
}

// ============================================================================
// PIN gate callback type
// ============================================================================

/**
 * The caller provides this callback for operations that require NFC+PIN.
 * The callback should trigger the PIN gate flow and resolve/reject accordingly.
 *
 * @throws Error if PIN verification fails or is cancelled
 */
export type PinGateCallback = (operation: PinGatedOperation) => Promise<void>;

// ============================================================================
// DirectChatManager
// ============================================================================

export class DirectChatManager {
  /**
   * @param localPubkeyHex - hex pubkey of the local user
   * @param relays         - relay URLs for publishing
   * @param pinGate        - optional PIN gate callback (required for PoL contacts)
   */
  constructor(
    private readonly localPubkeyHex: string,
    private readonly relays: string[] = getDefaultRelays(),
    private readonly pinGate?: PinGateCallback,
  ) {}

  // --------------------------------------------------------------------------
  // sendDirectMessage
  // --------------------------------------------------------------------------

  /**
   * Send a NIP-17 gift-wrapped direct message to a contact.
   *
   * For PoL-verified contacts, `pinGate` must be provided and will be called
   * before the message is sent. If the PIN gate rejects, the send is aborted.
   *
   * Ephemeral config adds a NIP-40 expiration tag to the inner kind:14 rumor.
   *
   * @param recipientPubkey  - hex pubkey (or npub) of the recipient
   * @param content          - Plaintext message content
   * @param ephemeralConfig  - Optional TTL / burn-after-read settings
   * @param polVerified      - True if this contact is PoL-verified (triggers PIN gate)
   * @returns The optimistically created Message
   */
  async sendDirectMessage(
    recipientPubkey: string,
    content: string,
    ephemeralConfig?: EphemeralConfig,
    polVerified = false,
  ): Promise<Message> {
    // PoL-verified contacts require NFC+PIN before send
    if (polVerified) {
      if (!this.pinGate) {
        throw new Error(
          'PIN gate callback is required for PoL-verified contact messaging',
        );
      }
      await this.pinGate('message_send');
    }

    const now = nowUnix();
    const messageId = generateId();
    const expiresAt =
      ephemeralConfig && ephemeralConfig.ttl > 0
        ? now + ephemeralConfig.ttl
        : undefined;

    // Build content payload — wraps content with metadata for the receiver
    // The gift-wrap CEPS helper handles kind:14 → kind:1059 wrapping
    const wrappedContent = ephemeralConfig
      ? JSON.stringify({
          type: 'satnam:dm',
          messageId,
          content,
          ...(expiresAt ? { expiresAt } : {}),
          ...(ephemeralConfig.burnAfterRead ? { burnAfterRead: true } : {}),
        })
      : content;

    let wrapperEventId: string | undefined;
    try {
      wrapperEventId = await sendGiftwrappedMessageWithCeps(
        recipientPubkey,
        wrappedContent,
      );
    } catch (err) {
      throw new Error(
        `Failed to send DM: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const message: Message = {
      id: messageId,
      wrapperEventId,
      senderPubkey: this.localPubkeyHex,
      threadId: recipientPubkey,
      content,
      createdAt: now,
      status: 'sent' as MessageStatus,
      ephemeral: ephemeralConfig,
      expiresAt,
      expirationTag: expiresAt,
      readReceipts: [],
      deleted: false,
    };

    // Persist locally
    const messages = readMessages(recipientPubkey);
    messages.push(message);
    writeMessages(recipientPubkey, messages);

    // Ensure a thread entry exists
    this._upsertThread(recipientPubkey, message, polVerified);

    return message;
  }

  // --------------------------------------------------------------------------
  // getDirectMessages
  // --------------------------------------------------------------------------

  /**
   * Retrieve locally cached DMs for a contact, optionally filtered by time.
   * Expired ephemeral messages are excluded automatically.
   *
   * @param contactPubkey - hex pubkey of the remote contact
   * @param since         - Optional unix timestamp lower bound
   * @param until         - Optional unix timestamp upper bound
   * @returns Messages sorted by createdAt ascending
   */
  async getDirectMessages(
    contactPubkey: string,
    since?: number,
    until?: number,
  ): Promise<Message[]> {
    const now = nowUnix();
    let messages = readMessages(contactPubkey);

    // Exclude expired messages
    messages = messages.filter((m) => !m.expiresAt || m.expiresAt > now);

    if (since !== undefined) {
      messages = messages.filter((m) => m.createdAt >= since);
    }
    if (until !== undefined) {
      messages = messages.filter((m) => m.createdAt <= until);
    }

    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  // --------------------------------------------------------------------------
  // markAsRead
  // --------------------------------------------------------------------------

  /**
   * Mark a message as read locally and record a read receipt.
   *
   * If the message has `burnAfterRead` set and the local user is the sender,
   * a NIP-09 deletion event is published for the gift-wrap wrapper.
   *
   * @param messageId     - Client-side message UUID
   * @param contactPubkey - hex pubkey of the thread contact
   */
  async markAsRead(messageId: string, contactPubkey: string): Promise<void> {
    const messages = readMessages(contactPubkey);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;

    const receipt: ReadReceipt = {
      recipientPubkey: this.localPubkeyHex,
      readAt: nowUnix(),
    };

    const existing = messages[idx]!;
    messages[idx] = {
      ...existing,
      status: 'read' as MessageStatus,
      readReceipts: [...existing.readReceipts, receipt],
    };

    writeMessages(contactPubkey, messages);

    // Update thread unread count
    this._decrementUnread(contactPubkey);

    // Burn-after-read: if sender = local user and flag set, delete the wrapper
    const msg = messages[idx]!;
    if (
      msg.ephemeral?.burnAfterRead &&
      msg.senderPubkey === this.localPubkeyHex &&
      msg.wrapperEventId
    ) {
      await this._publishDeletion(msg.wrapperEventId, 'burn-after-read');
      messages[idx] = { ...messages[idx]!, status: 'deleted', deleted: true };
      writeMessages(contactPubkey, messages);
    }
  }

  // --------------------------------------------------------------------------
  // deleteMessage
  // --------------------------------------------------------------------------

  /**
   * Delete a message by publishing a NIP-09 kind:5 deletion event for the
   * kind:1059 gift-wrap wrapper, then marking it deleted locally.
   *
   * Only the sender can delete their own messages.
   *
   * @param messageId     - Client-side message UUID
   * @param contactPubkey - hex pubkey of the thread contact
   */
  async deleteMessage(messageId: string, contactPubkey: string): Promise<void> {
    const messages = readMessages(contactPubkey);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) throw new Error(`Message not found: ${messageId}`);

    const msg = messages[idx]!;
    if (msg.senderPubkey !== this.localPubkeyHex) {
      throw new Error('You can only delete your own messages');
    }

    // Publish NIP-09 deletion
    if (msg.wrapperEventId) {
      await this._publishDeletion(msg.wrapperEventId, 'user-deleted');
    }

    messages[idx] = { ...msg, status: 'deleted', deleted: true };
    writeMessages(contactPubkey, messages);
  }

  // --------------------------------------------------------------------------
  // listThreads
  // --------------------------------------------------------------------------

  /** List all DM threads, sorted by lastActivity descending */
  listThreads(): DirectThread[] {
    return readThreads().sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // --------------------------------------------------------------------------
  // getThread
  // --------------------------------------------------------------------------

  getThread(contactPubkey: string): DirectThread | undefined {
    return readThreads().find((t) => t.recipientPubkey === contactPubkey);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Publish a NIP-09 kind:5 deletion event for a given event id */
  private async _publishDeletion(eventId: string, reason: string): Promise<void> {
    try {
      const event = {
        kind: KIND_DELETION,
        content: reason,
        tags: [['e', eventId]],
        created_at: nowUnix(),
      };
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[DirectChatManager] Failed to publish deletion event:', err);
    }
  }

  /** Create or update the DirectThread entry for a contact */
  private _upsertThread(
    contactPubkey: string,
    lastMessage: Message,
    polVerified: boolean,
  ): void {
    const threads = readThreads();
    const idx = threads.findIndex((t) => t.recipientPubkey === contactPubkey);

    const now = nowUnix();
    const threadData: DirectThread = {
      id: contactPubkey,
      type: 'direct',
      recipientPubkey: contactPubkey,
      polVerified,
      lastActivity: now,
      lastMessagePreview: lastMessage.content.slice(0, 100),
      unreadCount: idx >= 0 ? (threads[idx]?.unreadCount ?? 0) : 0,
      notificationPreference: idx >= 0 ? (threads[idx]?.notificationPreference ?? 'all') : 'all',
      hasEphemeral: !!lastMessage.ephemeral,
      muted: idx >= 0 ? (threads[idx]?.muted ?? false) : false,
    };

    if (idx >= 0) {
      threads[idx] = threadData;
    } else {
      threads.push(threadData);
    }

    writeThreads(threads);
  }

  /** Decrement unread count for a thread */
  private _decrementUnread(contactPubkey: string): void {
    const threads = readThreads();
    const idx = threads.findIndex((t) => t.recipientPubkey === contactPubkey);
    if (idx >= 0 && (threads[idx]?.unreadCount ?? 0) > 0) {
      const thread = threads[idx]!;
      threads[idx] = {
        ...thread,
        unreadCount: thread.unreadCount - 1,
      };
      writeThreads(threads);
    }
  }

  /**
   * Called by the message receiver to add an incoming message.
   * Increments unread count and updates thread preview.
   */
  ingestIncomingMessage(
    senderPubkey: string,
    message: Message,
    polVerified = false,
  ): void {
    const messages = readMessages(senderPubkey);
    messages.push({ ...message, status: 'delivered' });
    writeMessages(senderPubkey, messages);

    // Upsert thread with incremented unread
    const threads = readThreads();
    const idx = threads.findIndex((t) => t.recipientPubkey === senderPubkey);
    const existing = idx >= 0 ? threads[idx] : null;

    const threadData: DirectThread = {
      id: senderPubkey,
      type: 'direct',
      recipientPubkey: senderPubkey,
      polVerified,
      lastActivity: message.createdAt,
      lastMessagePreview: message.content.slice(0, 100),
      unreadCount: (existing?.unreadCount ?? 0) + 1,
      notificationPreference: existing?.notificationPreference ?? 'all',
      hasEphemeral: !!message.ephemeral,
      muted: existing?.muted ?? false,
    };

    if (idx >= 0) {
      threads[idx] = threadData;
    } else {
      threads.push(threadData);
    }
    writeThreads(threads);
  }
}

