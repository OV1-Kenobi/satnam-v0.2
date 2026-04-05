# `useScheduledPayments`

React hook for creating, managing, and monitoring scheduled and recurring push payments.

**Source:** `src/hooks/useScheduledPayments.tsx`

---

## Import

```typescript
import { useScheduledPayments } from '@/hooks/useScheduledPayments';
```

---

## Usage

```tsx
function ScheduledPanel() {
  const {
    schedules,
    createSchedule,
    cancelSchedule,
    pauseSchedule,
    resumeSchedule,
    executionHistory,
    isLoading,
    error,
  } = useScheduledPayments();

  return (
    <div>
      {schedules.map(s => (
        <div key={s.id}>
          <p>{s.label} — {s.status}</p>
          <p>Next: {s.nextExecutionAt ? new Date(s.nextExecutionAt).toLocaleString() : 'N/A'}</p>
          <button onClick={() => pauseSchedule(s.id)}>Pause</button>
          <button onClick={() => cancelSchedule(s.id)}>Cancel</button>
        </div>
      ))}
    </div>
  );
}
```

---

## Return Value

### State Properties

| Property | Type | Description |
|---|---|---|
| `schedules` | `ScheduledPayment[]` | All active, paused, and failed schedules |
| `executionHistory` | `Record<string, PaymentExecution[]>` | Execution records keyed by schedule ID |
| `isLoading` | `boolean` | True during load or execution operations |
| `error` | `Error \| null` | Last error |

---

### `createSchedule(payment: Omit<ScheduledPayment, 'id' | 'createdAt' | 'status' | 'executionHistory'>): Promise<ScheduledPayment>`

Create a new scheduled payment. The hook auto-generates the `id`, sets `createdAt`, and initializes `status` to `'active'`.

```typescript
const schedule = await createSchedule({
  label: 'Weekly dev stipend',
  recipientPubkey: 'npub1...',
  recipientLud16: 'alice@satnam.pub',
  amountMsats: 50_000_000n,
  rail: 'lightning',
  schedule: {
    type: 'recurring',
    interval: 'weekly',
  },
  conditions: [
    { type: 'balance_above', params: { thresholdMsats: 200_000_000 } },
  ],
});
```

---

### `cancelSchedule(id: string): Promise<void>`

Permanently delete a schedule. Execution history is preserved in `executionHistory`.

```typescript
await cancelSchedule(scheduleId);
```

---

### `pauseSchedule(id: string): Promise<void>`

Suspend a schedule. Sets `status` to `'paused'`. No payments fire until `resumeSchedule()` is called.

```typescript
await pauseSchedule(scheduleId);
```

---

### `resumeSchedule(id: string): Promise<void>`

Reactivate a paused schedule. Recalculates `nextExecutionAt` from the current time.

```typescript
await resumeSchedule(scheduleId);
```

---

## Execution History

`executionHistory` is a map from schedule ID to an array of `PaymentExecution` objects:

```typescript
interface PaymentExecution {
  executedAt: number;
  amountMsats: bigint;
  rail: PaymentRail;
  success: boolean;
  paymentHash?: string;
  error?: string;
}
```

```tsx
const history = executionHistory[scheduleId] ?? [];
const failCount = history.filter(e => !e.success).length;
const successCount = history.filter(e => e.success).length;
```

---

## Condition Reference

Attach conditions to gate execution:

```typescript
// Only fire if wallet balance > 100,000 sats
{ type: 'balance_above', params: { thresholdMsats: 100_000_000 } }

// Only fire between 9 AM and 5 PM UTC
{ type: 'time_window', params: { startHour: 9, endHour: 17 } }

// Only fire if recipient's trust score ≥ 50
{ type: 'trust_score_above', params: { minScore: 50 } }

// Queue for manual approval
{ type: 'approval_required', params: {} }
```

---

## Full Example: Create and Monitor a DCA Schedule

```tsx
import { useScheduledPayments } from '@/hooks/useScheduledPayments';

function DCASetup() {
  const { schedules, createSchedule, pauseSchedule, resumeSchedule, executionHistory } =
    useScheduledPayments();

  const handleCreate = async () => {
    await createSchedule({
      label: 'Weekly cold storage DCA',
      recipientPubkey: 'npub1coldwallet...',
      recipientLud16: 'cold@mynode.com',
      amountMsats: 100_000_000n, // 100,000 sats
      rail: 'lnbits',
      schedule: {
        type: 'recurring',
        interval: 'weekly',
        endAt: new Date('2026-12-31').getTime(),
      },
      conditions: [
        { type: 'balance_above', params: { thresholdMsats: 300_000_000 } },
      ],
    });
  };

  const active = schedules.filter(s => s.status === 'active');

  return (
    <div>
      <button onClick={handleCreate}>Set Up Weekly DCA</button>

      {active.map(s => {
        const history = executionHistory[s.id] ?? [];
        const lastSuccess = history.findLast(e => e.success);

        return (
          <div key={s.id} className="border border-zinc-800 rounded p-4">
            <h3>{s.label}</h3>
            <p>Next execution: {s.nextExecutionAt
              ? new Date(s.nextExecutionAt).toLocaleString()
              : '—'}</p>
            <p>Last success: {lastSuccess
              ? new Date(lastSuccess.executedAt).toLocaleString()
              : 'None yet'}</p>
            <p>Executions: {history.length}</p>
            <button onClick={() => pauseSchedule(s.id)}>Pause</button>
          </div>
        );
      })}
    </div>
  );
}
```

---

## Related

- [PaymentScheduler API](../libraries/payments.md#paymentscheduler) — Underlying scheduler
- [Push Payments Guide](../../user-guides/wallet/push-payments.md) — User documentation
- [useCascade](./use-cascade.md) — For distributing scheduled payments
- [useLNbits](./use-lnbits.md) — For the `lnbits` rail
