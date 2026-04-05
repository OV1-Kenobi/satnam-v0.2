# Monitoring Agents

The Satnam agent monitoring dashboard gives you real-time visibility into every deployed agent — its health, spending, active sessions, and delegation status. For agents running Probe-style sessions, you can also review tool calls and approve or reject individual operations.

---

## Agent Dashboard Overview

Navigate to **Agents** to see the agent list. Each agent card (`AgentCard`) shows:

- **Agent name and avatar**
- **Status indicator:** Online (green), Idle (yellow), Offline/Unresponsive (red)
- **Last heartbeat:** Time since the agent published its most recent kind:39202 event
- **Balance summary:** Sats available in the agent's NWC wallet and Cashu balance
- **Active sessions:** Number of ongoing Probe trajectory sessions

Click any agent card to open the **Agent Detail Panel** for that agent.

---

## Heartbeat Monitoring

Agents publish periodic heartbeat events (kind:39202, NIP-SA agent schedule) to indicate they are alive and operating normally. The heartbeat interval is configurable per agent during creation (default: every 60 seconds for active agents, every 5 minutes for idle agents).

### Heartbeat States

```
● Online     — Heartbeat received within 2× the configured interval
◐ Delayed    — Heartbeat late by 2×–5× the configured interval (warning)
○ Offline    — No heartbeat for 5× the configured interval (alert)
✗ Failed     — Agent published a kind:39201 state event indicating failure
```

### Heartbeat Alerts

The agent monitoring panel shows:
- **Yellow warning** when heartbeat is delayed beyond 2× interval
- **Red alert** when heartbeat is missed beyond 5× interval
- **Notification** (if browser notifications are enabled) for offline status

A missed heartbeat does not automatically take action on the agent. It is a signal to the Governor that the agent may need attention.

---

## Performance Metrics

The `PerformanceReportPanel` shows aggregated metrics for the selected agent over configurable time windows (1h, 24h, 7d, 30d):

| Metric | Description |
|---|---|
| Jobs completed | Total NIP-90 DVM jobs accepted and fulfilled |
| Jobs failed | Jobs accepted but not completed (resulted in Default Notice) |
| Completion rate | `completed / (completed + failed)` as a percentage |
| Average job duration | Median time from job acceptance to settlement |
| Total earned | Sats received via job settlement |
| Total spent | Sats spent on compute, tools, and infrastructure |
| Reputation score | Current NIP-AC reputation delta accumulated |
| Skill executions | Number of NIP-SKL skill executions by skill name |

---

## Session Management

The `SessionManagerPanel` lists all active and recent Probe trajectory sessions for an agent.

### Trajectory Sessions (kind:39230)

A trajectory session is a Probe coding agent session. Each session has:
- Session ID (the `d` tag of the kind:39230 event)
- Start time
- Status: Active, Paused, Completed, Failed
- Total tool calls made
- Files modified

### Subscribing to a Session

To monitor an active Probe session:
1. Open the Agent Detail Panel.
2. Click **Sessions** tab.
3. Find the active session and click **Monitor**.

Satnam subscribes to trajectory events (kind:39231) on Pylon for this session:

```
Filter: {
  kinds: [39230, 39231],
  '#p': [agentPubkey],
  since: sessionStartTimestamp
}
```

The session view shows a live stream of trajectory events: tool calls, code diffs, execution results.

---

## Tool Call Approval

For supervised agents (Offspring role) or sessions where the Governor has enabled per-tool approval, tool calls appear in the `ToolCallApproval` interface before execution.

### Approval Interface

Each pending tool call shows:
- **Tool name** (e.g., `read_file`, `execute_command`, `fetch_url`)
- **Parameters** (full JSON — inspect what the agent is about to do)
- **Risk level** (read/write/execute classification)

Three actions are available:

| Action | Effect |
|---|---|
| **Approve** | Publishes a kind:39231 event with `tool_approval: "approved"` tag |
| **Reject** | Publishes kind:39231 with `tool_approval: "rejected"` tag — agent aborts this tool call |
| **Modify** | Edit the parameters before approving — publishes modified approval event |

> **Note:** Tool call approval is time-sensitive. If you do not respond within the session timeout (configurable, default 5 minutes), the tool call is automatically rejected and the agent is notified.

---

## Session Diff Renderer

When a Probe session modifies files, the kind:39231 trajectory events include `diff` tags. The `SessionDiffRenderer` displays these as code diffs:

```
  src/lib/example.ts
  ─────────────────────────────────────────
1 │ - const oldImplementation = () => {
2 │ -   return null;
3 │ - };
4 │ + const newImplementation = () => {
5 │ +   return 'improved value';
6 │ + };
```

- Red lines (−) are removed
- Green lines (+) are added
- Line numbers are shown in the gutter
- Syntax highlighting is CSS-based (no heavy JavaScript parser dependency)

---

## Execution Result Display

The `ExecutionResultPanel` renders kind:39231 events with `result` tags:

- **stdout** — Standard output from command execution
- **stderr** — Standard error (shown in amber to distinguish from stdout)
- **File changes** — Summary of files created, modified, or deleted
- **Test results** — Pass/fail counts for test suite runs
- **Exit codes** — For shell command executions

---

## Delegation Health

The `DelegationHealthPanel` shows the health of all active delegations associated with an agent:

- **Delegation issuer** — The Guardian or Steward who issued the delegation
- **Delegation expiry** — Time remaining before the delegation expires
- **Scope** — Which event kinds and conditions the delegation covers
- **Validity status** — Valid, Expiring Soon, Expired, or Revoked

A delegation health warning here means the agent may lose authorization to perform certain operations if the delegation is not renewed. See [Managing Roles](../groups/managing-roles.md#delegation-expiry) for renewal instructions.

---

## System Status Panel

The `SystemStatusPanel` at the top of the Agents page shows global status:

| Component | Status |
|---|---|
| Pylon relay connection | Connected / Reconnecting / Disconnected |
| OPFS Vault | Unlocked / Locked |
| NWC wallet | Connected / Error |
| Cashu balances | Sum across all mints |
| Active sessions | Count of live trajectory sessions |

---

## Related Pages

- [Agent Overview](./README.md) — Agent types and the NIP Triumvirate
- [Creating an Agent](./creating-an-agent.md) — Setup wizard and spend policy configuration
- [Managing Roles](../groups/managing-roles.md) — Delegation health and renewal
- [DVM Marketplace](../marketplace/README.md) — How agents participate in compute jobs
