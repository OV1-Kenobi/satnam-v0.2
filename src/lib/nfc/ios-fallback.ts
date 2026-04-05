/**
 * @module nfc/ios-fallback
 * @description iOS NFC Universal Link handler and platform detection.
 *
 * Web NFC API is Android Chrome-only. For iOS:
 * 1. Register satnam.pub/nfc/{card_uid} as a Universal Link.
 * 2. When an NTAG424 card is tapped on iOS, the SUN URL triggers Safari
 *    to open the Universal Link.
 * 3. The URL includes piccDataHex and cmacHex as query parameters.
 * 4. The Satnam PWA intercepts the URL and runs the same CMAC verification.
 *
 * URL pattern: https://satnam.pub/nfc/{card_uid}?piccData={hex}&cmac={hex}
 *
 * @see SPECIFICATION.md §5.5 — iOS NFC Fallback
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NfcUrlParams {
  cardUid: string;
  piccDataHex: string;
  cmacHex: string;
}

type NfcUniversalLinkCallback = (params: NfcUrlParams) => void;

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the current platform is iOS (iPhone, iPad, iPod).
 * Web NFC API is not available on iOS — use Universal Link fallback.
 */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Macintosh with touch support
    (navigator.userAgent.includes('Macintosh') &&
      'ontouchend' in document);
}

/**
 * Returns true if the Web NFC API is available (Android Chrome 89+).
 */
export function isWebNfcAvailable(): boolean {
  return typeof window !== 'undefined' && 'NDEFReader' in window;
}

/**
 * Returns the NFC access method available on the current platform.
 */
export function getNfcMethod(): 'web-nfc' | 'universal-link' | 'none' {
  if (isWebNfcAvailable()) return 'web-nfc';
  if (isIos()) return 'universal-link';
  return 'none';
}

// ---------------------------------------------------------------------------
// URL Parser
// ---------------------------------------------------------------------------

/**
 * Parse NFC parameters from a Universal Link / SUN URL.
 *
 * Supported URL formats:
 * - https://satnam.pub/nfc/{cardUid}?piccData={hex}&cmac={hex}
 * - https://satnam.pub/nfc/{cardUid}?piccdata={hex}&cmac={hex}  (case-insensitive)
 * - Any URL with /nfc/ path segment followed by a UID
 *
 * @param url - Full URL string (may be current window.location.href)
 * @returns Parsed NFC params or null if URL doesn't match the NFC pattern
 */
export function parseNfcUrl(url: string): NfcUrlParams | null {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Find the /nfc/{uid} path segment
    const nfcIndex = pathParts.findIndex(p => p.toLowerCase() === 'nfc');
    if (nfcIndex === -1 || nfcIndex + 1 >= pathParts.length) {
      return null;
    }

    const cardUid = pathParts[nfcIndex + 1];
    if (!cardUid || !/^[0-9a-fA-F]{8,28}$/.test(cardUid)) {
      return null;
    }

    // Extract piccData and cmac (case-insensitive parameter names)
    const params = parsed.searchParams;
    const piccDataHex =
      params.get('piccData') ??
      params.get('piccdata') ??
      params.get('PICCData') ??
      params.get('piccDataHex') ??
      '';

    const cmacHex =
      params.get('cmac') ??
      params.get('CMAC') ??
      params.get('cmacHex') ??
      '';

    if (!piccDataHex || !cmacHex) return null;

    // Validate hex format
    if (!/^[0-9a-fA-F]+$/.test(piccDataHex)) return null;
    if (!/^[0-9a-fA-F]+$/.test(cmacHex)) return null;

    return {
      cardUid: cardUid.toLowerCase(),
      piccDataHex: piccDataHex.toLowerCase(),
      cmacHex: cmacHex.toLowerCase(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Universal Link Handler
// ---------------------------------------------------------------------------

/** Active callback registered via registerNfcUniversalLinkHandler */
let _universalLinkCallback: NfcUniversalLinkCallback | null = null;

/** Whether the popstate listener has been registered */
let _listenerRegistered = false;

/**
 * Register the Universal Link handler for iOS NFC taps.
 *
 * Installs a window popstate listener and immediately checks whether the
 * current URL is an NFC Universal Link (handles the case where the user
 * opened the app directly from a card tap).
 *
 * The callback is invoked with the parsed NFC parameters when:
 * 1. The page loads with an NFC Universal Link URL
 * 2. The URL changes to an NFC Universal Link via pushState/replaceState
 *
 * @param callback - Function called with NFC params on every matching URL
 */
export function registerNfcUniversalLinkHandler(
  callback: NfcUniversalLinkCallback,
): void {
  _universalLinkCallback = callback;

  if (typeof window === 'undefined') return;

  // Check current URL immediately (app opened by tapping a card)
  const currentParams = parseNfcUrl(window.location.href);
  if (currentParams) {
    // Defer to next tick so caller can set up state before callback fires
    setTimeout(() => callback(currentParams), 0);
  }

  if (!_listenerRegistered) {
    _listenerRegistered = true;

    // Handle browser back/forward navigation
    window.addEventListener('popstate', () => {
      if (!_universalLinkCallback) return;
      const params = parseNfcUrl(window.location.href);
      if (params) _universalLinkCallback(params);
    });

    // Intercept pushState / replaceState to catch SPA navigation
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
      originalPushState(...args);
      if (_universalLinkCallback) {
        const params = parseNfcUrl(window.location.href);
        if (params) setTimeout(() => _universalLinkCallback?.(params), 0);
      }
    };

    history.replaceState = function (...args) {
      originalReplaceState(...args);
      if (_universalLinkCallback) {
        const params = parseNfcUrl(window.location.href);
        if (params) setTimeout(() => _universalLinkCallback?.(params), 0);
      }
    };
  }
}

/**
 * Unregister the Universal Link handler (call on component unmount).
 */
export function unregisterNfcUniversalLinkHandler(): void {
  _universalLinkCallback = null;
}

// ---------------------------------------------------------------------------
// Build NFC Universal Link URL (for NTAG424 programming)
// ---------------------------------------------------------------------------

/**
 * Build an NFC Universal Link URL to be programmed into an NTAG424 card's
 * SUN URL template.
 *
 * The resulting URL should be set as the NDEF URI record on the card with
 * SDM (Secure Dynamic Messaging) parameters configured to inject piccData
 * and cmac values at scan time.
 *
 * @param baseUrl - Base URL of the Satnam PWA (default: https://satnam.pub)
 * @param cardUid - 7-byte card UID hex string
 * @returns Universal Link URL template string
 */
export function buildNfcUniversalLinkTemplate(
  cardUid: string,
  baseUrl = 'https://satnam.pub',
): string {
  // The actual piccData and cmac will be injected by the NTAG424 SDM engine.
  // This is the static template programmed onto the card.
  return `${baseUrl}/nfc/${cardUid.toLowerCase()}?piccData=PICC_DATA_PLACEHOLDER&cmac=CMAC_PLACEHOLDER`;
}
