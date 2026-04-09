/**
 * @module pylon/auth
 * @description NIP-42 AUTH challenge/response handler for the Pylon relay.
 *
 * ## NIP-42 AUTH Flow
 *
 * 1. Open WebSocket to `wss://pylon.openagents.com`
 * 2. Relay sends `["AUTH", "<challenge_string>"]`
 * 3. Client constructs a kind:22242 auth event with `relay` and `challenge` tags
 * 4. Client signs the event with the Principal's nsec (from OPFS Vault)
 * 5. Client sends `["AUTH", <signed_event>]`
 * 6. Relay verifies the signature and grants authenticated access
 *
 * The kind:22242 event structure per NIP-42:
 * ```json
 * {
 *   "kind": 22242,
 *   "tags": [
 *     ["relay", "wss://pylon.openagents.com"],
 *     ["challenge", "<challenge_string>"]
 *   ],
 *   "content": ""
 * }
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/42.md
 * @see phase4-spec-sections-8-9.md §8.3
 */

import { finalizeEvent, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { Event as NostrEvent } from 'nostr-tools';
import type { Vault } from '../vault/vault.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Pylon relay WebSocket URL. */
export const PYLON_RELAY_URL = 'wss://pylon.openagents.com' as const;

/** NIP-42 AUTH event kind. */
const NIP42_KIND = 22242;

/** WebSocket close codes */
const WS_NORMAL_CLOSE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Connection state machine. */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated';

/** Internal message listener callback. */
type MessageListener = (data: string) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode an nsec bech32 or 64-char hex string to raw secret key bytes.
 * @internal
 */
function decodeSecretKey(nsecOrHex: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    return hexToBytes(nsecOrHex);
  }
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = nip19.decode(nsecOrHex);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected nsec bech32 string, got: ' + decoded.type);
    }
    return decoded.data as Uint8Array;
  }
  throw new Error(
    'Invalid secret key format — expected nsec bech32 or 64-char hex'
  );
}

// ---------------------------------------------------------------------------
// PylonAuth
// ---------------------------------------------------------------------------

/**
 * NIP-42 AUTH challenge/response handler for the Pylon relay.
 *
 * Manages a single authenticated WebSocket connection to Pylon.
 * The connection is established lazily on the first call to `connect()`.
 *
 * @example
 * ```typescript
 * const auth = new PylonAuth(vault);
 * const ws = await auth.connect('wss://pylon.openagents.com');
 * console.log(auth.isAuthenticated()); // true after successful AUTH
 *
 * // On disconnect:
 * auth.disconnect();
 * ```
 */
export class PylonAuth {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private pendingNsec: string | null = null;
  private readonly listeners: Set<MessageListener> = new Set();

  /**
   * @param vault - OPFS Vault instance for retrieving the Principal's nsec
   */
  constructor(private readonly vault: Vault) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Connect to the Pylon relay with automatic NIP-42 AUTH.
   *
   * Opens a WebSocket connection to the specified relay URL, waits for the
   * AUTH challenge, signs a kind:22242 event with the Principal's nsec
   * from the OPFS Vault, and sends the AUTH response.
   *
   * @param relayUrl - WebSocket relay URL (defaults to Pylon)
   * @param signerNsec - Optional nsec override; if omitted, reads from Vault.
   *   The nsec may be a bech32 nsec1 string or a 64-char hex string.
   * @returns Authenticated WebSocket instance
   * @throws If the relay is unreachable or authentication fails
   */
  async connect(
    relayUrl: string = PYLON_RELAY_URL,
    signerNsec?: string
  ): Promise<WebSocket> {
    // Reuse existing authenticated connection if available
    if (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.state === 'authenticated'
    ) {
      return this.ws;
    }

    // Close any stale connection
    if (this.ws !== null) {
      this.ws.close(WS_NORMAL_CLOSE, 'Reconnecting');
      this.ws = null;
      this.state = 'disconnected';
    }

    // Retrieve nsec — either provided or from vault
    let nsec: string;
    if (signerNsec) {
      nsec = signerNsec;
    } else {
      // Fall back to the first identity in the vault (Principal)
      const identities = await this.vault.listIdentities();
      if (identities.length === 0) {
        throw new Error('[PylonAuth] No identities found in vault — provide signerNsec or unlock vault');
      }
      const principalNpub = identities[0]!;
      const nsecBytes = await this.vault.getNsec(principalNpub);
      // Convert raw bytes to hex string for internal use
      nsec = Array.from(nsecBytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    this.pendingNsec = nsec;

    return this._openAndAuthenticate(relayUrl, nsec);
  }

  /**
   * Handle an AUTH challenge received from the relay.
   *
   * Constructs and signs a kind:22242 AUTH response event using the
   * provided nsec. The signed event is broadcast back via the active
   * WebSocket connection.
   *
   * @param challenge - Challenge string received from `["AUTH", "<challenge>"]`
   * @param relayUrl - Relay URL included in the auth event's relay tag
   * @returns The signed kind:22242 AUTH event
   * @throws If the connection is not open or signing fails
   */
  async handleChallenge(
    challenge: string,
    relayUrl: string
  ): Promise<NostrEvent> {
    if (!this.pendingNsec) {
      throw new Error('[PylonAuth] handleChallenge called without an active nsec — call connect() first');
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('[PylonAuth] WebSocket is not open — cannot respond to AUTH challenge');
    }

    const authEvent = this._buildAuthEvent(challenge, relayUrl, this.pendingNsec);

    // Send the AUTH response
    const message = JSON.stringify(['AUTH', authEvent]);
    this.ws.send(message);

    return authEvent;
  }

  /**
   * Check whether the current connection has been authenticated.
   */
  isAuthenticated(): boolean {
    return this.state === 'authenticated';
  }

  /**
   * Return the current connection state.
   */
  getConnectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Return the active WebSocket instance, or null if disconnected.
   */
  getWebSocket(): WebSocket | null {
    return this.ws;
  }

  /**
   * Disconnect from the relay, closing the WebSocket connection cleanly.
   * Clears all internal state.
   */
  disconnect(): void {
    this.pendingNsec = null;
    this.state = 'disconnected';
    this.listeners.clear();

    if (this.ws !== null) {
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close(WS_NORMAL_CLOSE, 'Client disconnect');
      }
      this.ws = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Open a WebSocket and orchestrate the NIP-42 AUTH handshake.
   * Resolves once the connection is authenticated (or rejects on error/timeout).
   * @internal
   */
  private _openAndAuthenticate(
    relayUrl: string,
    nsec: string
  ): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const AUTH_TIMEOUT_MS = 15_000;

      let ws: WebSocket;
      try {
        ws = new WebSocket(relayUrl);
      } catch (err) {
        reject(new Error(`[PylonAuth] Failed to open WebSocket to ${relayUrl}: ${err}`));
        return;
      }

      this.ws = ws;
      this.state = 'connecting';

      const timeout = setTimeout(() => {
        ws.close(WS_NORMAL_CLOSE, 'AUTH timeout');
        reject(new Error(`[PylonAuth] Authentication timeout after ${AUTH_TIMEOUT_MS}ms`));
      }, AUTH_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        this.state = 'connected';
      });

      ws.addEventListener('message', async (event: MessageEvent) => {
        // Notify all registered listeners
        this.listeners.forEach((l) => l(event.data as string));

        let msg: unknown;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return; // Ignore unparseable messages
        }

        if (!Array.isArray(msg) || msg.length < 2) return;

        const [type] = msg;

        if (type === 'AUTH' && typeof msg[1] === 'string') {
          // Relay sent an AUTH challenge
          const challenge = msg[1] as string;
          try {
            const authEvent = this._buildAuthEvent(challenge, relayUrl, nsec);
            ws.send(JSON.stringify(['AUTH', authEvent]));
          } catch (err) {
            clearTimeout(timeout);
            reject(new Error(`[PylonAuth] Failed to sign AUTH challenge: ${err}`));
          }
        } else if (type === 'OK') {
          // Relay accepted the AUTH response — connection is now authenticated
          clearTimeout(timeout);
          this.state = 'authenticated';
          resolve(ws);
        } else if (type === 'NOTICE' && typeof msg[1] === 'string') {
          const notice = msg[1] as string;
          if (notice.toLowerCase().includes('auth-required') ||
              notice.toLowerCase().includes('authentication failed')) {
            clearTimeout(timeout);
            reject(new Error(`[PylonAuth] AUTH rejected by relay: ${notice}`));
          }
        }
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timeout);
        this.state = 'disconnected';
        reject(new Error(`[PylonAuth] WebSocket error on ${relayUrl}: ${JSON.stringify(err)}`));
      });

      ws.addEventListener('close', (event: CloseEvent) => {
        clearTimeout(timeout);
        if (this.state !== 'authenticated') {
          this.state = 'disconnected';
          reject(
            new Error(
              `[PylonAuth] WebSocket closed before authentication (code ${event.code}: ${event.reason})`
            )
          );
        } else {
          this.state = 'disconnected';
        }
        this.ws = null;
      });
    });
  }

  /**
   * Build and sign a NIP-42 kind:22242 AUTH event.
   * @internal
   */
  private _buildAuthEvent(
    challenge: string,
    relayUrl: string,
    nsec: string
  ): NostrEvent {
    const secretKey = decodeSecretKey(nsec);

    const unsigned = {
      kind: NIP42_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['relay', relayUrl],
        ['challenge', challenge],
      ],
      content: '',
    };

    return finalizeEvent(unsigned, secretKey) as NostrEvent;
  }

  /**
   * Register a raw message listener on the WebSocket.
   * Returns an unsubscribe function.
   * @internal — used by PylonCepsClient to multiplex relay messages.
   */
  _addMessageListener(listener: MessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

