// Ported from v1 lib/central_event_publishing_service.ts
// Stripped: getSupabase(), storeSessionInDatabase(), storeContactInDatabase(),
//   getSupabaseClient(), SecureSessionManager, secure-nsec-session-registry,
//   user-signing-preferences, relay-privacy-layer (v1 import path),
//   family_* → group_* naming throughout
// Added: NIP-42 AUTH handler (fix-plan 10) on relay connections
// v2: Session state is purely in-memory. No DB writes. Nsec sourced from OPFS Vault.

/**
 * Central Event Publishing Service (CEPS)
 *
 * Single relay abstraction layer for constructing, signing, and publishing
 * Nostr events. Ported from v1 with all server-coupling removed.
 *
 * v2 design constraints (Axiom 3):
 * - Zero key material in Supabase
 * - No JWT / SecureSessionManager
 * - No Sentry
 * - NIP-42 AUTH on relay connections (implemented — fix-plan 10)
 *
 * NIP-42 AUTH (fix-plan 10, 2026-09-05):
 *   nostr-tools 2.23.3 does NOT expose the v1 pool.on("auth", ...) API. The
 *   supported mechanism (verified in the installed package) is the pool
 *   constructor option `automaticallyAuth` — attached per relay connection as
 *   relay.onauth — plus per-call `onauth` on publish/subscribe/list for the
 *   "auth-required: " reactive retry. The library builds the kind:22242
 *   template itself (relay + challenge tags, content "") and transmits the
 *   signed event over the relay WebSocket (no pool.publish involved). The
 *   signer uses the ACTIVE SESSION KEY (activeNsecBytes) directly via
 *   finalizeEvent — the F-11 consent gate is NOT involved (kind 22242 stays
 *   non-whitelisted; the consent tests' 22242-rejection assertion is
 *   unchanged). No session key -> no signer attached -> the relay's
 *   "auth-required: ..." rejection propagates (fail-closed).
 */

import {
  finalizeEvent,
  getPublicKey,
  nip19,
  SimplePool,
  verifyEvent,
  type Event,
  type EventTemplate,
  type Filter,
  type VerifiedEvent,
} from "nostr-tools";

// Encoding utilities (inline — avoids v1 path dependencies)
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

const te = new TextEncoder();
const utf8 = (s: string) => te.encode(s);

// ============================================================================
// Privacy utilities (Web Crypto — no external deps)
// ============================================================================

export class PrivacyUtils {
  static async hashIdentifier(input: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", utf8(input));
    return bytesToHex(new Uint8Array(digest));
  }

  static async generateEncryptedUUID(): Promise<string> {
    const uuid = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const rand = new Uint8Array(16);
    crypto.getRandomValues(rand);
    const payload = `${uuid}:${Date.now()}:${bytesToHex(rand)}`;
    const digest = await crypto.subtle.digest("SHA-256", utf8(payload));
    return bytesToHex(new Uint8Array(digest));
  }

  static async generateSessionKey(): Promise<string> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  private static async importAesKey(sessionKeyHex: string): Promise<CryptoKey> {
    const keyBytes = hexToBytes(sessionKeyHex);
    const raw = new ArrayBuffer(keyBytes.byteLength);
    new Uint8Array(raw).set(keyBytes);
    return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  static async encryptWithSessionKey(
    data: string,
    sessionKey: string
  ): Promise<string> {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const key = await this.importAesKey(sessionKey);
    const enc = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      utf8(data)
    );
    return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(enc))}`;
  }

  static async decryptWithSessionKey(
    encryptedData: string,
    sessionKey: string
  ): Promise<string> {
    const [ivHex, cipherHex] = encryptedData.split(":") as [string, string];
    const iv = hexToBytes(ivHex);
    const cipher = hexToBytes(cipherHex);
    const key = await this.importAesKey(sessionKey);
    const ab = new ArrayBuffer(cipher.byteLength);
    new Uint8Array(ab).set(cipher);
    const ivAb = new ArrayBuffer(iv.byteLength);
    new Uint8Array(ivAb).set(iv);
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivAb },
      key,
      ab
    );
    return new TextDecoder().decode(dec);
  }
}

// ============================================================================
// Configuration types
// ============================================================================

export const MESSAGING_CONFIG = {
  SESSION_TTL_HOURS: 24,
  CONTACT_CACHE_TTL_HOURS: 12,
  MESSAGE_BATCH_SIZE: 50,
  RATE_LIMITS: {
    SEND_MESSAGE_PER_HOUR: 100,
    ADD_CONTACT_PER_HOUR: 20,
    CREATE_GROUP_PER_DAY: 5,
    GROUP_INVITE_PER_HOUR: 50,
  },
} as const;

export interface UnifiedMessagingConfig {
  relays: string[];
  giftWrapEnabled: boolean;
  guardianApprovalRequired: boolean;
  guardianPubkeys: string[];
  maxGroupSize: number;
  messageRetentionDays: number;
  privacyDelayMs: number;
  defaultEncryptionLevel: "enhanced" | "standard";
  privacyWarnings: {
    enabled: boolean;
    showForNewContacts: boolean;
    showForGroupMessages: boolean;
  };
  session: {
    ttlHours: number;
    maxConcurrentSessions: number;
  };
}

/** v2: group_role replaces family_role per spec §0.2 Glossary */
export interface PrivacyContact {
  sessionId: string;
  encryptedNpub: string;
  nip05Hash?: string;
  displayNameHash: string;
  groupRole?: "private" | "offspring" | "adult" | "steward" | "guardian";
  trustLevel: "group" | "trusted" | "known" | "unverified";
  supportsGiftWrap: boolean;
  preferredEncryption: "gift-wrap" | "nip04" | "auto";
  lastSeenHash?: string;
  tagsHash: string[];
  addedAt: Date;
  addedByHash: string;
}

/** v2: groupType replaces familyType. groupId replaces familyId. */
export interface PrivacyGroup {
  sessionId: string;
  nameHash: string;
  descriptionHash: string;
  groupType: "group" | "business" | "friends" | "advisors";
  memberCount: number;
  adminHashes: string[];
  encryptionType: "gift-wrap" | "nip04";
  createdAt: Date;
  createdByHash: string;
  lastActivityHash?: string;
}

export interface MessagingSession {
  sessionId: string;
  userHash: string;
  sessionKey: string;
  expiresAt: Date;
  userAgent?: string;
  authMethod?: "nsec" | "nip07";
}

export type GiftWrapPreference = {
  preferGiftWrap?: boolean;
  fallbackRelays?: string[];
};

export type OTPDeliveryResult = {
  success: boolean;
  otp?: string;
  messageId?: string;
  expiresAt?: Date;
  messageType?: "gift-wrap" | "nip04";
  error?: string;
};

export const DEFAULT_UNIFIED_CONFIG: UnifiedMessagingConfig = {
  relays: ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.nostr.band"],
  giftWrapEnabled: true,
  guardianApprovalRequired: true,
  guardianPubkeys: [],
  maxGroupSize: 50,
  messageRetentionDays: 30,
  privacyDelayMs: 5000,
  defaultEncryptionLevel: "enhanced",
  privacyWarnings: {
    enabled: true,
    showForNewContacts: true,
    showForGroupMessages: true,
  },
  session: {
    ttlHours: 24,
    maxConcurrentSessions: 3,
  },
};

// ============================================================================
// Relay URL validation
// ============================================================================

function isValidRelayUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const s = url.trim();
  if (!s.startsWith("wss://") && !s.startsWith("ws://")) return false;
  try {
    const u = new URL(s);
    const hostname = u.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname === "::1"
    )
      return false;
    const isPrivateIPv4 =
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
    if (isPrivateIPv4) return false;
    return true;
  } catch {
    return false;
  }
}

function parseRelaysCSV(csv?: string): string[] {
  return (csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultRelays(): string[] {
  const envVite =
    typeof import.meta !== "undefined"
      ? (import.meta as any).env?.VITE_NOSTR_RELAYS
      : undefined;
  const list = parseRelaysCSV(envVite).filter(isValidRelayUrl);
  if (list.length) return list;
  return ["wss://nos.lol", "wss://relay.damus.io", "wss://relay.nostr.band"];
}

// ============================================================================
// CentralEventPublishingService
// ============================================================================

/**
 * Non-DM event kinds the DEFAULT signing-consent policy auto-approves
 * (F-11 / R2-M-2 founder Decision 1, 2026-08-25 — fail-closed whitelist per
 * Security round-2 §6 Option A). Every entry is a first-party feature whose
 * in-app initiation is the consent act; each was cross-checked against its
 * live sign site:
 *
 * - 5      NIP-09 deletion (direct-chat.ts:365; skill-registration.ts:505/:535)
 * - 30078  group state (group-chat.ts:532)
 * - 443    MLS KeyPackage stub (protocol-bridge.ts:239 via KIND_MLS_KEY_PACKAGE=443)
 * - 22456  push register/heartbeat/offline/unregister (notifications.ts:147/:181/:209/:237)
 * - 33400  skill manifest (skill-registration.ts:409)
 * - 33401  skill version log (skill-registration.ts:496)
 * - 1985   skill attestation label (skill-registration.ts:437)
 * - 39240  credit intent (nip-ac/client.ts:571)
 * - 39242  credit envelope (nip-ac/client.ts:603)
 * - 39243  spend authorization (nip-ac/client.ts:626)
 * - 39244  settlement receipt (nip-ac/client.ts:650)
 * - 39245  default notice (nip-ac/client.ts:663)
 * - 10050  inbox relays (central-event-publishing-service.ts publishInboxRelaysKind10050)
 *
 * DELTA vs Security memo §6: kind 39241 (Credit Offer) from the memo's
 * "39240–39245" range is EXCLUDED — repo-wide verification shows it is
 * inbound-only (parseCreditOffer / monitor subscriptions), never signed
 * locally. DM-core kinds 4/14/1059 bypass this hook entirely upstream.
 *
 * Maintenance rule: a new legitimate kind must be added here AND get a
 * consent pass-through test — failure mode is loud (sign-time rejection).
 */
export const CONSENT_AUTO_APPROVED_KINDS: ReadonlySet<number> = new Set([
  5,
  30078,
  443,
  22456,
  33400,
  33401,
  1985,
  39240,
  39242,
  39243,
  39244,
  39245,
  10050,
]);

/**
 * NIP-42 AUTH signer factory (fix-plan 10).
 *
 * Returns the `automaticallyAuth` option for SimplePool (nostr-tools 2.23.3):
 * SimplePool.ensureRelay calls it per relay connection; when it returns a
 * signer, that signer is attached as relay.onauth and answers the relay's
 * AUTH challenges. The library builds the kind:22242 template itself
 * (tags [["relay", url], ["challenge", challenge]], content "") and
 * transmits the signed event back over the relay WebSocket — the service
 * only signs. Verified against the installed package (abstract-relay.js
 * makeAuthEvent lines 89-97, auth() lines 309-332, AUTH handler lines
 * 476-482; abstract-pool.js ensureRelay lines 616-621).
 *
 * Fail-closed: with no active session key the factory returns null (no
 * signer attached; the relay's "auth-required: ..." rejection propagates).
 * The signer re-reads the key at sign time so a destroyed session cannot
 * mint an auth event; the throw is defense-in-depth for a destroySession
 * race and is never the normal path (a throwing signer would otherwise
 * leave the library's authPromise pending — verified behavior, see the
 * catch at abstract-relay.js lines 327-329).
 *
 * The key-getter is INJECTED (DI) so the handler is unit-testable with real
 * crypto and no relay and no module-boundary mocks (plan 08 Amendment 2.0
 * F-3 posture: no vi.mock in this change-group).
 */
export function createCepsAuthHandler(
  getActiveKeyBytes: () => Uint8Array | null,
): (
  relayURL: string
) => null | ((authTemplate: EventTemplate) => Promise<VerifiedEvent>) {
  return (_relayURL) => {
    if (!getActiveKeyBytes()) return null;
    return async (authTemplate) => {
      const keyBytes = getActiveKeyBytes();
      if (!keyBytes) {
        throw new Error("[CEPS] NIP-42 AUTH: no active session key");
      }
      return finalizeEvent(authTemplate, keyBytes);
    };
  };
}

export class CentralEventPublishingService {
  private pool: SimplePool | null = null;
  private relays: string[];
  private config: UnifiedMessagingConfig;

  // In-memory session (no DB — v2 architecture)
  private userSession: MessagingSession | null = null;
  private contactSessions: Map<string, PrivacyContact> = new Map();
  private groupSessions: Map<string, PrivacyGroup> = new Map();
  private rateLimits: Map<string, { count: number; resetTime: number }> =
    new Map();
  // Active nsec (bytes) — set during initializeSession, zeroed on destroySession
  // SECURITY: Never persisted. Lives only in heap for the session duration.
  // Stored as Uint8Array so it can be explicitly zeroed (unlike immutable strings).
  private activeNsecBytes: Uint8Array | null = null;

  constructor() {
    this.relays = defaultRelays();
    this.config = { ...DEFAULT_UNIFIED_CONFIG, relays: this.relays.slice() };
  }

  private getPool(): SimplePool {
    if (!this.pool) {
      this.pool = new SimplePool(
        // NIP-42 AUTH (fix-plan 10): answer relay AUTH challenges with the
        // active session key. The SimplePool constructor TYPE only exposes
        // enablePing/enableReconnect, but the runtime constructor spreads all
        // options into AbstractSimplePool (verified: nostr-tools 2.23.3
        // pool.js `super({ ..., ...options })`) — hence the boundary cast.
        {
          automaticallyAuth: createCepsAuthHandler(
            () => this.activeNsecBytes
          ),
        } as never,
      );
    }
    return this.pool;
  }

  setRelays(relays: string[]) {
    if (Array.isArray(relays) && relays.length) this.relays = relays;
  }

  getRelays(): string[] {
    return this.relays;
  }

  // ---- Session management (v2: in-memory only) ----

  async initializeSession(
    nsecOrMarker?: string,
    options?: {
      userAgent?: string;
      ttlHours?: number;
      authMethod?: "nip07";
      npub?: string;
    }
  ): Promise<string> {
    const isNip07 =
      nsecOrMarker === "nip07" || options?.authMethod === "nip07";

    const sessionId = await PrivacyUtils.generateEncryptedUUID();
    const sessionKey = await PrivacyUtils.generateSessionKey();
    const ttlHours = options?.ttlHours ?? this.config.session.ttlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    let userHash: string;

    if (isNip07) {
      userHash = await PrivacyUtils.hashIdentifier(
        options?.npub || "nip07"
      );
      this.activeNsecBytes = null;
    } else {
      // Decode nsec to bytes for signing
      if (!nsecOrMarker) throw new Error("nsec or nip07 marker required");
      let nsecBytes: Uint8Array;
      if (/^[0-9a-fA-F]{64}$/.test(nsecOrMarker)) {
        nsecBytes = hexToBytes(nsecOrMarker);
      } else {
        const dec = nip19.decode(nsecOrMarker);
        if (dec.type !== "nsec") throw new Error("Invalid nsec");
        nsecBytes = dec.data as Uint8Array;
      }
      const pubHex = getPublicKey(nsecBytes);
      userHash = await PrivacyUtils.hashIdentifier(pubHex);
      // Store as bytes so we can zero it on destroySession
      if (this.activeNsecBytes) this.activeNsecBytes.fill(0);
      this.activeNsecBytes = nsecBytes;
    }

    this.userSession = {
      sessionId,
      userHash,
      sessionKey,
      expiresAt,
      userAgent: options?.userAgent,
      authMethod: isNip07 ? "nip07" : "nsec",
    };

    return sessionId;
  }

  async destroySession(): Promise<void> {
    if (this.activeNsecBytes) {
      this.activeNsecBytes.fill(0);
      this.activeNsecBytes = null;
    }
    this.userSession = null;
    this.contactSessions.clear();
    this.groupSessions.clear();
    this.rateLimits.clear();
    try {
      this.getPool().close(this.relays);
    } catch {}
  }

  async getSessionStatus(): Promise<{
    active: boolean;
    sessionId: string | null;
    contactCount: number;
    groupCount: number;
    authMethod?: "nsec" | "nip07";
  }> {
    return {
      active: this.userSession !== null,
      sessionId: this.userSession?.sessionId || null,
      contactCount: this.contactSessions.size,
      groupCount: this.groupSessions.size,
      authMethod: this.userSession?.authMethod,
    };
  }

  // ---- Rate limiting ----

  private checkRateLimit(key: string, max: number, windowMs: number) {
    const now = Date.now();
    const entry = this.rateLimits.get(key);
    if (!entry || now >= entry.resetTime) {
      this.rateLimits.set(key, { count: 1, resetTime: now + windowMs });
      return;
    }
    if (entry.count >= max) {
      const retryIn = Math.max(0, entry.resetTime - now);
      throw new Error(
        `Rate limit exceeded. Retry in ${Math.ceil(retryIn / 1000)}s`
      );
    }
    entry.count += 1;
    this.rateLimits.set(key, entry);
  }

  // ---- Event signing ----

  /**
   * Per-call `onauth` signer for publish/subscribe/list (the reactive
   * "auth-required: " retry path in nostr-tools 2.23.3). Undefined when no
   * session key exists — the operation then fails closed with the relay's
   * auth-required rejection instead of hanging (a throwing signer would
   * leave the pool's authPromise pending — verified behavior, abstract-relay
   * .js lines 327-329).
   */
  private getAuthSigner():
    | ((authTemplate: EventTemplate) => Promise<VerifiedEvent>)
    | undefined {
    if (!this.activeNsecBytes) return undefined;
    return async (authTemplate) => finalizeEvent(authTemplate, this.activeNsecBytes!);
  }

  async signEventWithActiveSession(
    unsignedEvent: Record<string, unknown>
  ): Promise<Event> {
    // NIP-07 path
    if (
      this.userSession?.authMethod === "nip07" &&
      typeof (window as any).nostr?.signEvent === "function"
    ) {
      return (window as any).nostr.signEvent(unsignedEvent);
    }

    if (!this.activeNsecBytes) {
      throw new Error(
        "[CEPS] No active signing key. Initialize session with nsec from OPFS Vault."
      );
    }

    // F-11: Request explicit user consent for non-DM event kinds when using
    // the vault-held nsec. DM kinds (4, 14, 1059) are whitelisted because they
    // are the app's core messaging pipeline. All other kinds require approval.
    const kind = (unsignedEvent as { kind?: number }).kind;
    if (kind !== undefined && ![4, 14, 1059].includes(kind)) {
      const approved = await this.requestSigningConsent(unsignedEvent);
      if (!approved) {
        throw new Error("[CEPS] Signing rejected by user");
      }
    }

    return finalizeEvent(
      unsignedEvent as Parameters<typeof finalizeEvent>[0],
      this.activeNsecBytes
    );
  }

  /**
   * Request consent before signing a non-DM event kind with the vault nsec.
   *
   * F-11 / R2-M-2 fix (2026-08-25, founder Decision 1): the DEFAULT policy is
   * now FAIL-CLOSED WHITELIST. Kinds on CONSENT_AUTO_APPROVED_KINDS are
   * first-party features whose in-app initiation IS the consent act; every
   * other kind is REJECTED by default ("[CEPS] Signing rejected by user" via
   * the gate in signEventWithActiveSession). An injected in-session caller
   * can therefore no longer mint arbitrary-kind events under the user's key.
   *
   * The method stays overridable so a UI confirmation modal can be layered
   * on later without touching this gate again.
   * @internal
   */
  protected async requestSigningConsent(
    unsignedEvent: Record<string, unknown>
  ): Promise<boolean> {
    const kind = (unsignedEvent as { kind?: number }).kind;
    const approved = kind !== undefined && CONSENT_AUTO_APPROVED_KINDS.has(kind);
    if (!approved) {
      // LOUD failure mode (per Security round-2 §6 Option A): a legitimate
      // new kind missing from the whitelist fails visibly here instead of
      // silently signing.
      console.warn(
        "[CEPS] Signing request for non-whitelisted kind:",
        kind
      );
    }
    return approved;
  }

  // ---- Publishing ----

  async publishEvent(event: Event, relays?: string[]): Promise<string> {
    const targetRelays = relays ?? this.relays;
    const pool = this.getPool();
    await Promise.allSettled(
      pool.publish(targetRelays, event, { onauth: this.getAuthSigner() })
    );
    return event.id;
  }

  async publishOptimized(
    event: Event,
    _options?: {
      recipientPubHex?: string;
      senderPubHex?: string;
      includeFallback?: boolean;
    }
  ): Promise<string> {
    // For now, fall through to standard publish. Relay optimization (NIP-65)
    // will be wired in once the OPFS relay list module is built.
    return this.publishEvent(event);
  }

  async publishProfile(
    nsecOrHex: string,
    profileContent: Record<string, unknown>
  ): Promise<string> {
    let nsecHex: string;
    if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
      nsecHex = nsecOrHex;
    } else {
      const dec = nip19.decode(nsecOrHex);
      if (dec.type !== "nsec") throw new Error("Invalid nsec");
      nsecHex = bytesToHex(dec.data as Uint8Array);
    }
    const event = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profileContent),
      },
      hexToBytes(nsecHex)
    );
    return this.publishEvent(event);
  }

  async publishInboxRelaysKind10050(
    relays: string[]
  ): Promise<{ success: boolean; eventId?: string; error?: string }> {
    try {
      const event = await this.signEventWithActiveSession({
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        tags: relays.map((r) => ["relay", r]),
        content: "",
      });
      const eventId = await this.publishEvent(event);
      return { success: true, eventId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ---- Subscriptions ----

  subscribeMany(
    relays: string[],
    filter: Filter,
    handlers: Parameters<SimplePool["subscribeMany"]>[2]
  ) {
    return this.getPool().subscribeMany(relays, filter, {
      ...handlers,
      onauth: handlers.onauth ?? this.getAuthSigner(),
    });
  }

  async list(
    filter: Filter,
    relays: string[],
    _options?: { eoseTimeout?: number }
  ): Promise<Event[]> {
    return this.getPool().querySync(relays, filter, {
      onauth: this.getAuthSigner(),
    } as unknown as Parameters<SimplePool["querySync"]>[2]);
  }

  // ---- Messaging (NIP-04 / NIP-17) ----

  async sendStandardDirectMessage(
    recipientNpub: string,
    plaintext: string
  ): Promise<string> {
    if (!this.activeNsecBytes && this.userSession?.authMethod !== "nip07") {
      throw new Error("[CEPS] No active session for sending messages");
    }

    // CR-C (2026-08-24): true NIP-17/NIP-59 transport replaces NIP-04 kind:4.
    // Pipeline: kind:14 rumor → kind:13 seal (NIP-44, randomized timestamps)
    // → kind:1059 wrap (fresh CSPRNG ephemeral key per message).
    if (!this.activeNsecBytes) {
      throw new Error(
        "[CEPS] Gift-wrapped sending requires a vault nsec session; " +
          "NIP-07 sessions cannot derive seals client-side"
      );
    }

    const { createGiftWrap } = await import("../messaging/gift-wrap");
    // Use the session key directly; createGiftWrap does not retain it
    const { event } = createGiftWrap({
      senderSecret: this.activeNsecBytes,
      recipientNpubOrHex: recipientNpub,
      plaintext,
    });

    return this.publishEvent(event as unknown as Event);
  }

  async sendOTPDM(
    recipientNpub: string,
    _userNip05?: string,
    _prefs?: GiftWrapPreference
  ): Promise<OTPDeliveryResult> {
    try {
      // CR-C (2026-08-24): Math.random() OTP replaced with CSPRNG via
      // crypto.getRandomValues — the old PRNG was predictable under
      // concurrent-timing analysis.
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      const otp = String(100000 + ((buf[0] ?? 0) % 900000));
      const messageId = await this.sendStandardDirectMessage(
        recipientNpub,
        `Your Satnam OTP: ${otp}. Valid for 5 minutes.`
      );
      return {
        success: true,
        otp,
        messageId,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        messageType: "gift-wrap",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ---- Contact management (in-memory) ----

  async addContact(contactData: {
    npub: string;
    displayName: string;
    nip05?: string;
    groupRole?: "private" | "offspring" | "adult" | "steward" | "guardian";
    trustLevel: "group" | "trusted" | "known" | "unverified";
    tags?: string[];
    preferredEncryption?: "gift-wrap" | "nip04" | "auto";
  }): Promise<string> {
    if (!this.userSession) throw new Error("No active session");

    this.checkRateLimit(
      `add_contact:${this.userSession.userHash}`,
      MESSAGING_CONFIG.RATE_LIMITS.ADD_CONTACT_PER_HOUR,
      60 * 60 * 1000
    );

    const contactSessionId = await PrivacyUtils.generateEncryptedUUID();
    const encryptedNpub = await PrivacyUtils.encryptWithSessionKey(
      contactData.npub,
      this.userSession.sessionKey
    );
    const displayNameHash = await PrivacyUtils.hashIdentifier(
      contactData.displayName
    );
    const tagsHash = contactData.tags
      ? await Promise.all(
          contactData.tags.map((t) => PrivacyUtils.hashIdentifier(t))
        )
      : [];

    const contact: PrivacyContact = {
      sessionId: contactSessionId,
      encryptedNpub,
      displayNameHash,
      groupRole: contactData.groupRole,
      trustLevel: contactData.trustLevel,
      supportsGiftWrap: true,
      preferredEncryption: contactData.preferredEncryption || "gift-wrap",
      tagsHash,
      addedAt: new Date(),
      addedByHash: this.userSession.userHash,
    };

    this.contactSessions.set(contactSessionId, contact);
    return contactSessionId;
  }

  async loadAndDecryptContacts(): Promise<
    Array<{
      npub: string;
      relayHints?: string[];
      trustLevel?: string;
      supportsGiftWrap?: boolean;
    }>
  > {
    if (!this.userSession) return [];
    const results: Array<{
      npub: string;
      relayHints?: string[];
      trustLevel?: string;
      supportsGiftWrap?: boolean;
    }> = [];

    for (const contact of this.contactSessions.values()) {
      try {
        const npub = await PrivacyUtils.decryptWithSessionKey(
          contact.encryptedNpub,
          this.userSession.sessionKey
        );
        results.push({
          npub,
          trustLevel: contact.trustLevel,
          supportsGiftWrap: contact.supportsGiftWrap,
        });
      } catch {}
    }

    return results;
  }

  // ---- Key utilities ----

  npubToHex(npub: string): string {
    const dec = nip19.decode(npub);
    if (dec.type === "npub") return dec.data as string;
    throw new Error(`Expected npub, got ${dec.type}`);
  }

  decodeNpub(npub: string): string {
    return this.npubToHex(npub);
  }

  encodeNpub(pubkeyHex: string): string {
    return nip19.npubEncode(pubkeyHex);
  }

  deriveNpubFromNsec(nsec: string): string {
    const dec = nip19.decode(nsec);
    if (dec.type !== "nsec") throw new Error("Invalid nsec");
    const pubHex = getPublicKey(dec.data as Uint8Array);
    return nip19.npubEncode(pubHex);
  }

  derivePubkeyHexFromNsec(nsec: string): string {
    if (/^[0-9a-fA-F]{64}$/.test(nsec)) return getPublicKey(hexToBytes(nsec));
    const dec = nip19.decode(nsec);
    if (dec.type !== "nsec") throw new Error("Invalid nsec");
    return getPublicKey(dec.data as Uint8Array);
  }

  verifyEvent(event: Event): boolean {
    return verifyEvent(event);
  }
}

// ============================================================================
// Singleton export
// ============================================================================

export const central_event_publishing_service =
  new CentralEventPublishingService();



