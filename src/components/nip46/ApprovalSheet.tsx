/**
 * @module nip46/ApprovalSheet
 * @description Per-request approval sheet UI for the NIP-46 bunker (WP-2).
 *
 * Renders the §3.4 approval surface per spec:
 * - Requesting client npub (from NIP-46 pairing) — bech32 npub + truncated hex
 * - Event kind number + human summary (display-only; never grants anything)
 * - Explicit [Approve] [Reject] buttons — always rendered together
 * - Optional: relay origin (spec §3.5) when available
 *
 * EXPLICIT EXCLUSIONS (founder non-negotiable 1 — NO auto-approve):
 * - No auto-approve control
 * - No "remember this decision" persistence
 * - No timeout-approve
 * - No batch approval
 * - No keyboard-only shortcut that fires without the tap
 *
 * This is a deliberate contrast with the existing in-repo approval precedent
 * `src/components/probe/ToolCallApproval.tsx`, whose docstring lists an
 * "Auto-approve toggle for trusted tools" — that pattern is NOT copied here.
 *
 * The sheet has no access to any secret; it renders a memory-resident pending
 * request only. Secret material is never displayed.
 */

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pending NIP-46 request awaiting human approval. */
export interface PendingRequest {
  /** Unique request identifier (UUID). */
  id: string;
  /** Requesting client's hex pubkey (resolved from pairing). */
  clientPubkey: string;
  /** Event kind number. */
  eventKind: number;
  /** Human-readable summary of the unsigned event (display-only). */
  summary: string;
  /** Optional: relay URL the request arrived on (spec §3.5). */
  originRelay?: string;
}

/** Props for the ApprovalSheet component. */
export interface ApprovalSheetProps {
  /** The pending request to display, or null to render nothing. */
  request: PendingRequest | null;
  /**
   * Called when the user taps Approve. The caller loads nsec, signs,
   * zeroizes the buffer, and publishes the response.
   */
  onApprove: (requestId: string) => void;
  /**
   * Called when the user taps Reject. The caller sends
   * {id, result: null, error: "user_rejected"} (spec §3.2).
   */
  onReject: (requestId: string) => void;
  /** Called when the sheet is dismissed (X button or outside click). */
  onClose?: () => void;
  /** Whether the vault is currently unlocked (gate for Approve tap). */
  vaultUnlocked?: boolean;
  /** Optional label for the Approve button (default "Approve"). */
  approveLabel?: string;
  /** Optional label for the Reject button (default "Reject"). */
  rejectLabel?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a hex pubkey for display (first 8 + last 4 chars). */
function truncateHex(hex: string): string {
  if (hex.length < 12) return hex;
  return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
}

/** Format a bech32 npub from a hex pubkey (placeholder; real impl uses nip19). */
function hexToNpub(hex: string): string {
  // Placeholder: real impl would use nip19.npub_encode(hex)
  return `npub1${hex.slice(0, 52)}...`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * ApprovalSheet — the per-request human approval surface for NIP-46 remote signing.
 *
 * Renders only when a request is present. The sheet is modal: it blocks
 * interaction with the rest of the app until the user taps Approve or Reject.
 * There is no auto-approve, no timeout-approve, no batch approval.
 */
export function ApprovalSheet({
  request,
  onApprove,
  onReject,
  onClose,
  vaultUnlocked = true,
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
}: ApprovalSheetProps): React.JSX.Element | null {
  const [tappedApprove, setTappedApprove] = useState(false);
  const [tappedReject, setTappedReject] = useState(false);

  // Reset tap state when a new request arrives
  useEffect(() => {
    setTappedApprove(false);
    setTappedReject(false);
  }, [request?.id]);

  if (request === null) {
    return null;
  }

  const handleApprove = (): void => {
    if (tappedApprove) return; // prevent double-tap
    setTappedApprove(true);
    onApprove(request.id);
  };

  const handleReject = (): void => {
    if (tappedReject) return; // prevent double-tap
    setTappedReject(true);
    onReject(request.id);
  };

  const handleDismiss = (): void => {
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-sheet-title"
    >
      <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-900">
        {/* Dismiss button (X) */}
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <h2
          id="approval-sheet-title"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          Approval Required
        </h2>

        {/* Request details */}
        <div className="mb-6 space-y-3">
          {/* Client npub (bech32 + truncated hex) */}
          <div>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Requesting client
            </span>
            <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
              {hexToNpub(request.clientPubkey)}
            </p>
            <p className="font-mono text-xs text-gray-400 dark:text-gray-500">
              {truncateHex(request.clientPubkey)}
            </p>
          </div>

          {/* Event kind + summary (display-only; never grants anything) */}
          <div>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Event kind
            </span>
            <p className="mt-1 font-mono text-sm text-gray-900 dark:text-gray-100">
              {request.eventKind}
            </p>
          </div>

          <div>
            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Summary
            </span>
            <p className="mt-1 text-sm text-gray-900 dark:text-gray-100">
              {request.summary}
            </p>
          </div>

          {/* Optional: relay origin (spec §3.5) */}
          {request.originRelay && (
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Origin relay
              </span>
              <p className="mt-1 font-mono text-xs text-gray-400 dark:text-gray-500">
                {request.originRelay}
              </p>
            </div>
          )}
        </div>

        {/* Vault unlock gate */}
        {!vaultUnlocked && (
          <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            Vault is locked. Unlock to approve this request.
          </div>
        )}

        {/* Action buttons — explicit [Approve] [Reject], always rendered together */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReject}
            disabled={tappedReject}
            className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rejectLabel}
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={tappedApprove || !vaultUnlocked}
            className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approveLabel}
          </button>
        </div>

        {/* Footer note: no auto-approve, no timeout-approve */}
        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
          No auto-approve. Every request requires an explicit tap.
        </p>
      </div>
    </div>
  );
}

export default ApprovalSheet;