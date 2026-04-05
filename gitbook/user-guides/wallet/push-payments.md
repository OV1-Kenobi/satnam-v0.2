# Push Payments (Scheduled & Recurring)

Push payments let you schedule automatic outbound payments on any interval — hourly, daily, weekly, biweekly, or monthly. You can attach conditions that must be satisfied before each execution fires, and every payment is logged with its result so you have a full audit trail.

---

## What Is a Push Payment?

A **push payment** is an outbound payment you configure once and let run autonomously. Instead of manually sending sats every week, you describe the payment (recipient, amount, interval, conditions) and the `PaymentScheduler` handles execution for you.

All schedules are persisted encrypted in your OPFS Vault at `payments/schedules.json`. They survive page refreshes, browser restarts, and device sleep.

---

## Schedule Types

| Type | Description |
|---|---|
| `one-time` | Execute exactly once at a future timestamp |
| `recurring` | Execute repeatedly on a set interval |
| `conditional` | Execute whenever all conditions are true (triggered by condition check, not a fixed schedule) |

---

## Payment Rails

Each scheduled payment specifies which rail to use:

| Rail | Best For |
|---|---|
| `lightning` | Standard-size payments via your NWC wallet |
| `cashu` | Privacy-preserving micropayments, sub-1-sat amounts |
| `lnbits` | Payments from your LNbits wallet balance |
| `auto` | Scheduler picks: Cashu for amounts under 1 sat, Lightning otherwise |

---

## Conditions

Conditions gate each payment execution. All conditions in the list must pass before a payment fires.

### `balance_above`

Fires only if your wallet balance (on the chosen rail) exceeds a threshold.

```json
{
  "type": "balance_above",
  "params": { "thresholdMsats": 50000000 }
}
```

Useful for allowance payments — only send when you actually have funds.

### `time_window`

Fires only during a specific time-of-day window (UTC).

```json
{
  "type": "time_window",
  "params": { "startHour": 9, "endHour": 17 }
}
```

Useful for business-hours-only automated payments.

### `trust_score_above`

Fires only if the recipient's Circle of Trust score meets a threshold. If the recipient is not in your Circle of Trust, the condition fails and the payment is skipped.

```json
{
  "type": "trust_score_above",
  "params": { "minScore": 50 }
}
```

### `approval_required`

Queues a payment for manual approval rather than firing automatically. You receive a notification and must approve or reject before the payment executes. Useful for large amounts where you want an audit trail of human review.

```json
{
  "type": "approval_required",
  "params": {}
}
```

---

## Setting Up a Scheduled Payment

1. Open the **Wallet** section and tap the **Scheduled** tab.
2. Tap **New Schedule**.
3. Fill in:
   - **Label** — a human-readable name for this schedule (e.g., "Weekly dev stipend")
   - **Recipient** — a Nostr pubkey or Lightning address (`user@domain.com`)
   - **Amount** — in sats (converted to msats internally)
   - **Rail** — Lightning, Cashu, LNbits, or Auto
4. Configure the schedule:
   - For **one-time**: pick a date/time
   - For **recurring**: choose an interval (hourly/daily/weekly/biweekly/monthly), optional end date, optional max executions
   - For **conditional**: leave the interval empty; the scheduler checks conditions on every processing cycle
5. Add conditions (optional). Click **Add Condition** to attach one or more gates.
6. Tap **Save Schedule**.

The schedule is immediately active. The next execution timestamp is displayed in the schedule list.

---

## Managing Schedules

From the **Scheduled** tab you can:

| Action | Effect |
|---|---|
| **Pause** | Suspend a schedule without deleting it. No payments fire until you resume. |
| **Resume** | Reactivate a paused schedule. The next execution is recalculated from the current time. |
| **Cancel** | Permanently delete the schedule and all future executions. History is preserved. |
| **Edit** | Modify amount, interval, conditions, or recipient. Takes effect on the next execution cycle. |

---

## Execution History

Every execution (successful or failed) is logged with:

- Timestamp of execution
- Amount sent (in msats)
- Rail used
- Payment hash (Lightning/LNbits) or token ID (Cashu)
- Error message if the payment failed

Failed executions are retried on the next processing cycle if the schedule is still active. After 3 consecutive failures, the schedule status changes to `failed` and you receive a notification.

---

## Use Cases

### Dollar-Cost Averaging (DCA)

Set up a recurring weekly payment from your LNbits wallet to your cold storage Lightning address.

```
Label:     Weekly cold storage DCA
Recipient: coldwallet@yourdomain.com
Amount:    50,000 sats
Rail:      LNbits
Schedule:  Weekly, every Monday
Condition: balance_above 100,000 sats
```

### Team Allowances

Set up monthly payments to team members, gated on balance:

```
Label:     Monthly dev stipend — Alice
Recipient: alice@satnam.pub
Amount:    1,000,000 sats
Rail:      Lightning
Schedule:  Monthly, 1st of month
Condition: balance_above 3,000,000 sats
Condition: approval_required
```

### Agent Funding

Fund an agent's Cashu balance weekly so it can execute jobs without waiting for manual top-ups:

```
Label:     Agent weekly eCash top-up
Recipient: agent_npub1...
Amount:    10,000 sats
Rail:      Cashu
Schedule:  Weekly
Condition: trust_score_above 80
```

### Subscription Payments

Pay a recurring Lightning address subscription:

```
Label:     Monthly relay subscription
Recipient: subscriptions@relay.example
Amount:    21,000 sats
Rail:      Auto
Schedule:  Monthly
```

---

## Agents and Scheduled Payments

Agents with sufficient autonomy level can create and manage scheduled payments within their spend policy limits. An agent may not create a scheduled payment whose `amount × estimated_executions` exceeds its remaining spend envelope. The Governor receives a notification for any scheduled payment created by an agent.

---

## Related Pages

- [LNbits Integration](./lnbits-integration.md) — For using the `lnbits` rail
- [Cashu eCash](./cashu-ecash.md) — For using the `cashu` rail
- [Payment Cascades](./payment-cascades.md) — Distribute a single payment across multiple recipients
- [useScheduledPayments Hook](../../developer-reference/hooks/use-scheduled-payments.md) — Developer API
- [PaymentScheduler API](../../developer-reference/libraries/payments.md) — Library reference
