// Ported from v1 src/lib/ceps/ceps-client.ts
// Stripped: SecureSessionManager, getSupabaseClient, JWT auth, session DB storage
// Replaced: initializeSession now accepts nsec directly (OPFS Vault provides it)
// Added: TODO for NIP-42 AUTH handler

/**
 * CEPS Client Interface Layer
 *
 * Small, stable wrapper around the CentralEventPublishingService (CEPS) that
 * provides a lazy-loaded, TDZ-safe boundary for browser code.
 *
 * IMPORTANT:
 * - UI and service modules should depend on this file instead of importing
 *   central-event-publishing-service directly.
 * - CEPS is loaded lazily via dynamic import so it lives in its own chunk and
 *   is only initialized when actually needed.
 * - This module must remain UI-free (no React, no components).
 * - Zero key material stored server-side. Nsec lives in OPFS Vault only.
 * - Never logs secret material (nsec, private keys).
 *
 * @module ceps-client
 */

// ============================================================================
// Environment Configuration (TDZ-safe via lazy getter pattern)
// ============================================================================

const FALLBACK_RELAYS = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
] as const;

let _cachedDefaultRelays: string[] | null = null;

export function getDefaultRelays(): string[] {
  if (_cachedDefaultRelays === null) {
    const raw =
      (typeof import.meta !== "undefined"
        ? (import.meta as any).env?.VITE_NOSTR_RELAYS
        : undefined) ?? "";
    _cachedDefaultRelays = raw
      ? raw
          .split(",")
          .map((r: string) => r.trim())
          .filter(Boolean)
      : [...FALLBACK_RELAYS];
  }
  return _cachedDefaultRelays!;
}

// Legacy proxy alias for backward compatibility
// ============================================================================
// Types
// ============================================================================

import type { Filter as NostrFilter } from 'nostr-tools';

type CepsModule = typeof import("./central-event-publishing-service");

type CepsInstance = CepsModule["central_event_publishing_service"];

export type CepsClient = CepsInstance;
export type CepsEvent = Parameters<CepsInstance["publishEvent"]>[0];
export type CepsFilter = NostrFilter;
export type CepsSubscription = ReturnType<CepsInstance["subscribeMany"]>;

export interface MessageSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  signingMethod?: string;
  securityLevel?: string;
  deliveryTime?: string;
}

export interface RelayHealthStatus {
  url: string;
  connected: boolean;
  latencyMs?: number;
  lastChecked: Date;
  error?: string;
}

export interface RelayHealthReport {
  relays: RelayHealthStatus[];
  healthyCount: number;
  totalCount: number;
  timestamp: Date;
}

export interface CepsSessionStatus {
  active: boolean;
  sessionId: string | null;
  contactCount: number;
  groupCount: number;
  authMethod?: "nsec" | "nip07";
}

export interface GiftWrapPreference {
  preferGiftWrap?: boolean;
  fallbackRelays?: string[];
}

export interface OTPDeliveryResult {
  success: boolean;
  otp?: string;
  messageId?: string;
  expiresAt?: Date;
  messageType?: "gift-wrap" | "nip04";
  error?: string;
}

// ============================================================================
// Lazy Loading Infrastructure
// ============================================================================

let cepsPromise: Promise<CepsInstance> | undefined;

async function loadCeps(): Promise<CepsInstance> {
  if (!cepsPromise) {
    cepsPromise = (async () => {
      const mod: CepsModule = await import("./central-event-publishing-service");
      return mod.central_event_publishing_service;
    })();
  }
  return cepsPromise;
}

// ============================================================================
// Core Client Access
// ============================================================================

export async function getCepsClient(): Promise<CepsClient> {
  return loadCeps();
}

// ============================================================================
// Event Publishing API
// ============================================================================

export async function publishEventWithCeps(
  event: CepsEvent,
  relays?: string[]
): Promise<string> {
  const ceps = await loadCeps();
  return ceps.publishEvent(event, relays);
}

export async function publishOptimizedWithCeps(
  event: CepsEvent,
  options?: {
    recipientPubHex?: string;
    senderPubHex?: string;
    includeFallback?: boolean;
  }
): Promise<string> {
  const ceps = await loadCeps();
  return ceps.publishOptimized(event, options);
}

export async function signEventWithCeps(
  unsignedEvent: Record<string, unknown>
): Promise<CepsEvent> {
  const ceps = await loadCeps();
  return ceps.signEventWithActiveSession(unsignedEvent);
}

// ============================================================================
// Subscription API
// ============================================================================

export async function subscribeWithCeps(
  relays: string[],
  filters: CepsFilter[],
  handlers: Parameters<CepsInstance["subscribeMany"]>[2]
): Promise<CepsSubscription> {
  const ceps = await loadCeps();
  return ceps.subscribeMany(relays, filters, handlers);
}

export async function listEventsWithCeps(
  filters: CepsFilter[],
  relays?: string[],
  options?: { eoseTimeout?: number }
): Promise<CepsEvent[]> {
  const ceps = await loadCeps();
  return ceps.list(filters, relays ?? getDefaultRelays(), options);
}

// ============================================================================
// Messaging API
// ============================================================================

export async function sendGiftwrappedMessageWithCeps(
  recipientNpub: string,
  plaintext: string
): Promise<string> {
  const ceps = await loadCeps();
  return ceps.sendStandardDirectMessage(recipientNpub, plaintext);
}

export async function sendDirectMessageWithCeps(
  recipientNpub: string,
  plaintext: string
): Promise<string> {
  const ceps = await loadCeps();
  return ceps.sendStandardDirectMessage(recipientNpub, plaintext);
}

export async function sendOTPWithCeps(
  recipientNpub: string,
  userNip05?: string,
  prefs?: GiftWrapPreference
): Promise<OTPDeliveryResult> {
  const ceps = await loadCeps();
  return ceps.sendOTPDM(recipientNpub, userNip05, prefs);
}

// ============================================================================
// Session Management API
// v2: nsec is sourced from OPFS Vault by the caller — never from server storage.
// ============================================================================

export async function initializeSessionWithCeps(
  nsecOrMarker: string,
  options?: {
    userAgent?: string;
    ttlHours?: number;
    authMethod?: "nip07";
    npub?: string;
  }
): Promise<string> {
  const ceps = await loadCeps();
  // v2: No IP address tracking. No server-side session storage.
  return ceps.initializeSession(nsecOrMarker, options);
}

export async function getSessionStatusWithCeps(): Promise<CepsSessionStatus> {
  const ceps = await loadCeps();
  return ceps.getSessionStatus();
}

export async function endSessionWithCeps(): Promise<void> {
  const ceps = await loadCeps();
  return ceps.destroySession();
}

// ============================================================================
// Relay Health API
// ============================================================================

export async function getRelaysWithCeps(): Promise<string[]> {
  const ceps = await loadCeps();
  return ceps.getRelays();
}

export async function setRelaysWithCeps(relays: string[]): Promise<void> {
  const ceps = await loadCeps();
  ceps.setRelays(relays);
}

export async function getRelayHealthWithCeps(
  relays?: string[]
): Promise<RelayHealthReport> {
  const ceps = await loadCeps();
  const relayList = relays ?? ceps.getRelays();
  const results: RelayHealthStatus[] = [];
  const now = new Date();

  for (const url of relayList) {
    const startTime = Date.now();
    try {
      await Promise.race([
        ceps.list([{ kinds: [0], limit: 1 }], [url], { eoseTimeout: 3000 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 5000)
        ),
      ]);
      results.push({
        url,
        connected: true,
        latencyMs: Date.now() - startTime,
        lastChecked: now,
      });
    } catch (error) {
      results.push({
        url,
        connected: false,
        lastChecked: now,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    relays: results,
    healthyCount: results.filter((r) => r.connected).length,
    totalCount: results.length,
    timestamp: now,
  };
}

// ============================================================================
// Key Conversion Utilities
// ============================================================================

export async function npubToHexWithCeps(npub: string): Promise<string> {
  const ceps = await loadCeps();
  return ceps.npubToHex(npub);
}

export async function encodeNpubWithCeps(pubkeyHex: string): Promise<string> {
  const ceps = await loadCeps();
  return ceps.encodeNpub(pubkeyHex);
}

export async function decodeNpubWithCeps(npub: string): Promise<string> {
  const ceps = await loadCeps();
  return ceps.decodeNpub(npub);
}

export async function deriveNpubFromNsecWithCeps(nsec: string): Promise<string> {
  const ceps = await loadCeps();
  return ceps.deriveNpubFromNsec(nsec);
}

export async function derivePubkeyHexFromNsecWithCeps(nsec: string): Promise<string> {
  const ceps = await loadCeps();
  return ceps.derivePubkeyHexFromNsec(nsec);
}

// ============================================================================
// Profile & Identity API
// ============================================================================

export async function publishProfileWithCeps(
  privateNsec: string,
  profileContent: Record<string, unknown>
): Promise<string> {
  const ceps = await loadCeps();
  return ceps.publishProfile(privateNsec, profileContent);
}

export async function publishInboxRelaysWithCeps(
  relays: string[]
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const ceps = await loadCeps();
  return ceps.publishInboxRelaysKind10050(relays);
}

export async function loadContactsWithCeps(): Promise<
  Array<{
    npub: string;
    relayHints?: string[];
    trustLevel?: string;
    supportsGiftWrap?: boolean;
  }>
> {
  const ceps = await loadCeps();
  return ceps.loadAndDecryptContacts();
}

// ============================================================================
// Event Verification API
// ============================================================================

export async function verifyEventWithCeps(event: CepsEvent): Promise<boolean> {
  const ceps = await loadCeps();
  return ceps.verifyEvent(event);
}

