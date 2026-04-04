// Ported from v1 netlify/functions/agents/agent-wallet-helpers.ts
// No decontamination required — stateless utilities with no auth wrappers
// JWT auth wrappers: none present in this file (it was clean)
// family_* naming: not present in this file

/**
 * Agent Wallet Helpers — v2
 *
 * Stateless utility functions for payment rail selection and input normalization.
 * Used by agent wallet operations, spend authorization, and NIP-AC envelope construction.
 *
 * All amounts are in sats (u64). No fiat conversions stored.
 * Rail selection logic: lightning > cashu > auto (per spec §6.1–6.2).
 */

export type AgentWalletRoute =
  | "balance"
  | "pay"
  | "send"
  | "receive"
  | "history";

export type SpendRail = "lightning" | "cashu" | "auto";
export type PrivacyPreference = "high" | "balanced" | "fast";

export interface RailSelectionInput {
  requestedRail?: SpendRail;
  preferredRail?: SpendRail;
  privacyPreference?: PrivacyPreference;
  amountSats?: number;
  hasLightningTarget: boolean;
  hasCashuCapability: boolean;
  cashuBalanceSats?: number;
}

// ============================================================================
// Route parsing
// ============================================================================

export function parseAgentWalletRoute(path: string): AgentWalletRoute | null {
  const normalized = path.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/agent-wallet")) return "balance";
  if (normalized.endsWith("/v1/agent-wallet/pay")) return "pay";
  if (normalized.endsWith("/v1/agent-wallet/send")) return "send";
  if (normalized.endsWith("/v1/agent-wallet/receive")) return "receive";
  if (normalized.endsWith("/v1/agent-wallet/history")) return "history";
  return null;
}

// ============================================================================
// Input normalization
// ============================================================================

export function normalizeRail(value: unknown): SpendRail {
  if (value === "lightning" || value === "cashu" || value === "auto") {
    return value;
  }
  return "auto";
}

export function normalizePrivacyPreference(value: unknown): PrivacyPreference {
  if (value === "high" || value === "balanced" || value === "fast") {
    return value;
  }
  return "balanced";
}

export function coercePositiveInteger(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric);
}

export function coerceOptionalInteger(
  value: unknown,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

// ============================================================================
// Payment format detection
// ============================================================================

export function looksLikeBolt11(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("lnbc") ||
    normalized.startsWith("lntb") ||
    normalized.startsWith("lnbcrt")
  );
}

export function looksLikeCashuToken(value: string | undefined): boolean {
  if (!value) return false;
  return value.trim().startsWith("cashuA");
}

// ============================================================================
// Rail selection — core business logic
// ============================================================================

/**
 * Select the optimal payment rail based on context and policy.
 *
 * Priority order (when requestedRail is "auto"):
 * 1. preferredRail if explicitly set and available
 * 2. Privacy preference: "high" → Cashu (if capable)
 * 3. Small amounts (≤5000 sats) → Cashu for micropayment efficiency
 * 4. Lightning target available → Lightning
 * 5. Cashu capable → Cashu
 * 6. Fallback → Lightning
 */
export function selectSpendRail(input: RailSelectionInput): SpendRail {
  const requestedRail = input.requestedRail ?? "auto";
  const preferredRail = input.preferredRail ?? "auto";
  const privacyPreference = input.privacyPreference ?? "balanced";
  const amountSats = input.amountSats ?? 0;
  const cashuCapable =
    input.hasCashuCapability &&
    (input.cashuBalanceSats ?? amountSats) >= amountSats;

  if (requestedRail !== "auto") return requestedRail;
  if (preferredRail === "cashu" && cashuCapable) return "cashu";
  if (preferredRail === "lightning" && input.hasLightningTarget)
    return "lightning";
  if (privacyPreference === "high" && cashuCapable) return "cashu";
  if (amountSats > 0 && amountSats <= 5_000 && cashuCapable) return "cashu";
  if (input.hasLightningTarget) return "lightning";
  if (cashuCapable) return "cashu";
  return "lightning";
}

// ============================================================================
// Safe logging helper
// ============================================================================

/**
 * Truncate a sensitive value for safe preview in logs.
 * Never logs full secrets, URIs, or keys.
 */
export function hashSafePreview(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}
