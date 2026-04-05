/**
 * @module probe/types
 * @description Probe session protocol type definitions.
 *
 * Probe is the OpenAgents coding agent. Satnam provides the management
 * interface for monitoring and controlling Probe sessions.
 *
 * ## Nostr Event Mapping
 *
 * | Type | Nostr Kind | Description |
 * |------|-----------|-------------|
 * | TrajectorySession | 39230 | Session metadata (start, status, agent) |
 * | TrajectoryEvent | 39231 | Individual trajectory step (tool call, diff, result) |
 *
 * ## Event Tag Structure (kind:39231)
 *
 * Tool call:
 * ```json
 * { "tags": [["d", "<session_id>"], ["type", "tool_call"], ["call_id", "<uuid>"]] }
 * ```
 *
 * Tool approval response:
 * ```json
 * { "tags": [["d", "<session_id>"], ["type", "tool_approval"], ["call_id", "<uuid>"], ["approved", "true"]] }
 * ```
 *
 * @see phase4-spec-sections-8-9.md §8.2
 */

// ---------------------------------------------------------------------------
// Trajectory Event Type Union
// ---------------------------------------------------------------------------

/**
 * Discriminant string for each trajectory event variant.
 * Maps to the `type` tag in kind:39231 events.
 */
export type TrajectoryEventType =
  | 'tool_call'
  | 'tool_approval'
  | 'tool_result'
  | 'diff'
  | 'result'
  | 'error'
  | 'message';

// ---------------------------------------------------------------------------
// Session Record (kind:39230)
// ---------------------------------------------------------------------------

/**
 * Active or completed Probe session.
 * Parsed from a kind:39230 Nostr event.
 */
export interface TrajectorySession {
  /** Unique session identifier (maps to the `d` tag on kind:39230). */
  sessionId: string;

  /** Probe agent's hex public key (author of the kind:39230 event). */
  agentPubkey: string;

  /** Unix timestamp when the session was started. */
  startedAt: number;

  /** Current session lifecycle status. */
  status: 'active' | 'paused' | 'completed' | 'failed';

  /**
   * Arbitrary metadata tags extracted from the event.
   * Keys are tag names, values are tag[1] values.
   */
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Trajectory Event (kind:39231)
// ---------------------------------------------------------------------------

/**
 * A single step in a Probe trajectory.
 * Parsed from a kind:39231 Nostr event.
 */
export interface TrajectoryEvent {
  /** Session identifier — matches the parent TrajectorySession.sessionId. */
  sessionId: string;

  /** Discriminated type of this trajectory step. */
  eventType: TrajectoryEventType;

  /** Unix timestamp of the event (from event.created_at). */
  timestamp: number;

  /**
   * Typed payload for this event.
   * Use eventType as the discriminant to narrow to the correct interface.
   */
  data: TrajectoryEventData;
}

/**
 * Discriminated union of all trajectory event payload types.
 */
export type TrajectoryEventData =
  | ToolCallData
  | ToolApprovalData
  | ToolResultData
  | DiffData
  | ResultData
  | ErrorData
  | MessageData;

// ---------------------------------------------------------------------------
// Tool Call (type: 'tool_call')
// ---------------------------------------------------------------------------

/**
 * Probe is requesting to invoke a tool.
 * If `requiresApproval` is true, the user must approve before execution.
 */
export interface ToolCallData {
  type: 'tool_call';

  /** Name of the tool being invoked (e.g., "bash", "edit_file"). */
  toolName: string;

  /** Tool invocation parameters as a JSON-serializable object. */
  parameters: Record<string, unknown>;

  /**
   * Whether this tool call requires human approval before execution.
   * If true, the UI should render Approve/Reject/Modify controls.
   */
  requiresApproval: boolean;

  /** Unique identifier for this tool call — used to correlate with the approval. */
  callId: string;
}

// ---------------------------------------------------------------------------
// Tool Approval (type: 'tool_approval')
// ---------------------------------------------------------------------------

/**
 * Human or automated approval/rejection of a pending tool call.
 * Published as a kind:39231 with `tool_approval` type tag.
 */
export interface ToolApprovalData {
  type: 'tool_approval';

  /** Call ID matching the ToolCallData.callId being approved/rejected. */
  callId: string;

  /** true = approved, false = rejected. */
  approved: boolean;

  /**
   * Optional parameter modifications approved by the user.
   * If set, Probe uses these parameters instead of the original ones.
   */
  modifiedParameters?: Record<string, unknown>;

  /** Hex public key of the approver (Principal or Governor). */
  approverPubkey: string;
}

// ---------------------------------------------------------------------------
// Tool Result (type: 'tool_result')
// ---------------------------------------------------------------------------

/**
 * Output from a tool execution.
 * Published after Probe receives the tool's return value.
 */
export interface ToolResultData {
  type: 'tool_result';

  /** Call ID matching the originating ToolCallData.callId. */
  callId: string;

  /** Standard output from the tool execution. */
  stdout?: string;

  /** Standard error from the tool execution. */
  stderr?: string;

  /** Exit code (0 = success, non-zero = error). */
  exitCode?: number;

  /** Wall-clock execution duration in milliseconds. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Diff (type: 'diff')
// ---------------------------------------------------------------------------

/**
 * A file diff produced by Probe during a code modification.
 * Rendered as a side-by-side or inline diff in the Probe session panel.
 * Uses CSS-based highlighting — no heavy syntax highlight library.
 */
export interface DiffData {
  type: 'diff';

  /** Relative file path from the repository root. */
  filePath: string;

  /** Diff hunks in unified-diff format. */
  hunks: DiffHunk[];

  /**
   * Programming language for syntax class hints (e.g., "typescript", "python").
   * Used for CSS class-based highlighting only.
   */
  language?: string;
}

/**
 * A single hunk within a unified diff.
 */
export interface DiffHunk {
  /** Starting line number in the old file (1-indexed). */
  oldStart: number;

  /** Number of lines from the old file included in this hunk. */
  oldLines: number;

  /** Starting line number in the new file (1-indexed). */
  newStart: number;

  /** Number of lines from the new file included in this hunk. */
  newLines: number;

  /** Individual diff lines within this hunk. */
  lines: DiffLine[];
}

/**
 * A single line within a diff hunk.
 */
export interface DiffLine {
  /** Type of change for this line. */
  type: 'add' | 'remove' | 'context';

  /** Raw line content (without the leading +/- prefix). */
  content: string;

  /** Line number in the relevant file (old for 'remove'/'context', new for 'add'/'context'). */
  lineNumber: number;
}

// ---------------------------------------------------------------------------
// Result (type: 'result')
// ---------------------------------------------------------------------------

/**
 * Final execution result from a completed Probe session or task.
 * Rendered as structured output: stdout/stderr blocks, file summaries, test results.
 */
export interface ResultData {
  type: 'result';

  /** Human-readable summary of what was accomplished. */
  summary: string;

  /** List of files that were created, modified, or deleted. */
  fileChanges: FileChange[];

  /** Optional test run results if Probe executed a test suite. */
  testResults?: TestResult[];
}

/**
 * A single file change reported in a ResultData.
 */
export interface FileChange {
  /** Relative file path from the repository root. */
  path: string;

  /** Type of change applied to this file. */
  changeType: 'added' | 'modified' | 'deleted';

  /** Number of lines added (for 'added' and 'modified'). */
  additions: number;

  /** Number of lines removed (for 'modified' and 'deleted'). */
  deletions: number;
}

/**
 * Result of a single test case.
 */
export interface TestResult {
  /** Test case name or description. */
  name: string;

  /** Whether the test passed. */
  passed: boolean;

  /** Test execution duration in milliseconds. */
  duration?: number;

  /** Error message if the test failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Error (type: 'error')
// ---------------------------------------------------------------------------

/**
 * An error encountered during Probe session execution.
 */
export interface ErrorData {
  type: 'error';

  /** Human-readable error message. */
  message: string;

  /** Machine-readable error code (e.g., "TOOL_NOT_FOUND", "TIMEOUT"). */
  code?: string;

  /** Stack trace (when available — typically only in development). */
  stack?: string;
}

// ---------------------------------------------------------------------------
// Message (type: 'message')
// ---------------------------------------------------------------------------

/**
 * A text message from the agent or system (e.g., status updates, LLM output).
 */
export interface MessageData {
  type: 'message';

  /** Message text content. */
  content: string;

  /** Who produced this message. */
  role: 'agent' | 'system';
}

// ---------------------------------------------------------------------------
// Subscription Options
// ---------------------------------------------------------------------------

/**
 * Options for ProbeSessionClient.subscribeSession().
 */
export interface SubscribeSessionOptions {
  /** Subscribe only to events since this Unix timestamp. */
  since?: number;

  /** Subscribe only to events up to this Unix timestamp. */
  until?: number;

  /** Maximum number of events to fetch in the initial EOSE window. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Probe Session Filter (for building Nostr subscriptions)
// ---------------------------------------------------------------------------

/**
 * Computed Nostr subscription filter for a Probe agent's trajectory.
 */
export interface ProbeSessionFilter {
  kinds: [39230, 39231];
  '#p': [string];
  since?: number;
  until?: number;
  limit?: number;
}
