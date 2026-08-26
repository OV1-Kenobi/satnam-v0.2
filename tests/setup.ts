import '@testing-library/jest-dom';
import { vi } from 'vitest';

/**
 * FROST remediation (2026-08-25): @vbyte/nostr-sdk's OPTIONAL relay-server
 * module imports { WebSocketServer } from 'ws' at top level. Under vitest,
 * the CJS 'ws' package is externalized and its named exports aren't
 * statically detectable, so any file whose graph touches @frostr/bifrost
 * fails at import time — even though the server code is never used (Satnam
 * speaks over the global WebSocket client-side).
 *
 * Global stub: provides inert classes so the import resolves. Individual
 * FROST tests replace globalThis.WebSocket with an in-process loopback
 * transport when they need real node-to-node traffic.
 */
vi.mock('ws', () => {
  class WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
  }
  class WebSocketServer {}
  return {
    WebSocket,
    WebSocketServer,
    createWebSocketStream: vi.fn(),
    Server: WebSocketServer,
    default: { WebSocket, WebSocketServer, createWebSocketStream: vi.fn() },
  };
});
