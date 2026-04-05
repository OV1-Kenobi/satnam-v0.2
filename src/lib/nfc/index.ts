/**
 * NFC barrel export — NTAG424 + PIN Gate + Proof of Life + iOS Fallback
 */

export type {
  NTAG424ProductionConfig,
  NTAG424AuthResponse,
  NTAG424SpendOperation,
  NTAG424SignOperation,
} from "./ntag424.js";

export { NTAG424ProductionManager, ntag424Manager } from "./ntag424.js";

// PIN Gate
export type { PinGateConfig, PinGateState, PinGatedOperation } from "./pin-gate.js";
export { PinGate, createPinGate } from "./pin-gate.js";

// Proof of Life — mutual contact exchange ceremony
export type {
  PolState,
  PolCeremony,
  PeerScanResult,
  AttestationEvents,
} from "./proof-of-life.js";
export {
  ProofOfLifeService,
  POL_EVENT_KIND,
  POL_D_TAG,
  RECIPROCAL_SCAN_TIMEOUT_MS,
  hashCardUid,
} from "./proof-of-life.js";

// iOS Fallback
export type { NfcUrlParams } from "./ios-fallback.js";
export {
  isIos,
  isWebNfcAvailable,
  getNfcMethod,
  parseNfcUrl,
  registerNfcUniversalLinkHandler,
  unregisterNfcUniversalLinkHandler,
  buildNfcUniversalLinkTemplate,
} from "./ios-fallback.js";
