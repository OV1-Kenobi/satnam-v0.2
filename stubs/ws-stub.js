/**
 * Browser/test-safe stub for the Node-only 'ws' package.
 *
 * @vbyte/nostr-sdk's dist/class/relay.js imports { WebSocketServer } from
 * 'ws' at top level for its OPTIONAL relay-SERVER feature. Satnam only uses
 * the CLIENT side (BifrostNode), which talks over the standard global
 * WebSocket — so both vite (build) and vitest alias 'ws' to this empty
 * stub. The server code path is never invoked; importing it must simply not
 * explode. See engineering notes 2026-08-25 (FROST remediation).
 */

export class WebSocket {}
export class WebSocketServer {}

export default { WebSocket, WebSocketServer };
