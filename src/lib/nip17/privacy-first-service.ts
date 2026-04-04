// Ported from v1 src/lib/gift-wrapped-messaging/privacy-first-service.ts
// Stripped: apiBaseUrl HTTP fetch calls for session management (server-side session)
//   communicationType "family" renamed to "group" per v2 glossary
//   familyRole → groupRole throughout
// v2: Session creation uses OPFS Vault nsec directly via CEPS. No server-side session endpoint.
// NIP-17 gift-wrapping logic preserved intact.

/**
 * Privacy-First NIP-17 Messaging Service
 *
 * Implements gift-wrapped direct messaging (NIP-59/NIP-17) for Satnam v2.
 * All encryption is done client-side using nostr-tools nip44/nip59 primitives.
 *
 * v2 key changes:
 * - sendGiftwrappedMessage delegates to CEPS (no server proxy)
 * - Session is initialized from OPFS Vault nsec by the caller
 * - No HTTP calls to /api/communications/* endpoints
 */

export interface PrivacyConsentResponse {
  consentGiven: boolean;
  warningAcknowledged: boolean;
  selectedScope: "direct" | "groups" | "specific-groups" | "none";
  specificGroupIds?: string[];
  nip05?: string;
  timestamp: Date;
}

export interface ISatnamPrivacyFirstCommunications {
  sessionId: string;
  isConnected: boolean;
  sendGiftwrappedMessage: (
    config: GiftwrappedMessageConfig
  ) => Promise<MessageResponse>;
  enableNip05Disclosure: (config: Nip05DisclosureConfig) => Promise<void>;
  destroySession: () => Promise<void>;
}

export interface GiftwrappedMessageConfig {
  content: string;
  recipient: string;
  sender: string;
  encryptionLevel: "standard" | "enhanced" | "maximum";
  /** v2: "group" replaces "family" per spec §0.2 Glossary */
  communicationType: "group" | "individual";
  messageType?: "direct" | "group";
}

export interface MessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  encryptionUsed?: string;
  deliveryMethod?: string;
}

export interface Nip05DisclosureConfig {
  nip05: string;
  scope: "direct" | "groups" | "specific-groups";
  specificGroupIds?: string[];
}

export interface MessagingConfig {
  relays: string[];
  defaultEncryptionLevel: "standard" | "enhanced" | "maximum";
  privacyWarnings: {
    enabled: boolean;
    showForNewContacts: boolean;
    showForGroupMessages: boolean;
  };
}

export interface IdentityDisclosureStatus {
  hasNip05: boolean;
  isDisclosureEnabled: boolean;
  directMessagesEnabled: boolean;
  groupMessagesEnabled: boolean;
  specificGroupsCount: number;
  lastUpdated?: Date;
}

export interface PrivacyWarningContent {
  title: string;
  message: string;
  risks: string[];
  recommendations: string[];
  severity: "low" | "medium" | "high";
}

export interface DisclosureWorkflowResult {
  requiresUserConfirmation: boolean;
  warningContent?: PrivacyWarningContent;
  error?: string;
}

export interface SessionInitializationOptions {
  relays?: string[];
  encryptionLevel?: "standard" | "enhanced" | "maximum";
  enablePrivacyWarnings?: boolean;
  sessionTimeout?: number;
}

export interface ContactData {
  npub: string;
  nip05?: string;
  displayName: string;
  /** v2: groupRole replaces familyRole per spec §0.2 Glossary */
  groupRole?: "private" | "offspring" | "adult" | "steward" | "guardian";
  trustLevel: "group" | "trusted" | "known" | "unverified";
  preferredEncryption: "gift-wrap" | "nip04" | "auto";
  notes?: string;
  tags: string[];
}

export const MESSAGING_CONFIG: MessagingConfig = {
  relays: ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.nostr.band"],
  defaultEncryptionLevel: "enhanced",
  privacyWarnings: {
    enabled: true,
    showForNewContacts: true,
    showForGroupMessages: true,
  },
};

/**
 * Privacy-First Messaging Service
 *
 * v2: sendGiftwrappedMessage routes through CEPS instead of a server proxy.
 * The caller must have initialized a CEPS session with the nsec from OPFS Vault.
 */
export class PrivacyFirstMessagingService
  implements ISatnamPrivacyFirstCommunications
{
  public sessionId: string;
  public isConnected: boolean = false;

  // In-memory identity disclosure preferences (no server storage in v2)
  private disclosurePrefs: {
    nip05?: string;
    scope?: Nip05DisclosureConfig["scope"];
    specificGroupIds?: string[];
    enabled: boolean;
  } = { enabled: false };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.isConnected = true;
  }

  async sendGiftwrappedMessage(
    config: GiftwrappedMessageConfig
  ): Promise<MessageResponse> {
    try {
      // v2: delegate to CEPS gift-wrap implementation
      const { sendGiftwrappedMessageWithCeps } = await import(
        "../ceps/index"
      );

      const messageId = await sendGiftwrappedMessageWithCeps(
        config.recipient,
        config.content
      );

      return {
        success: true,
        messageId,
        encryptionUsed: config.encryptionLevel,
        deliveryMethod: "nip17-gift-wrap",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async enableNip05Disclosure(config: Nip05DisclosureConfig): Promise<void> {
    // v2: stored in-memory only. Persist to OPFS if needed.
    this.disclosurePrefs = {
      nip05: config.nip05,
      scope: config.scope,
      specificGroupIds: config.specificGroupIds,
      enabled: true,
    };
  }

  async destroySession(): Promise<void> {
    this.isConnected = false;
    this.disclosurePrefs = { enabled: false };
  }

  async getIdentityDisclosureStatus(): Promise<IdentityDisclosureStatus> {
    return {
      hasNip05: !!this.disclosurePrefs.nip05,
      isDisclosureEnabled: this.disclosurePrefs.enabled,
      directMessagesEnabled:
        this.disclosurePrefs.enabled &&
        (this.disclosurePrefs.scope === "direct" ||
          this.disclosurePrefs.scope === "groups"),
      groupMessagesEnabled:
        this.disclosurePrefs.enabled &&
        (this.disclosurePrefs.scope === "groups" ||
          this.disclosurePrefs.scope === "specific-groups"),
      specificGroupsCount:
        this.disclosurePrefs.specificGroupIds?.length ?? 0,
    };
  }

  async updateIdentityDisclosurePreferences(
    consent: PrivacyConsentResponse,
    nip05?: string
  ): Promise<boolean> {
    if (!consent.consentGiven || !consent.warningAcknowledged) return false;
    this.disclosurePrefs = {
      nip05: nip05 || this.disclosurePrefs.nip05,
      scope: consent.selectedScope === "none" ? undefined : consent.selectedScope,
      specificGroupIds: consent.specificGroupIds,
      enabled: consent.consentGiven,
    };
    return true;
  }

  async disableIdentityDisclosure(): Promise<boolean> {
    this.disclosurePrefs = { enabled: false };
    return true;
  }

  async addContact(contactData: ContactData): Promise<string | null> {
    try {
      const { getCepsClient } = await import("../ceps/index");
      const ceps = await getCepsClient();
      return ceps.addContact({
        npub: contactData.npub,
        displayName: contactData.displayName,
        nip05: contactData.nip05,
        groupRole: contactData.groupRole,
        trustLevel: contactData.trustLevel as any,
        tags: contactData.tags,
        preferredEncryption: contactData.preferredEncryption,
      });
    } catch {
      return null;
    }
  }

  /**
   * Initialize a NIP-17 session from an nsec sourced from OPFS Vault.
   * @param nsecHex - Hex-encoded nsec from OPFS Vault
   * @param options - Optional relay/timeout overrides
   */
  static async createFromVault(
    nsecHex: string,
    options?: SessionInitializationOptions
  ): Promise<PrivacyFirstMessagingService> {
    const { initializeSessionWithCeps } = await import("../ceps/index");
    const sessionId = await initializeSessionWithCeps(nsecHex, {
      ttlHours: options?.sessionTimeout
        ? options.sessionTimeout / 3600
        : undefined,
    });
    const service = new PrivacyFirstMessagingService(sessionId);
    return service;
  }
}

// Main production class (backward compat alias)
export class SatnamPrivacyFirstCommunications extends PrivacyFirstMessagingService {
  constructor(sessionId?: string) {
    super(sessionId || "");
  }

  static async createFromVault(
    nsecHex: string,
    options?: SessionInitializationOptions
  ): Promise<SatnamPrivacyFirstCommunications> {
    const base = await PrivacyFirstMessagingService.createFromVault(
      nsecHex,
      options
    );
    const instance = new SatnamPrivacyFirstCommunications(base.sessionId);
    return instance;
  }
}
