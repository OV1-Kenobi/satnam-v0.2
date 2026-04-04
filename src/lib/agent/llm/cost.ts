// Ported from v1 netlify/functions/agent-llm-proxy.ts
// Extracted: calculateSatsCostFromPricing() and related pricing types only
// Stripped: Netlify function wrapper, JWT auth (SecureSessionManager),
//   getRequestClient(), LLM provider adapters, credential decryption,
//   BTC/USD price conversion (no fiat storage per Axiom 1),
//   all HTTP request/response handling

/**
 * LLM Cost Math — v2
 *
 * Pure cost calculation functions for LLM token usage, denominated in sats.
 * Used by agent billing, NIP-AC credit envelope construction, and session analytics.
 *
 * Design notes (Axiom 1):
 * - All costs are u64 msats internally, rounded to sats on output.
 * - No USD/fiat conversion is stored. Display-only FX snapshots are handled
 *   separately in the UI layer.
 * - BigInt arithmetic prevents floating-point rounding errors in msats.
 */

// ============================================================================
// Pricing types
// ============================================================================

/**
 * Per-model pricing from the LLM model pricing table.
 * Stored as msats per token to avoid floating-point precision loss.
 */
export interface LLMModelPricing {
  provider: "openai" | "anthropic" | string;
  model: string;
  /** Msats per input token (1 sat = 1000 msats) */
  input_msats_per_token: number;
  /** Msats per output token */
  output_msats_per_token: number;
  is_active?: boolean;
}

/**
 * Cost calculation result.
 * costMsats is the exact value; costSats is ceiling-rounded for payment.
 */
export interface LLMCostResult {
  /** Exact cost in millisatoshis (BigInt for precision) */
  costMsats: bigint;
  /** Cost in sats, ceiling-rounded (use for NWC payment amounts) */
  costSats: number;
}

// ============================================================================
// Core cost calculation (ported verbatim from v1 — proven correct)
// ============================================================================

/**
 * Calculate the sats cost for an LLM completion from token counts and pricing.
 *
 * Uses ceiling division for msats → sats to ensure the provider is always
 * paid at least the full cost (never under-charged by rounding).
 *
 * @param inputTokens - Number of input/prompt tokens
 * @param outputTokens - Number of output/completion tokens
 * @param pricing - Model pricing row from llm_model_pricing
 * @returns LLMCostResult with both msats and sats
 * @throws Error if computed sats cost is invalid
 */
export function calculateSatsCostFromPricing(
  inputTokens: number,
  outputTokens: number,
  pricing: Pick<LLMModelPricing, "input_msats_per_token" | "output_msats_per_token">
): LLMCostResult {
  const inputMsatsPerToken = BigInt(pricing.input_msats_per_token);
  const outputMsatsPerToken = BigInt(pricing.output_msats_per_token);

  const costMsats =
    BigInt(inputTokens) * inputMsatsPerToken +
    BigInt(outputTokens) * outputMsatsPerToken;

  // Ceiling division: (msats + 999) / 1000 → sats
  const costSatsBig = costMsats === 0n ? 0n : (costMsats + 999n) / 1000n;

  const costSats = Number(costSatsBig);
  if (!Number.isFinite(costSats) || costSats < 0) {
    throw new Error(
      `Invalid computed sats cost: ${costSatsBig.toString()} from ${inputTokens} input + ${outputTokens} output tokens`
    );
  }

  return { costMsats, costSats };
}

// ============================================================================
// Well-known model pricing (fallback when DB is unavailable)
// ============================================================================

/**
 * Static pricing table for common models.
 * Values are approximate — always prefer DB-backed pricing when available.
 * Prices as of 2026-04-04 (check LLM provider pricing pages for updates).
 *
 * msats per token = (price_per_1M_tokens_usd / btc_usd_price) * 1e8 * 1e3 / 1e6
 * At BTC = $85,000: $1/1M tokens = 1176 msats/token
 */
export const FALLBACK_MODEL_PRICING: LLMModelPricing[] = [
  {
    provider: "openai",
    model: "gpt-4o",
    input_msats_per_token: 6,   // ~$5/1M input tokens
    output_msats_per_token: 18, // ~$15/1M output tokens
    is_active: true,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    input_msats_per_token: 0,   // ~$0.15/1M input tokens
    output_msats_per_token: 1,  // ~$0.60/1M output tokens
    is_active: true,
  },
  {
    provider: "openai",
    model: "gpt-4-turbo",
    input_msats_per_token: 12,  // ~$10/1M input tokens
    output_msats_per_token: 35, // ~$30/1M output tokens
    is_active: true,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    input_msats_per_token: 4,   // ~$3/1M input tokens
    output_msats_per_token: 18, // ~$15/1M output tokens
    is_active: true,
  },
  {
    provider: "anthropic",
    model: "claude-3-haiku-20240307",
    input_msats_per_token: 0,   // ~$0.25/1M input tokens
    output_msats_per_token: 1,  // ~$1.25/1M output tokens
    is_active: true,
  },
  {
    provider: "anthropic",
    model: "claude-opus-4-5",
    input_msats_per_token: 18,  // ~$15/1M input tokens
    output_msats_per_token: 88, // ~$75/1M output tokens
    is_active: true,
  },
];

/**
 * Look up pricing for a provider/model from the fallback table.
 * @param provider - LLM provider name
 * @param model - Model identifier
 * @returns LLMModelPricing or null if not found
 */
export function getFallbackPricing(
  provider: string,
  model: string
): LLMModelPricing | null {
  return (
    FALLBACK_MODEL_PRICING.find(
      (p) => p.provider === provider && p.model === model && p.is_active
    ) ?? null
  );
}

// ============================================================================
// Reputation delta (ported from v1 spec §7.2 — proven correct)
// ============================================================================

/**
 * Calculate reputation delta after task completion.
 * Used in NIP-AC settlement receipts (kind:39244).
 * Matches the formula in spec §7.2.
 *
 * @param taskCompletionScore - Score 0-100
 * @param weight - Task weight multiplier (default 1)
 * @param hasPerformanceBond - Whether agent staked a Sig4Sats bond
 * @returns Total reputation delta (base + optional bond bonus)
 */
export function calculateReputationDelta(
  taskCompletionScore: number,
  weight = 1,
  hasPerformanceBond = false
): number {
  const base_rep = taskCompletionScore * weight;
  const sig4sats_bonus = hasPerformanceBond ? base_rep * 0.15 : 0;
  return base_rep + sig4sats_bonus;
}
