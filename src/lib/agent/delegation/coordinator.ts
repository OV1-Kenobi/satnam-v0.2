// Ported from v1 src/lib/agents/adaptive-delegation-coordinator.ts
// Stripped: SupabaseClient import, SupabaseAdaptiveDelegationRepository class
//   (all Supabase reads/writes), supabase singleton import
// v2: AdaptiveDelegationRepository interface is preserved for dependency injection.
//   A Nostr-native implementation using CEPS will be wired in separately.
//   family_federation_id: not present in this file

/**
 * Adaptive Delegation Coordinator — v2
 *
 * Monitors agent health during task execution and coordinates fallback
 * delegation when agents fail or exceed performance thresholds.
 *
 * v2 architecture: The coordinator uses the AdaptiveDelegationRepository
 * interface for all data access. In v2, this interface should be implemented
 * using Nostr trajectory events (kind:39231) and agent state (kind:39201)
 * rather than Supabase tables.
 *
 * All type definitions from v1 are preserved as-is (framework-agnostic).
 */

// ============================================================================
// Types (ported verbatim from v1 — no Supabase types in scope)
// ============================================================================

export type EscalationPath =
  | "HUMAN"
  | "NEXT_FALLBACK"
  | "CANCEL_TASK"
  | "RETRY_PRIMARY";

export type TransferReason =
  | "LATENCY_EXCEEDED"
  | "COST_OVERRUN"
  | "PROGRESS_STALLED"
  | "AGENT_UNAVAILABLE"
  | "QUALITY_DEGRADATION"
  | "MANUAL_SWITCH";

type JsonObject = Record<string, unknown>;

export interface FallbackAgent {
  agent_id: string;
  priority: number;
}

export interface DelegationStrategy {
  id: string;
  task_id: string;
  primary_agent_id: string;
  delegator_id: string;
  fallback_agents: FallbackAgent[];
  auto_switch_triggers: {
    max_latency_seconds: number;
    max_cost_overrun_percent: number;
    min_progress_check_failures: number;
    max_quality_score_drop: number;
  };
  escalation_path: EscalationPath;
  current_agent_id: string;
  switch_count: number;
  last_health_check_at?: string | null;
}

export interface HealthCheckResult {
  agent_id: string;
  task_id: string;
  latency_seconds: number;
  cost_overrun_percent: number;
  consecutive_failures: number;
  quality_score_drop: number;
  is_healthy: boolean;
  failure_reasons: TransferReason[];
}

export interface TaskTransferContext {
  previous_agent: string;
  transfer_reason: TransferReason;
  work_completed: JsonObject;
  progress_percent: number;
}

export interface AdaptiveTaskRecord {
  id: string;
  assignee_agent_id: string;
  creator_user_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  session_id: string | null;
  estimated_cost_sats: number | null;
  actual_cost_sats: number | null;
  quality_score: number | null;
  task_output_summary: string | null;
  completion_proof: string | null;
}

export interface AgentOperationalStateRecord {
  agent_id: string;
  current_compute_load_percent: number;
  active_task_count: number;
  max_concurrent_tasks: number;
  accepts_new_tasks: boolean;
  estimated_response_time_seconds: number | null;
  last_heartbeat: string | null;
}

export interface SessionEventRecord {
  event_type: string;
  event_data: JsonObject;
  timestamp: string;
  latency_ms: number | null;
  success: boolean | null;
  error_message: string | null;
}

export interface TransferRecordInput {
  task_id: string;
  strategy_id: string;
  from_agent_id: string;
  to_agent_id: string;
  transfer_reason: TransferReason;
  transfer_details: JsonObject;
  work_completed_snapshot: JsonObject;
  progress_percent: number;
}

/**
 * Repository interface for adaptive delegation data.
 * v2: Implement this interface using Nostr trajectory events + agent state events.
 * The in-memory mock below is provided for unit testing.
 */
export interface AdaptiveDelegationRepository {
  getTask(taskId: string): Promise<AdaptiveTaskRecord | null>;
  getOperationalState(agentId: string): Promise<AgentOperationalStateRecord | null>;
  getRecentSessionEvents(
    sessionId: string | null,
    limit: number
  ): Promise<SessionEventRecord[]>;
  recordTaskTransfer(input: TransferRecordInput): Promise<string>;
  markTransferFailed(transferId: string, errorMessage: string): Promise<void>;
  reassignTask(taskId: string, newAgentId: string): Promise<void>;
  updateStrategyAfterTransfer(
    strategyId: string,
    newAgentId: string,
    remainingFallbackAgents: FallbackAgent[],
    nextSwitchCount: number,
    lastHealthCheckAt: string
  ): Promise<void>;
  updateLastHealthCheck(
    strategyId: string,
    lastHealthCheckAt: string
  ): Promise<void>;
  pauseTask(taskId: string, reason: string): Promise<void>;
  cancelTask(taskId: string, reason: string): Promise<void>;
}

export interface AdaptiveDelegationHooks {
  notifyHumanCreator(
    task: AdaptiveTaskRecord,
    reason: TransferReason,
    healthChecks: HealthCheckResult
  ): Promise<void>;
  notifyAgentOfTransfer(
    agentId: string,
    task: AdaptiveTaskRecord,
    context: TaskTransferContext
  ): Promise<void>;
  scheduleRetry(
    task: AdaptiveTaskRecord,
    agentId: string,
    cooldownSeconds: number
  ): Promise<void>;
}

// ============================================================================
// Constants
// ============================================================================

export const ADAPTIVE_MONITORABLE_TASK_STATUSES = [
  "assigned",
  "in_progress",
] as const;

export function isAdaptiveMonitoringTaskStatus(status: string): boolean {
  return ADAPTIVE_MONITORABLE_TASK_STATUSES.includes(
    status as (typeof ADAPTIVE_MONITORABLE_TASK_STATUSES)[number]
  );
}

const HEALTHY_HEARTBEAT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_COOLDOWN_SECONDS = 300;
const FAILURE_EVENT_TYPES = new Set(["ERROR", "WARNING", "PROGRESS_CHECK_FAILED"]);
const SUCCESS_EVENT_TYPES = new Set(["PROGRESS_CHECK_SUCCESS", "TASK_COMPLETION"]);

// ============================================================================
// Pure computation helpers (no I/O)
// ============================================================================

const noopHooks: AdaptiveDelegationHooks = {
  notifyHumanCreator: async () => {},
  notifyAgentOfTransfer: async () => {},
  scheduleRetry: async () => {},
};

function asJsonObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isProgressFailureEvent(event: SessionEventRecord): boolean {
  const data = asJsonObject(event.event_data);
  return (
    FAILURE_EVENT_TYPES.has(event.event_type) &&
    (data.code === "PROGRESS_STALLED" ||
      data.progress_status === "failed" ||
      data.reason === "progress_check_failed")
  );
}

function isProgressSuccessEvent(event: SessionEventRecord): boolean {
  const data = asJsonObject(event.event_data);
  return (
    SUCCESS_EVENT_TYPES.has(event.event_type) ||
    data.progress_status === "success"
  );
}

function calculateLatencySeconds(
  task: AdaptiveTaskRecord,
  events: SessionEventRecord[],
  now: Date
): number {
  const lastTimestamp =
    events[0]?.timestamp ??
    task.updated_at ??
    task.started_at ??
    task.created_at;
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(lastTimestamp).getTime()) / 1000)
  );
}

function calculateCostOverrunPercent(task: AdaptiveTaskRecord): number {
  if (!task.estimated_cost_sats || task.estimated_cost_sats <= 0) return 0;
  const actual = task.actual_cost_sats ?? 0;
  return Math.max(
    0,
    Math.floor(
      ((actual - task.estimated_cost_sats) / task.estimated_cost_sats) * 100
    )
  );
}

function getConsecutiveProgressFailures(events: SessionEventRecord[]): number {
  let failures = 0;
  for (const event of events) {
    if (isProgressFailureEvent(event)) {
      failures += 1;
      continue;
    }
    if (isProgressSuccessEvent(event)) break;
  }
  return failures;
}

function calculateQualityDrop(
  task: AdaptiveTaskRecord,
  events: SessionEventRecord[]
): number {
  for (const event of events) {
    const data = asJsonObject(event.event_data);
    const explicitDrop = asNumber(data.quality_score_drop);
    if (explicitDrop !== null) return Math.max(0, explicitDrop);
    const score = asNumber(data.quality_score);
    if (score !== null) return Math.max(0, 100 - score);
  }
  return task.quality_score === null ? 0 : Math.max(0, 100 - task.quality_score);
}

function extractProgressPercent(
  task: AdaptiveTaskRecord,
  events: SessionEventRecord[]
): number {
  for (const event of events) {
    const progress = asNumber(asJsonObject(event.event_data).progress_percent);
    if (progress !== null) return Math.max(0, Math.min(100, Math.floor(progress)));
  }
  return task.status === "completed" ? 100 : 0;
}

function buildWorkSnapshot(
  task: AdaptiveTaskRecord,
  events: SessionEventRecord[],
  healthChecks: HealthCheckResult
): JsonObject {
  return {
    status: task.status,
    task_output_summary: task.task_output_summary,
    completion_proof: task.completion_proof,
    latest_event_type: events[0]?.event_type ?? null,
    latest_event_timestamp: events[0]?.timestamp ?? null,
    health_check: healthChecks,
  };
}

function isAgentAvailable(
  state: AgentOperationalStateRecord | null,
  now: Date
): boolean {
  if (!state?.accepts_new_tasks || !state.last_heartbeat) return false;
  const heartbeatAgeMs =
    now.getTime() - new Date(state.last_heartbeat).getTime();
  return (
    heartbeatAgeMs <= HEALTHY_HEARTBEAT_WINDOW_MS &&
    state.active_task_count < state.max_concurrent_tasks &&
    state.current_compute_load_percent < 90
  );
}

// ============================================================================
// AdaptiveDelegationCoordinator
// ============================================================================

export class AdaptiveDelegationCoordinator {
  constructor(
    private readonly repo: AdaptiveDelegationRepository,
    private readonly hooks: AdaptiveDelegationHooks = noopHooks
  ) {}

  /**
   * Perform a health check on an agent running a task.
   * Returns HealthCheckResult with failure reasons if unhealthy.
   */
  async checkAgentHealth(
    strategy: DelegationStrategy,
    taskId: string
  ): Promise<HealthCheckResult> {
    const now = new Date();

    const [task, operationalState, recentEvents] = await Promise.all([
      this.repo.getTask(taskId),
      this.repo.getOperationalState(strategy.current_agent_id),
      this.repo.getRecentSessionEvents(null, 10),
    ]);

    if (!task) {
      return {
        agent_id: strategy.current_agent_id,
        task_id: taskId,
        latency_seconds: 0,
        cost_overrun_percent: 0,
        consecutive_failures: 0,
        quality_score_drop: 0,
        is_healthy: false,
        failure_reasons: ["AGENT_UNAVAILABLE"],
      };
    }

    const latencySeconds = calculateLatencySeconds(task, recentEvents, now);
    const costOverrunPercent = calculateCostOverrunPercent(task);
    const consecutiveFailures = getConsecutiveProgressFailures(recentEvents);
    const qualityDrop = calculateQualityDrop(task, recentEvents);
    const agentAvailable = isAgentAvailable(operationalState, now);

    const triggers = strategy.auto_switch_triggers;
    const failureReasons: TransferReason[] = [];

    if (latencySeconds > triggers.max_latency_seconds) {
      failureReasons.push("LATENCY_EXCEEDED");
    }
    if (costOverrunPercent > triggers.max_cost_overrun_percent) {
      failureReasons.push("COST_OVERRUN");
    }
    if (consecutiveFailures >= triggers.min_progress_check_failures) {
      failureReasons.push("PROGRESS_STALLED");
    }
    if (qualityDrop > triggers.max_quality_score_drop) {
      failureReasons.push("QUALITY_DEGRADATION");
    }
    if (!agentAvailable) {
      failureReasons.push("AGENT_UNAVAILABLE");
    }

    return {
      agent_id: strategy.current_agent_id,
      task_id: taskId,
      latency_seconds: latencySeconds,
      cost_overrun_percent: costOverrunPercent,
      consecutive_failures: consecutiveFailures,
      quality_score_drop: qualityDrop,
      is_healthy: failureReasons.length === 0,
      failure_reasons: failureReasons,
    };
  }

  /**
   * Attempt to switch the task to the next available fallback agent.
   * Returns the new agent ID if successful, null if no fallbacks remain.
   */
  async attemptFallbackSwitch(
    strategy: DelegationStrategy,
    taskId: string,
    healthResult: HealthCheckResult
  ): Promise<string | null> {
    const task = await this.repo.getTask(taskId);
    if (!task) return null;

    const now = new Date();
    const recentEvents = await this.repo.getRecentSessionEvents(
      task.session_id,
      10
    );
    const progressPercent = extractProgressPercent(task, recentEvents);
    const workSnapshot = buildWorkSnapshot(task, recentEvents, healthResult);

    const primaryReason = healthResult.failure_reasons[0] ?? "MANUAL_SWITCH";

    // Find next available fallback
    const sortedFallbacks = [...strategy.fallback_agents].sort(
      (a, b) => a.priority - b.priority
    );

    for (const fallback of sortedFallbacks) {
      const fallbackState = await this.repo.getOperationalState(fallback.agent_id);
      if (!isAgentAvailable(fallbackState, now)) continue;

      // Record the transfer
      await this.repo.recordTaskTransfer({
        task_id: taskId,
        strategy_id: strategy.id,
        from_agent_id: strategy.current_agent_id,
        to_agent_id: fallback.agent_id,
        transfer_reason: primaryReason,
        transfer_details: { health_result: healthResult },
        work_completed_snapshot: workSnapshot,
        progress_percent: progressPercent,
      });

      // Reassign and update strategy
      await Promise.all([
        this.repo.reassignTask(taskId, fallback.agent_id),
        this.repo.updateStrategyAfterTransfer(
          strategy.id,
          fallback.agent_id,
          sortedFallbacks.filter((f) => f.agent_id !== fallback.agent_id),
          strategy.switch_count + 1,
          now.toISOString()
        ),
      ]);

      const transferContext: TaskTransferContext = {
        previous_agent: strategy.current_agent_id,
        transfer_reason: primaryReason,
        work_completed: workSnapshot,
        progress_percent: progressPercent,
      };

      await this.hooks.notifyAgentOfTransfer(
        fallback.agent_id,
        task,
        transferContext
      );

      return fallback.agent_id;
    }

    // No fallbacks available — escalate
    await this.handleEscalation(strategy, task, healthResult);
    return null;
  }

  private async handleEscalation(
    strategy: DelegationStrategy,
    task: AdaptiveTaskRecord,
    healthResult: HealthCheckResult
  ): Promise<void> {
    const primaryReason =
      healthResult.failure_reasons[0] ?? "MANUAL_SWITCH";

    switch (strategy.escalation_path) {
      case "HUMAN":
        await this.hooks.notifyHumanCreator(task, primaryReason, healthResult);
        break;

      case "RETRY_PRIMARY":
        await this.hooks.scheduleRetry(
          task,
          strategy.primary_agent_id,
          DEFAULT_RETRY_COOLDOWN_SECONDS
        );
        break;

      case "CANCEL_TASK":
        await this.repo.cancelTask(task.id, `Escalation: ${primaryReason}`);
        break;

      case "NEXT_FALLBACK":
      default:
        await this.repo.pauseTask(task.id, `Escalation: ${primaryReason}`);
        await this.hooks.notifyHumanCreator(task, primaryReason, healthResult);
        break;
    }
  }
}

