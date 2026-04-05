# useProbeSession

**File:** `src/hooks/useProbeSession.ts`
**Provider:** `CepsProvider`

---

## Purpose

`useProbeSession` subscribes to Probe coding agent trajectory events (kinds 39230/39231) on Pylon and provides UI controls for approving or rejecting tool calls. It is the interface between Satnam and the OpenAgents Probe coding agent.

---

## Return Value Shape

```typescript
interface UseProbeSessionReturn {
  // Sessions
  sessions: TrajectorySession[];
  activeSession: TrajectorySession | null;
  subscribeToSession: (agentPubkey: string, opts?: SubscribeSessionOptions) => () => void;
  subscribeToAgent: (agentPubkey: string) => () => void;

  // Events
  events: TrajectoryEvent[];
  pendingToolCalls: ToolCallData[];   // Requires approval

  // Approvals
  approveToolCall: (callId: string) => Promise<void>;
  rejectToolCall: (callId: string, reason?: string) => Promise<void>;
  modifyAndApprove: (callId: string, modifiedParams: Record<string, unknown>) => Promise<void>;

  // State
  loading: boolean;
  error: string | null;
}
```

---

## Key Types (from `src/lib/probe/types.ts`)

```typescript
// Session (kind:39230)
interface TrajectorySession {
  sessionId: string;
  agentPubkey: string;
  startedAt: number;
  status: 'active' | 'paused' | 'completed' | 'failed';
  metadata: Record<string, string>;
}

// Individual trajectory step (kind:39231)
interface TrajectoryEvent {
  sessionId: string;
  eventType: TrajectoryEventType;
  timestamp: number;
  data: TrajectoryEventData; // Discriminated union
}

type TrajectoryEventType =
  | 'tool_call'   // Probe wants to run a tool — may require approval
  | 'tool_approval' // Human approval published
  | 'tool_result'   // Tool execution output
  | 'diff'          // File diff produced
  | 'result'        // Session completion result
  | 'error'         // Execution error
  | 'message';      // Agent status message

// Tool call requiring approval
interface ToolCallData {
  type: 'tool_call';
  toolName: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  callId: string;
}

// Approval response published back to relay
interface ToolApprovalData {
  type: 'tool_approval';
  callId: string;
  approved: boolean;
  modifiedParameters?: Record<string, unknown>;
  approverPubkey: string;
}

// Diff data for code changes
interface DiffData {
  type: 'diff';
  filePath: string;
  hunks: DiffHunk[];
  language?: string;
}

// Final result
interface ResultData {
  type: 'result';
  summary: string;
  fileChanges: FileChange[];
  testResults?: TestResult[];
}
```

---

## Nostr Filter

When subscribing to a Probe agent, the hook builds this filter:

```typescript
const filter: ProbeSessionFilter = {
  kinds: [39230, 39231],
  '#p': [agentPubkey],
  since: sessionStartTimestamp,
  limit: 100,
};
```

---

## Example Usage in a Component

### Probe Session Monitor

```tsx
import { useProbeSession } from '@hooks/useProbeSession';
import { useEffect, useState } from 'react';

function ProbeSessionPanel({ agentPubkey }: { agentPubkey: string }) {
  const probe = useProbeSession();

  useEffect(() => {
    // Subscribe to all sessions from this agent
    const unsubscribe = probe.subscribeToAgent(agentPubkey);
    return unsubscribe;
  }, [agentPubkey]);

  return (
    <div>
      <h2>Active Sessions</h2>
      {probe.sessions.map((session) => (
        <div key={session.sessionId}>
          <span>Session {session.sessionId.slice(0, 8)}</span>
          <span>{session.status}</span>
        </div>
      ))}

      {probe.activeSession && (
        <SessionView session={probe.activeSession} />
      )}
    </div>
  );
}
```

### Tool Call Approval UI

```tsx
import { useProbeSession } from '@hooks/useProbeSession';

function ToolCallApproval() {
  const probe = useProbeSession();

  if (probe.pendingToolCalls.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-zinc-900 border border-zinc-700 p-4 rounded-lg">
      <h3 className="text-bitcoin-orange font-bold">Tool Approval Required</h3>

      {probe.pendingToolCalls.map((call) => (
        <div key={call.callId}>
          <h4>{call.toolName}</h4>
          <pre className="text-sm text-zinc-300">
            {JSON.stringify(call.parameters, null, 2)}
          </pre>

          <div className="flex gap-2 mt-2">
            <button
              onClick={() => probe.approveToolCall(call.callId)}
              className="bg-green-700 hover:bg-green-600 px-3 py-1 rounded"
            >
              Approve
            </button>
            <button
              onClick={() => probe.rejectToolCall(call.callId, 'User rejected')}
              className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Session Diff Renderer

```tsx
import { useProbeSession } from '@hooks/useProbeSession';

function SessionDiffRenderer({ sessionId }: { sessionId: string }) {
  const probe = useProbeSession();

  const diffs = probe.events
    .filter((e) => e.sessionId === sessionId && e.eventType === 'diff')
    .map((e) => e.data as DiffData);

  return (
    <div>
      {diffs.map((diff, i) => (
        <div key={i} className="mb-4">
          <h4 className="font-mono text-sm">{diff.filePath}</h4>
          {diff.hunks.map((hunk, j) => (
            <div key={j} className="font-mono text-xs">
              {hunk.lines.map((line, k) => (
                <div
                  key={k}
                  className={
                    line.type === 'add'
                      ? 'bg-green-900 text-green-300'
                      : line.type === 'remove'
                      ? 'bg-red-900 text-red-300'
                      : 'text-zinc-400'
                  }
                >
                  <span className="mr-2 text-zinc-600 select-none">
                    {line.lineNumber}
                  </span>
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                  {line.content}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

### Execution Result Display

```tsx
import { useProbeSession } from '@hooks/useProbeSession';

function ExecutionResultPanel({ sessionId }: { sessionId: string }) {
  const probe = useProbeSession();

  const result = probe.events
    .filter((e) => e.sessionId === sessionId && e.eventType === 'result')
    .map((e) => e.data as ResultData)
    .at(-1);

  if (!result) return <p>Waiting for result...</p>;

  return (
    <div>
      <h3>Session Result</h3>
      <p>{result.summary}</p>

      <h4>File Changes</h4>
      {result.fileChanges.map((fc) => (
        <div key={fc.path}>
          <span>{fc.changeType}</span>
          <span className="font-mono">{fc.path}</span>
          <span className="text-green-400">+{fc.additions}</span>
          <span className="text-red-400">-{fc.deletions}</span>
        </div>
      ))}

      {result.testResults && (
        <>
          <h4>Tests</h4>
          {result.testResults.map((tr) => (
            <div key={tr.name}>
              <span>{tr.passed ? '✓' : '✗'}</span>
              <span>{tr.name}</span>
              {tr.duration && <span>{tr.duration}ms</span>}
              {tr.error && <p className="text-red-400">{tr.error}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

---

## Approval Response Event

When a tool call is approved, the hook publishes a kind:39231 event to Pylon:

```json
{
  "kind": 39231,
  "pubkey": "<approverPubkeyHex>",
  "tags": [
    ["d", "<sessionId>"],
    ["type", "tool_approval"],
    ["call_id", "<callId>"],
    ["approved", "true"]
  ],
  "content": ""
}
```

---

## Related Hooks

- [`useAgentProfile`](./use-agent-profile.md) — agent pubkeys to subscribe to
- [usePylon](./use-probe-session.md) — Pylon connection status

## Related Libraries

- [Probe types](../libraries/README.md) — `probe` module types
- [SpacetimeDB Bridge](../libraries/bridge.md) — trajectory events bridged from SpacetimeDB
