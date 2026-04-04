/**
 * Agent delegation barrel export
 */

// Coordinator types and class
export type {
  EscalationPath,
  TransferReason,
  FallbackAgent,
  DelegationStrategy,
  HealthCheckResult,
  TaskTransferContext,
  AdaptiveTaskRecord,
  AgentOperationalStateRecord,
  SessionEventRecord,
  TransferRecordInput,
  AdaptiveDelegationRepository,
  AdaptiveDelegationHooks,
} from "./coordinator";

export {
  ADAPTIVE_MONITORABLE_TASK_STATUSES,
  isAdaptiveMonitoringTaskStatus,
  AdaptiveDelegationCoordinator,
} from "./coordinator";

// Evaluator types and functions
export type {
  ChallengeReason,
  ChallengeResolution,
  FinalTaskChallengeOutcome,
  TaskChallengeCheck,
  TaskChallengeResolutionInput,
  TaskChallengeOutcomeInput,
  TaskAssignment,
  AgentCapabilities,
} from "./evaluator";

export { evaluateTaskBeforeAcceptance } from "./evaluator";
