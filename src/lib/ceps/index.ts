// Ported from v1 src/lib/ceps/index.ts
// Stripped: JWT auth imports, SecureSessionManager, Supabase session storage
// v2: CEPS is a pure Nostr relay abstraction. Auth is NIP-42, not JWT.

/**
 * CEPS Facade Module
 *
 * Single entry point for all CEPS (Central Event Publishing Service)
 * functionality in the src/ layer. Files under src/ should import from this
 * module instead of directly from `central-event-publishing-service`.
 *
 * v2 architecture notes:
 * - NIP-42 AUTH is handled inside the CEPS pool connection (TODO below)
 * - All session state is ephemeral (no DB storage)
 * - nsec is sourced from OPFS Vault by the caller
 *
 * TODO: Implement NIP-42 AUTH handler in central-event-publishing-service.ts
 *   When Pylon (wss://pylon.openagents.com) sends an AUTH challenge, CEPS
 *   must sign a kind:22242 event with the active session nsec and respond.
 *   Hook: pool.on("auth", (relay, challenge) => sendAuthEvent(relay, challenge))
 *
 * @module ceps
 */

// ============================================================================
// Type-only imports (erased at runtime, safe for static import)
// ============================================================================

export type {
  CepsClient,
  CepsEvent,
  CepsFilter,
  CepsSessionStatus,
  CepsSubscription,
  GiftWrapPreference,
  MessageSendResult,
  OTPDeliveryResult,
  RelayHealthReport,
  RelayHealthStatus,
} from "./ceps-client";

// ============================================================================
// Cached module reference to avoid repeated dynamic imports
// ============================================================================

type CepsClientModule = typeof import("./ceps-client");
let _cepsClientModule: CepsClientModule | null = null;
let _cepsClientPromise: Promise<CepsClientModule> | null = null;

async function loadCepsClientModule(): Promise<CepsClientModule> {
  if (_cepsClientModule) return _cepsClientModule;
  if (!_cepsClientPromise) {
    _cepsClientPromise = import("./ceps-client").then((mod) => {
      _cepsClientModule = mod;
      return mod;
    });
  }
  return _cepsClientPromise;
}

// ============================================================================
// Core CEPS Client Access
// ============================================================================

export async function getCEPS(): Promise<
  Awaited<ReturnType<CepsClientModule["getCepsClient"]>>
> {
  const mod = await loadCepsClientModule();
  return mod.getCepsClient();
}

export const getCepsClient = getCEPS;

export async function getDefaultRelays(): Promise<string[]> {
  const mod = await loadCepsClientModule();
  return mod.getDefaultRelays();
}

// ============================================================================
// Synchronous CEPS Access (for performance-critical paths)
// ============================================================================

let _syncCepsInstance: Awaited<
  ReturnType<CepsClientModule["getCepsClient"]>
> | null = null;

export async function initCEPSSync(): Promise<void> {
  const mod = await loadCepsClientModule();
  _syncCepsInstance = await mod.getCepsClient();
}

export function getCEPSSync(): NonNullable<typeof _syncCepsInstance> {
  if (!_syncCepsInstance) {
    throw new Error(
      "[CEPS] Synchronous access attempted before initialization. " +
        "Call initCEPSSync() or use getCEPS() instead."
    );
  }
  return _syncCepsInstance;
}

export function isCEPSInitialized(): boolean {
  return _syncCepsInstance !== null;
}

// ============================================================================
// Event Publishing API
// ============================================================================

export async function publishEventWithCeps(
  ...args: Parameters<CepsClientModule["publishEventWithCeps"]>
): ReturnType<CepsClientModule["publishEventWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.publishEventWithCeps(...args);
}

export async function publishOptimizedWithCeps(
  ...args: Parameters<CepsClientModule["publishOptimizedWithCeps"]>
): ReturnType<CepsClientModule["publishOptimizedWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.publishOptimizedWithCeps(...args);
}

export async function signEventWithCeps(
  ...args: Parameters<CepsClientModule["signEventWithCeps"]>
): ReturnType<CepsClientModule["signEventWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.signEventWithCeps(...args);
}

// ============================================================================
// Subscription & Query API
// ============================================================================

export async function subscribeWithCeps(
  ...args: Parameters<CepsClientModule["subscribeWithCeps"]>
): ReturnType<CepsClientModule["subscribeWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.subscribeWithCeps(...args);
}

export async function listEventsWithCeps(
  ...args: Parameters<CepsClientModule["listEventsWithCeps"]>
): ReturnType<CepsClientModule["listEventsWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.listEventsWithCeps(...args);
}

// ============================================================================
// Messaging API
// ============================================================================

export async function sendGiftwrappedMessageWithCeps(
  ...args: Parameters<CepsClientModule["sendGiftwrappedMessageWithCeps"]>
): ReturnType<CepsClientModule["sendGiftwrappedMessageWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.sendGiftwrappedMessageWithCeps(...args);
}

export async function sendDirectMessageWithCeps(
  ...args: Parameters<CepsClientModule["sendDirectMessageWithCeps"]>
): ReturnType<CepsClientModule["sendDirectMessageWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.sendDirectMessageWithCeps(...args);
}

export async function sendOTPWithCeps(
  ...args: Parameters<CepsClientModule["sendOTPWithCeps"]>
): ReturnType<CepsClientModule["sendOTPWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.sendOTPWithCeps(...args);
}

// ============================================================================
// Session Management API
// ============================================================================

export async function initializeSessionWithCeps(
  ...args: Parameters<CepsClientModule["initializeSessionWithCeps"]>
): ReturnType<CepsClientModule["initializeSessionWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.initializeSessionWithCeps(...args);
}

export async function getSessionStatusWithCeps(): ReturnType<
  CepsClientModule["getSessionStatusWithCeps"]
> {
  const mod = await loadCepsClientModule();
  return mod.getSessionStatusWithCeps();
}

export async function endSessionWithCeps(): ReturnType<
  CepsClientModule["endSessionWithCeps"]
> {
  const mod = await loadCepsClientModule();
  return mod.endSessionWithCeps();
}

// ============================================================================
// Relay Management API
// ============================================================================

export async function getRelaysWithCeps(): ReturnType<
  CepsClientModule["getRelaysWithCeps"]
> {
  const mod = await loadCepsClientModule();
  return mod.getRelaysWithCeps();
}

export async function setRelaysWithCeps(
  ...args: Parameters<CepsClientModule["setRelaysWithCeps"]>
): ReturnType<CepsClientModule["setRelaysWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.setRelaysWithCeps(...args);
}

export async function getRelayHealthWithCeps(
  ...args: Parameters<CepsClientModule["getRelayHealthWithCeps"]>
): ReturnType<CepsClientModule["getRelayHealthWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.getRelayHealthWithCeps(...args);
}

// ============================================================================
// Key Conversion Utilities
// ============================================================================

export async function npubToHexWithCeps(
  ...args: Parameters<CepsClientModule["npubToHexWithCeps"]>
): ReturnType<CepsClientModule["npubToHexWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.npubToHexWithCeps(...args);
}

export async function encodeNpubWithCeps(
  ...args: Parameters<CepsClientModule["encodeNpubWithCeps"]>
): ReturnType<CepsClientModule["encodeNpubWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.encodeNpubWithCeps(...args);
}

export async function decodeNpubWithCeps(
  ...args: Parameters<CepsClientModule["decodeNpubWithCeps"]>
): ReturnType<CepsClientModule["decodeNpubWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.decodeNpubWithCeps(...args);
}

export async function deriveNpubFromNsecWithCeps(
  ...args: Parameters<CepsClientModule["deriveNpubFromNsecWithCeps"]>
): ReturnType<CepsClientModule["deriveNpubFromNsecWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.deriveNpubFromNsecWithCeps(...args);
}

export async function derivePubkeyHexFromNsecWithCeps(
  ...args: Parameters<CepsClientModule["derivePubkeyHexFromNsecWithCeps"]>
): ReturnType<CepsClientModule["derivePubkeyHexFromNsecWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.derivePubkeyHexFromNsecWithCeps(...args);
}

// ============================================================================
// Profile & Contacts API
// ============================================================================

export async function publishProfileWithCeps(
  ...args: Parameters<CepsClientModule["publishProfileWithCeps"]>
): ReturnType<CepsClientModule["publishProfileWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.publishProfileWithCeps(...args);
}

export async function publishInboxRelaysWithCeps(
  ...args: Parameters<CepsClientModule["publishInboxRelaysWithCeps"]>
): ReturnType<CepsClientModule["publishInboxRelaysWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.publishInboxRelaysWithCeps(...args);
}

export async function loadContactsWithCeps(): ReturnType<
  CepsClientModule["loadContactsWithCeps"]
> {
  const mod = await loadCepsClientModule();
  return mod.loadContactsWithCeps();
}

// ============================================================================
// Event Verification
// ============================================================================

export async function verifyEventWithCeps(
  ...args: Parameters<CepsClientModule["verifyEventWithCeps"]>
): ReturnType<CepsClientModule["verifyEventWithCeps"]> {
  const mod = await loadCepsClientModule();
  return mod.verifyEventWithCeps(...args);
}
