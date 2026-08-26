/**
 * @module frost/node
 * @description Thin, honest wrapper over @frostr/bifrost's BifrostNode for
 * Satnam's FROST integration (FB-1 remediation, 2026-08-25).
 *
 * This module is the ONLY place that constructs BifrostNodes. It exists to:
 * - decode encoded group/share package credentials (`bfgroup1…`/`bfshare1…`)
 * - own the connect/ready/timeout lifecycle
 * - expose a single initiator signing call (`requestGroupSignature`) whose
 *   output is the REAL aggregated FROST signature from BifrostNode's own
 *   machinery (verified against the group pubkey by callers)
 *
 * Co-signing requires no custom code: a connected BifrostNode automatically
 * answers inbound sign requests from peers via its internal handler
 * (node_modules/@frostr/bifrost/dist/class/client.js registers
 * sign_handler_api) as long as it is online on the shared relays with nonce
 * pool capacity. Peers must be online SIMULTANEOUSLY during a request.
 *
 * No simulation lives here. Every failure is surfaced, never fabricated.
 */

import { BifrostNode, PackageEncoder } from '@frostr/bifrost';
import type { GroupPackage, SharePackage } from '@frostr/bifrost';

import { FrostError, frostErr } from './types.js';

/** Default time to wait for node readiness (relay subscriptions + nonce pool). */
export const NODE_CONNECT_TIMEOUT_MS = 15_000;

/** Decode an encoded group package credential (`bfgroup1…`). */
export function decodeGroupPackage(encoded: string): GroupPackage {
  try {
    return PackageEncoder.group.decode(encoded);
  } catch {
    throw frostErr(FrostError.InvalidBackup);
  }
}

/** Decode an encoded share package credential (`bfshare1…`). */
export function decodeSharePackage(encoded: string): SharePackage {
  try {
    return PackageEncoder.share.decode(encoded);
  } catch {
    throw frostErr(FrostError.InvalidBackup);
  }
}

/** Encode packages into transport/storage credentials. */
export function encodeGroupPackage(group: GroupPackage): string {
  return PackageEncoder.group.encode(group);
}

export function encodeSharePackage(share: SharePackage): string {
  return PackageEncoder.share.encode(share);
}

/**
 * Construct and connect a BifrostNode, resolving once the node reports ready
 * (relay subscriptions established). Rejects with FrostError.RelayConnection-
 * Failed / CeremonyTimeout semantics on failure or timeout.
 */
export async function createConnectedNode(params: {
  group: GroupPackage;
  share: SharePackage;
  relays: string[];
  connectTimeoutMs?: number;
}): Promise<BifrostNode> {
  const { group, share, relays, connectTimeoutMs = NODE_CONNECT_TIMEOUT_MS } = params;

  if (relays.length === 0) {
    throw frostErr(FrostError.RelayConnectionFailed);
  }

  const node = new BifrostNode(group, share, relays);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      void node.close().catch(() => {});
      reject(frostErr(FrostError.CeremonyTimeout));
    }, connectTimeoutMs);

    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); clearTimeout(timer); void node.close().catch(() => {}); reject(frostErr(FrostError.RelayConnectionFailed)); };

    function cleanup() {
      clearTimeout(timer);
      node.off('ready', onReady);
      node.off('error', onError);
      node.off('closed', onClose);
    }
    function onClose() { cleanup(); reject(frostErr(FrostError.RelayConnectionFailed)); }

    node.on('ready', onReady);
    node.on('error', onError);
    node.on('closed', onClose);

    void node.connect().catch(() => {
      cleanup();
      reject(frostErr(FrostError.RelayConnectionFailed));
    });
  });

  return node;
}

/** Close a node, swallowing close-time errors (best-effort teardown). */
export async function closeNodeQuietly(node: BifrostNode): Promise<void> {
  try {
    await node.close();
  } catch {
    // best-effort
  }
}

export interface GroupSignatureResult {
  /** 64-byte hex Schnorr signature valid under the group public key */
  signature: string;
  /** Hex group public key the signature verifies against (x-only, 64 chars) */
  groupPubkey: string;
  /** The sighash that was signed */
  sighash: string;
}

/**
 * Initiate a real threshold signing request through the node.
 *
 * Resolves with the aggregated signature produced by BifrostNode's own FROST
 * machinery once threshold peers have responded. The caller is responsible
 * for having constructed this node from ITS OWN share — co-signers must run
 * their own connected nodes to answer.
 *
 * @param node - A connected BifrostNode built from (group pkg, own share pkg)
 * @param sighashHex - 32-byte hex digest to sign (e.g. NIP-01 event id)
 */
export async function requestThresholdSignature(
  node: BifrostNode,
  sighashHex: string,
): Promise<GroupSignatureResult> {
  if (!/^[0-9a-fA-F]{64}$/.test(sighashHex)) {
    throw frostErr(FrostError.AggregationFailed);
  }

  const result = await node.req.sign([sighashHex.toLowerCase()]);
  if (!result.ok || !result.data) {
    // BifrostNode returns structured rejections (timeout / insufficient
    // responses). Surface as AggregationFailed — never fabricate output.
    throw frostErr(FrostError.AggregationFailed);
  }

  const [sighash, pubkey, signature] = result.data;
  return {
    signature,
    groupPubkey: pubkey.startsWith('02') || pubkey.startsWith('03') ? pubkey.slice(2) : pubkey,
    sighash,
  };
}
