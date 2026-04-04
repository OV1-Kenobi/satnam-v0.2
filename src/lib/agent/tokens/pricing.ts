// Ported from v1 src/lib/agents/agent-action-pricing.ts
// No decontamination required — pure constant definitions
// Import path updated: types/agent-tokens → ./types

/**
 * Agent Action Pricing — v2
 *
 * Satoshi-denominated pricing for agent token actions.
 * All amounts in sats (Axiom 1 — no fiat shims).
 *
 * Pricing is fixed at module load time. To support dynamic pricing
 * from the Principal's policy, extend AgentActionPricing with a
 * `policyOverride` field resolved at runtime from the agent profile.
 */

import type { BlindTokenType } from "./types";

export interface AgentActionPricing {
  label: string;
  description: string;
  singleFeeSats: number;
  bundleQuantity: number;
  bundleFeeSats: number;
}

export const AGENT_ACTION_PRICING: Record<BlindTokenType, AgentActionPricing> =
  {
    event_post: {
      label: "Event Publishing",
      description: "Publish agent status and work output updates.",
      singleFeeSats: 21,
      bundleQuantity: 10,
      bundleFeeSats: 210,
    },
    task_create: {
      label: "Task Creation",
      description: "Create verifiable task records for delegated work.",
      singleFeeSats: 150,
      bundleQuantity: 10,
      bundleFeeSats: 1500,
    },
    contact_add: {
      label: "Contact Addition",
      description: "Add new contacts and relay relationships.",
      singleFeeSats: 50,
      bundleQuantity: 10,
      bundleFeeSats: 500,
    },
    dm_send: {
      label: "Encrypted DM Bundles",
      description: "Send encrypted direct messages anonymously.",
      singleFeeSats: 21,
      bundleQuantity: 10,
      bundleFeeSats: 210,
    },
  };

/**
 * Calculate the total cost of purchasing N tokens of a given type.
 * Applies bundle pricing when the quantity is a multiple of bundleQuantity.
 */
export function calculateTokenPurchaseCost(
  type: BlindTokenType,
  quantity: number
): number {
  const pricing = AGENT_ACTION_PRICING[type];
  const bundles = Math.floor(quantity / pricing.bundleQuantity);
  const singles = quantity % pricing.bundleQuantity;
  return bundles * pricing.bundleFeeSats + singles * pricing.singleFeeSats;
}
