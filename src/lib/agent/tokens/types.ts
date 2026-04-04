// Ported from v1 types/agent-tokens.ts
// No decontamination required — pure type definitions, no auth/Supabase coupling

/**
 * Agent Blind Token Type Definitions — v2
 *
 * Shared type definitions for the agent blind token system.
 * Used across token issuance, redemption, and client libraries.
 * All amounts implicitly in sats (Axiom 1).
 */

export type BlindTokenType =
  | "event_post"
  | "task_create"
  | "contact_add"
  | "dm_send";

export interface ActionPayload {
  event_post?: {
    kind: number;
    content: string;
    tags: string[][];
  };
  task_create?: {
    title: string;
    description: string;
    assignee_npub?: string;
  };
  contact_add?: {
    contact_npub: string;
    contact_name?: string;
  };
  dm_send?: {
    recipient_npub: string;
    content: string;
  };
}

export interface ActionResult {
  token_valid: boolean;
  action_performed: boolean;
  result_data?: {
    event_id?: string;
    task_id?: string;
    contact_id?: string;
    dm_id?: string;
  };
  error?: string;
}
