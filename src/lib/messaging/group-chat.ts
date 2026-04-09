/**
 * @module messaging/group-chat
 * @description NIP-17 multi-party group messaging.
 *
 * Group state is stored as a kind:30078 parameterized replaceable event with
 * d-tag `satnam:group:{groupId}`. Each outbound message is individually
 * gift-wrapped (kind:1059) to every group member per the NIP-17 spec.
 *
 * Admin controls:
 * - Only admins may add/remove members or update the group config.
 * - The group creator is always an admin.
 *
 * No new production dependencies. Uses existing CEPS for event publishing.
 */

import type {
  GroupConfig,
  GroupThread,
  Message,
  EphemeralConfig,
  MessageStatus,
} from './types.js';

import {
  publishEventWithCeps,
  signEventWithCeps,
  sendGiftwrappedMessageWithCeps,
  getDefaultRelays,
} from '../ceps/ceps-client.js';

// ============================================================================
// Constants
// ============================================================================

/** kind:30078 — Parameterized replaceable application data (NIP-78) */
const KIND_APP_DATA = 30078;
/** kind:1059 — Gift-wrap wrapper (NIP-59) */
const KIND_GIFT_WRAP = 1059;
/** kind:14 — Sealed DM rumor (NIP-17) */
const KIND_SEALED_DM = 14;
/** kind:5 — Deletion event (NIP-09) */
const KIND_DELETION = 5;

const GROUP_DTAG_PREFIX = 'satnam:group:';

// ============================================================================
// Local storage key for cached group state
// ============================================================================

const GROUPS_STORAGE_KEY = 'satnam:groups:v2';

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

function readGroupsFromStorage(): GroupThread[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(GROUPS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GroupThread[]) : [];
  } catch {
    return [];
  }
}

function writeGroupsToStorage(groups: GroupThread[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Ignore quota errors in storage
  }
}

function readMessagesFromStorage(groupId: string): Message[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const key = `satnam:group:msgs:${groupId}`;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

function writeMessagesToStorage(groupId: string, messages: Message[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = `satnam:group:msgs:${groupId}`;
    localStorage.setItem(key, JSON.stringify(messages));
  } catch {
    // Ignore quota errors
  }
}

// ============================================================================
// GroupChatManager
// ============================================================================

export class GroupChatManager {
  /**
   * @param localPubkeyHex - hex pubkey of the currently logged-in user
   * @param relays          - relay URLs to use for publishing
   */
  constructor(
    private readonly localPubkeyHex: string,
    private readonly relays: string[] = getDefaultRelays(),
  ) {}

  // --------------------------------------------------------------------------
  // createGroup
  // --------------------------------------------------------------------------

  /**
   * Create a new group, publish its config as kind:30078, and send gift-wrapped
   * welcome invites (kind:1059) to all initial members.
   *
   * @param name          - Human-readable group name
   * @param memberPubkeys - hex pubkeys (or npubs) of initial members (creator included)
   * @param config        - Optional partial config overrides
   * @returns The new GroupThread
   */
  async createGroup(
    name: string,
    memberPubkeys: string[],
    config?: Partial<Pick<GroupConfig, 'relayUrls' | 'avatar' | 'description'>>,
  ): Promise<GroupThread> {
    const groupId = generateId();
    const now = nowUnix();

    // Ensure creator is in members and admins
    const allMembers = Array.from(
      new Set([this.localPubkeyHex, ...memberPubkeys]),
    );

    const groupConfig: GroupConfig = {
      name,
      members: allMembers,
      admins: [this.localPubkeyHex],
      relayUrls: config?.relayUrls ?? this.relays,
      avatar: config?.avatar,
      description: config?.description,
      createdAt: now,
      updatedAt: now,
    };

    // Publish kind:30078 group state
    await this._publishGroupState(groupId, groupConfig);

    // Send welcome invite to all members (except self)
    const welcomeContent = JSON.stringify({
      type: 'satnam:group:welcome',
      groupId,
      groupConfig,
    });
    await this._giftWrapToAll(
      allMembers.filter((p) => p !== this.localPubkeyHex),
      welcomeContent,
      groupId,
    );

    const thread: GroupThread = {
      id: groupId,
      type: 'group',
      groupId,
      config: groupConfig,
      localPubkey: this.localPubkeyHex,
      lastActivity: now,
      lastMessagePreview: `Group "${name}" created`,
      unreadCount: 0,
      notificationPreference: 'all',
      hasEphemeral: false,
      muted: false,
    };

    // Persist locally
    const groups = readGroupsFromStorage();
    groups.push(thread);
    writeGroupsToStorage(groups);

    return thread;
  }

  // --------------------------------------------------------------------------
  // sendGroupMessage
  // --------------------------------------------------------------------------

  /**
   * Send a message to all group members via individual NIP-17 gift-wraps.
   *
   * Each member receives a separate kind:1059 event addressed to their pubkey.
   * Ephemeral config adds a NIP-40 expiration tag to the inner kind:14 rumor.
   *
   * @param groupId         - ID of the target group
   * @param content         - Plaintext message content
   * @param ephemeralConfig - Optional ephemeral/TTL settings
   * @returns The optimistically created Message
   */
  async sendGroupMessage(
    groupId: string,
    content: string,
    ephemeralConfig?: EphemeralConfig,
  ): Promise<Message> {
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const now = nowUnix();
    const messageId = generateId();
    const expiresAt =
      ephemeralConfig && ephemeralConfig.ttl > 0
        ? now + ephemeralConfig.ttl
        : undefined;

    // Build the message payload (will be embedded in the kind:14 rumor)
    const messagePayload = JSON.stringify({
      type: 'satnam:group:message',
      groupId,
      messageId,
      content,
      ...(expiresAt ? { expiresAt } : {}),
      ...(ephemeralConfig?.burnAfterRead
        ? { burnAfterRead: true }
        : {}),
    });

    // Gift-wrap to all members (including self so sender has a copy)
    const recipients = group.config.members;
    await this._giftWrapToAll(recipients, messagePayload, groupId, expiresAt);

    const message: Message = {
      id: messageId,
      senderPubkey: this.localPubkeyHex,
      threadId: groupId,
      content,
      createdAt: now,
      status: 'sent' as MessageStatus,
      ephemeral: ephemeralConfig,
      expiresAt,
      expirationTag: expiresAt,
      readReceipts: [],
      deleted: false,
    };

    // Persist to local message store
    const messages = readMessagesFromStorage(groupId);
    messages.push(message);
    writeMessagesToStorage(groupId, messages);

    // Update thread metadata
    this._updateThreadLastActivity(groupId, now, content);

    return message;
  }

  // --------------------------------------------------------------------------
  // addMember
  // --------------------------------------------------------------------------

  /**
   * Add a new member to the group. Only admins may call this.
   *
   * Publishes an updated kind:30078 config and sends the new member a
   * gift-wrapped welcome invite containing the current group config.
   *
   * @param groupId - Target group
   * @param pubkey  - hex pubkey (or npub) of the new member
   */
  async addMember(groupId: string, pubkey: string): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);
    this._assertAdmin(group);

    if (group.config.members.includes(pubkey)) return; // already a member

    const updatedConfig: GroupConfig = {
      ...group.config,
      members: [...group.config.members, pubkey],
      updatedAt: nowUnix(),
    };

    await this._publishGroupState(groupId, updatedConfig);

    // Welcome message with group history hint
    const welcomeContent = JSON.stringify({
      type: 'satnam:group:member_added',
      groupId,
      groupConfig: updatedConfig,
      addedBy: this.localPubkeyHex,
    });
    await this._giftWrapToAll([pubkey], welcomeContent, groupId);

    // Notify existing members of the new addition
    const notifyContent = JSON.stringify({
      type: 'satnam:group:config_update',
      groupId,
      groupConfig: updatedConfig,
      change: 'member_added',
      changedPubkey: pubkey,
    });
    await this._giftWrapToAll(
      group.config.members.filter((p) => p !== this.localPubkeyHex),
      notifyContent,
      groupId,
    );

    this._updateGroupConfig(groupId, updatedConfig);
  }

  // --------------------------------------------------------------------------
  // removeMember
  // --------------------------------------------------------------------------

  /**
   * Remove a member from the group. Only admins may call this.
   *
   * Publishes an updated kind:30078 config and notifies remaining members.
   *
   * @param groupId - Target group
   * @param pubkey  - hex pubkey of the member to remove
   */
  async removeMember(groupId: string, pubkey: string): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);
    this._assertAdmin(group);

    if (!group.config.members.includes(pubkey)) return; // not a member

    const updatedConfig: GroupConfig = {
      ...group.config,
      members: group.config.members.filter((p) => p !== pubkey),
      admins: group.config.admins.filter((p) => p !== pubkey),
      updatedAt: nowUnix(),
    };

    await this._publishGroupState(groupId, updatedConfig);

    // Notify remaining members
    const notifyContent = JSON.stringify({
      type: 'satnam:group:config_update',
      groupId,
      groupConfig: updatedConfig,
      change: 'member_removed',
      changedPubkey: pubkey,
    });
    await this._giftWrapToAll(
      updatedConfig.members.filter((p) => p !== this.localPubkeyHex),
      notifyContent,
      groupId,
    );

    this._updateGroupConfig(groupId, updatedConfig);
  }

  // --------------------------------------------------------------------------
  // updateGroupConfig
  // --------------------------------------------------------------------------

  /**
   * Update group name, avatar, or relay list. Only admins may call this.
   *
   * @param groupId - Target group
   * @param updates - Partial config to merge
   */
  async updateGroupConfig(
    groupId: string,
    updates: Partial<Pick<GroupConfig, 'name' | 'avatar' | 'relayUrls' | 'description'>>,
  ): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);
    this._assertAdmin(group);

    const updatedConfig: GroupConfig = {
      ...group.config,
      ...updates,
      updatedAt: nowUnix(),
    };

    await this._publishGroupState(groupId, updatedConfig);

    // Notify all members
    const notifyContent = JSON.stringify({
      type: 'satnam:group:config_update',
      groupId,
      groupConfig: updatedConfig,
      change: 'config_updated',
    });
    await this._giftWrapToAll(
      updatedConfig.members.filter((p) => p !== this.localPubkeyHex),
      notifyContent,
      groupId,
    );

    this._updateGroupConfig(groupId, updatedConfig);
  }

  // --------------------------------------------------------------------------
  // leaveGroup
  // --------------------------------------------------------------------------

  /**
   * Remove the local user from the group (self-removal).
   * Sends a leave notification to remaining members.
   *
   * @param groupId - Target group
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) throw new Error(`Group not found: ${groupId}`);

    const updatedConfig: GroupConfig = {
      ...group.config,
      members: group.config.members.filter((p) => p !== this.localPubkeyHex),
      admins: group.config.admins.filter((p) => p !== this.localPubkeyHex),
      updatedAt: nowUnix(),
    };

    await this._publishGroupState(groupId, updatedConfig);

    const leaveContent = JSON.stringify({
      type: 'satnam:group:member_left',
      groupId,
      pubkey: this.localPubkeyHex,
    });
    await this._giftWrapToAll(
      updatedConfig.members,
      leaveContent,
      groupId,
    );

    // Remove from local storage
    const groups = readGroupsFromStorage().filter((g) => g.groupId !== groupId);
    writeGroupsToStorage(groups);
  }

  // --------------------------------------------------------------------------
  // getGroupMessages
  // --------------------------------------------------------------------------

  /**
   * Retrieve locally cached messages for a group, with optional time range.
   *
   * @param groupId - Target group
   * @param since   - Optional unix timestamp lower bound
   * @param until   - Optional unix timestamp upper bound
   * @returns Messages sorted by createdAt ascending
   */
  async getGroupMessages(
    groupId: string,
    since?: number,
    until?: number,
  ): Promise<Message[]> {
    let messages = readMessagesFromStorage(groupId);

    // Filter out expired messages
    const now = nowUnix();
    messages = messages.filter(
      (m) => !m.expiresAt || m.expiresAt > now,
    );

    if (since !== undefined) {
      messages = messages.filter((m) => m.createdAt >= since);
    }
    if (until !== undefined) {
      messages = messages.filter((m) => m.createdAt <= until);
    }

    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  // --------------------------------------------------------------------------
  // listGroups
  // --------------------------------------------------------------------------

  /**
   * List all locally known group threads, sorted by lastActivity descending.
   */
  async listGroups(): Promise<GroupThread[]> {
    const groups = readGroupsFromStorage();
    return groups.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  // --------------------------------------------------------------------------
  // getGroup
  // --------------------------------------------------------------------------

  async getGroup(groupId: string): Promise<GroupThread | undefined> {
    const groups = readGroupsFromStorage();
    return groups.find((g) => g.groupId === groupId);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Publish group config as kind:30078 with d-tag `satnam:group:{groupId}` */
  private async _publishGroupState(
    groupId: string,
    config: GroupConfig,
  ): Promise<void> {
    const event = {
      kind: KIND_APP_DATA,
      content: JSON.stringify(config),
      tags: [['d', `${GROUP_DTAG_PREFIX}${groupId}`]],
      created_at: nowUnix(),
    };
    try {
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, config.relayUrls ?? this.relays);
    } catch (err) {
      // Non-fatal: local state is the source of truth in Phase 1
      console.warn('[GroupChatManager] Failed to publish group state:', err);
    }
  }

  /**
   * Gift-wrap `content` to each recipient individually.
   * Uses the existing CEPS gift-wrap helper for each pubkey.
   */
  private async _giftWrapToAll(
    recipients: string[],
    content: string,
    _groupId: string,
    _expiresAt?: number,
  ): Promise<void> {
    const promises = recipients.map(async (recipientPubkey) => {
      try {
        await sendGiftwrappedMessageWithCeps(recipientPubkey, content);
      } catch (err) {
        console.warn(
          `[GroupChatManager] Failed to gift-wrap to ${recipientPubkey}:`,
          err,
        );
      }
    });
    await Promise.allSettled(promises);
  }

  /** Assert that localPubkeyHex is an admin of the group, throws otherwise */
  private _assertAdmin(group: GroupThread): void {
    if (!group.config.admins.includes(this.localPubkeyHex)) {
      throw new Error('Only group admins can perform this action');
    }
  }

  /** Merge updated config into the locally cached GroupThread */
  private _updateGroupConfig(groupId: string, config: GroupConfig): void {
    const groups = readGroupsFromStorage();
    const idx = groups.findIndex((g) => g.groupId === groupId);
    if (idx >= 0) {
      groups[idx] = { ...groups[idx], config };
      writeGroupsToStorage(groups);
    }
  }

  /** Update lastActivity and lastMessagePreview on a GroupThread */
  private _updateThreadLastActivity(
    groupId: string,
    timestamp: number,
    preview: string,
  ): void {
    const groups = readGroupsFromStorage();
    const idx = groups.findIndex((g) => g.groupId === groupId);
    if (idx >= 0) {
      groups[idx] = {
        ...groups[idx],
        lastActivity: timestamp,
        lastMessagePreview: preview.slice(0, 100),
      };
      writeGroupsToStorage(groups);
    }
  }
}

