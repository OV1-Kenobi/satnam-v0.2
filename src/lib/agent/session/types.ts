// Ported from v1 types/agent-sessions.ts
// Stripped: family_federation_id → group_federation_id (spec §0.2 rename)
//   No Supabase or auth coupling in this file — direct port of type definitions
// v2: Framework-agnostic types used by CEPS trajectory subscriptions and
//   agent monitoring dashboard components

/**
 * Agent Session Type Definitions — v2
 *
 * TypeScript interfaces for agent session management and observability.
 * Maps to Nostr trajectory events (kind:39230, kind:39231) in v2.
 * View types are used by the agent monitoring dashboard.
 */

// ============================================================================
// Core Session Types
// ============================================================================

export type SessionType =
  | "INTERACTIVE"  // Human-in-the-loop, real-time interaction
  | "AUTONOMOUS"   // Agent operates independently
  | "DELEGATED"    // Agent acts on behalf of delegator
  | "SUPERVISED";  // Agent requires approval for actions

export type SessionStatus =
  | "ACTIVE"
  | "PAUSED"
  | "HIBERNATED"
  | "TERMINATED";

export type SessionChannel =
  | "nostr"    // Nostr protocol (NIP-17/59)
  | "telegram"
  | "web_ui"
  | "api"
  | "cli";

export type SessionEventType =
  | "MESSAGE"
  | "TOOL_CALL"
  | "CONTEXT_REFRESH"
  | "INTERRUPTION"
  | "DELEGATION"
  | "TASK_ASSIGNMENT"
  | "TASK_COMPLETION"
  | "TASK_FAILURE"
  | "STATE_SNAPSHOT"
  | "CHANNEL_SWITCH"
  | "SESSION_PAUSED"
  | "SESSION_RESUMED"
  | "SESSION_TERMINATED"
  | "ERROR"
  | "WARNING"
  | "INFO"
  | "CONFLICT_DETECTED";

// ============================================================================
// Session Record (maps to kind:39230 trajectory session event in v2)
// ============================================================================

export interface AgentSession {
  id: string;
  session_id: string;      // Unique session identifier (sess_...)
  session_token: string;   // Session bearer token (ast_...)
  agent_id: string;
  created_by_user_id?: string | null;
  human_creator_id: string | null;
  /** v2: group_federation_id replaces family_federation_id (spec §0.2) */
  group_federation_id?: string | null;
  session_type: SessionType;
  status: SessionStatus;
  capability_scope: Record<string, unknown>;
  lifecycle_metadata: Record<string, unknown>;
  conversation_context: any[];
  tool_invocation_log: any[];
  state_snapshots: Record<string, any>;
  total_messages: number;
  total_tool_calls: number;
  tokens_consumed: number;
  /** All amounts in sats — no fiat (Axiom 1) */
  sats_spent: number;
  primary_channel: SessionChannel;
  auto_hibernate_after_minutes: number;
  operational_state_snapshot: Record<string, any> | null;
  started_at: string;       // ISO 8601
  last_activity_at: string;
  expires_at: string;
  terminated_at: string | null;
  termination_reason: string | null;
}

// ============================================================================
// Session Event (maps to kind:39231 trajectory event in v2)
// ============================================================================

export interface AgentSessionEvent {
  id: string;
  session_id: string;
  event_type: SessionEventType;
  event_data: Record<string, any>;
  timestamp: string;        // ISO 8601
  sats_cost: number;
  input_tokens: number;
  output_tokens: number;
  tool_name: string | null;
  tool_parameters: Record<string, any> | null;
  tool_result: Record<string, any> | null;
}

// ============================================================================
// Session Metadata
// ============================================================================

export interface AgentSessionMetadata {
  id: string;
  session_id: string;
  metadata_key: string;
  metadata_value: any;
  created_at: string;
  expires_at: string | null;
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface AgentSessionPerformance {
  id: string;
  session_id: string;
  avg_response_time_ms: number;
  response_count: number;
  error_count: number;
  warning_count: number;
  session_duration_minutes: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// View Interfaces (for monitoring dashboard)
// ============================================================================

export interface ActiveSessionSummary {
  session_id: string;
  agent_id: string;
  agent_name: string;
  creator_id: string | null;
  status: SessionStatus;
  channel: SessionChannel;
  primary_channel?: SessionChannel;
  session_type: SessionType;
  total_messages: number;
  total_tool_calls: number;
  total_tokens: number;
  total_sats_cost: number;
  started_at: string;
  last_activity_at: string;
  duration_minutes: number;
  last_activity_ago_minutes: number;
  auto_hibernate_remaining_minutes: number | null;
  avg_response_time_ms: number;
  error_count: number;
  warning_count: number;
  current_compute_load_percent: number;
  active_task_count: number;
  available_budget_sats: number;
  accepts_new_tasks: boolean;
}

export interface SessionCostAnalysis {
  agent_id: string;
  agent_name: string;
  creator_id: string | null;
  session_type: SessionType;
  channel: SessionChannel;
  primary_channel?: SessionChannel;
  session_count: number;
  total_sats_spent: number;
  avg_sats_per_session: number;
  avg_tokens_per_session: number;
  avg_duration_minutes: number;
  sats_spent_24h: number;
  sats_spent_7d: number;
  sats_spent_30d: number;
  sessions_24h: number;
  sessions_7d: number;
  sessions_30d: number;
  last_session_activity: string;
}

export interface SessionHistory {
  session_id: string;
  agent_id: string;
  agent_name: string;
  creator_id: string | null;
  status: SessionStatus;
  channel: SessionChannel;
  primary_channel?: SessionChannel;
  session_type: SessionType;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  total_messages: number;
  total_tool_calls: number;
  total_tokens: number;
  total_sats_cost: number;
  response_count: number;
  avg_response_time_ms: number;
  error_count: number;
  warning_count: number;
  event_count: number;
  termination_reason: string | null;
}

export interface SessionEventTimeline {
  event_id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  creator_id: string | null;
  session_status: SessionStatus;
  channel: SessionChannel;
  event_type: SessionEventType;
  event_data_summary: string;
  sats_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  tool_name: string | null;
  tool_parameters: Record<string, any> | null;
  created_at: string;
  minutes_ago: number;
}

export interface SessionChannelDistribution {
  channel: SessionChannel;
  total_sessions: number;
  unique_agents: number;
  active_sessions: number;
  paused_sessions: number;
  hibernated_sessions: number;
  terminated_sessions: number;
  total_messages: number;
  total_tool_calls: number;
  total_tokens: number;
  total_sats_spent: number;
  sessions_24h: number;
  sessions_7d: number;
  sessions_30d: number;
  last_activity_at: string;
}

export interface SessionTaskSummary {
  session_id: string;
  agent_id: string;
  agent_name: string;
  creator_id: string | null;
  session_status: SessionStatus;
  session_type: SessionType;
  channel: SessionChannel;
  session_started_at: string;
  task_count: number;
  completed_tasks: number;
  failed_tasks: number;
  in_progress_tasks: number;
  pending_tasks: number;
  total_task_cost_sats: number;
  avg_task_cost_sats: number;
  avg_task_duration_seconds: number;
  total_task_duration_seconds: number;
  avg_quality_score: number;
  total_reputation_delta: number;
  self_reported_tasks: number;
  peer_verified_tasks: number;
  oracle_attested_tasks: number;
  last_task_completed_at: string | null;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateSessionRequest {
  agent_id: string;
  session_type: SessionType;
  primary_channel?: SessionChannel;
  created_by_user_id?: string;
  human_creator_id?: string;
}

export interface CreateSessionResponse {
  success: boolean;
  session_id?: string;
  session?: AgentSession;
  error?: string;
}

export interface LogEventRequest {
  session_id: string;
  event_type: SessionEventType;
  event_data: Record<string, any>;
  tokens_used?: number;
  sats_cost?: number;
  input_tokens?: number;
  output_tokens?: number;
  tool_name?: string;
  tool_parameters?: Record<string, any>;
  tool_result?: Record<string, any>;
}

export interface LogEventResponse {
  success: boolean;
  event_id?: string;
  error?: string;
}

export interface ManageSessionRequest {
  session_id: string;
  action: "pause" | "resume" | "terminate" | "switch_channel";
  reason?: string;
  new_channel?: SessionChannel;
}

export interface ManageSessionResponse {
  success: boolean;
  session_id?: string;
  new_status?: SessionStatus;
  message?: string;
  error?: string;
}

export interface SessionQueryParams {
  view?:
    | "active_summary"
    | "cost_analysis"
    | "history"
    | "timeline"
    | "task_summary";
  page?: number;
  limit?: number;
  agent_id?: string;
  session_id?: string;
  session_type?: SessionType;
  channel?: SessionChannel;
  status?: SessionStatus;
  start_date?: string;
  end_date?: string;
  min_sats?: number;
  max_sats?: number;
  min_duration_minutes?: number;
  max_duration_minutes?: number;
  sort_by?:
    | "started_at"
    | "created_at"
    | "last_activity_at"
    | "duration"
    | "sats_spent"
    | "tokens_consumed";
  sort_order?: "asc" | "desc";
}

// ============================================================================
// Component Prop Types (for agent monitoring dashboard)
// ============================================================================

export interface AgentSessionMonitorProps {
  agentId?: string;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
  showFilters?: boolean;
  showCostMetrics?: boolean;
  showPerformanceMetrics?: boolean;
  onSessionSelect?: (sessionId: string) => void;
  onSessionTerminate?: (sessionId: string) => void;
  className?: string;
}

export interface SessionTimelineProps {
  sessionId: string;
  eventTypes?: SessionEventType[];
  showToolCalls?: boolean;
  showCosts?: boolean;
  showTokens?: boolean;
  maxEvents?: number;
  autoScroll?: boolean;
  onEventClick?: (eventId: string) => void;
  className?: string;
}

export interface SessionCostChartProps {
  agentId?: string;
  sessionType?: SessionType;
  channel?: SessionChannel;
  timeRange?: "24h" | "7d" | "30d" | "all";
  chartType?: "line" | "bar" | "pie";
  groupBy?: "agent" | "session_type" | "channel" | "day";
  showBreakdown?: boolean;
  showComparison?: boolean;
  currency?: "sats" | "btc"; // No fiat storage per Axiom 1
  onDataPointClick?: (data: any) => void;
  className?: string;
}
