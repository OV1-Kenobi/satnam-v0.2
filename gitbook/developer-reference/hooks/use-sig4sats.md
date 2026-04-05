# `useSig4Sats`

React hook for managing all three Sig4Sats bond types: entitlement bonds, recovery bonds, and allowance bonds.

**Source:** `src/hooks/useSig4Sats.tsx`

---

## Import

```typescript
import { useSig4Sats } from '@/hooks/useSig4Sats';
```

---

## Usage

```tsx
function BondDashboard() {
  const {
    entitlements,
    recoveryBonds,
    allowances,
    createEntitlement,
    createRecoveryBond,
    createAllowance,
    spendAllowance,
    isLoading,
    error,
  } = useSig4Sats();

  return (
    <div>
      <h2>Active Entitlements: {entitlements.filter(e => e.status === 'active').length}</h2>
      <h2>Recovery Requests: {recoveryBonds.filter(r => r.status === 'collecting').length}</h2>
      <h2>Allowances Managed: {allowances.length}</h2>
    </div>
  );
}
```

---

## Return Value

### State Properties

| Property | Type | Description |
|---|---|---|
| `entitlements` | `EntitlementBond[]` | All entitlement bonds (active, spent, expired) |
| `recoveryBonds` | `RecoveryBond[]` | All recovery bond requests (as initiator or Guardian) |
| `allowances` | `AllowanceBond[]` | Allowance bonds (as Guardian: created; as recipient: received) |
| `isLoading` | `boolean` | True during async operations |
| `error` | `Error \| null` | Last error |

---

## Entitlement Methods

### `createEntitlement(featureId: string, amount: number, mintUrl: string): Promise<EntitlementBond>`

Pay Cashu and receive a blinded entitlement token for the specified feature.

```typescript
const bond = await createEntitlement(
  'advanced-analytics',
  5_000,                        // sats
  'https://mint.example'
);
console.log(`Bond active: ${bond.status === 'active'}`);
console.log(`Expires: ${new Date(bond.expiresAt).toLocaleDateString()}`);
```

---

### `spendEntitlement(featureId: string): Promise<void>`

Mark an entitlement token as spent when the feature is accessed.

```typescript
// Called when user activates the gated feature
await spendEntitlement('advanced-analytics');
```

---

### Checking Entitlement Status

```typescript
const hasActiveAnalytics = entitlements.some(
  e => e.featureId === 'advanced-analytics' && e.status === 'active'
);
```

---

## Recovery Bond Methods

### `createRecoveryBond(recoveryEventId: string, guardians: string[], threshold: number): Promise<RecoveryBond>`

Initiate an N-of-M Guardian recovery bond collection.

```typescript
const recoveryBond = await createRecoveryBond(
  'nostr-event-id-of-recovery-request',
  [
    'npub1guardian1...',
    'npub1guardian2...',
    'npub1guardian3...',
  ],
  2 // 2-of-3 threshold
);
```

Publishes a Nostr notification to each Guardian pubkey. The bond enters `'collecting'` status.

---

### Participating as a Guardian

When you receive a recovery bond request as a Guardian, it appears in `recoveryBonds` with status `'collecting'`. To add your bond:

```typescript
// Each Guardian calls this on their own device
const { addGuardianBond } = useSig4Sats();

await addGuardianBond(
  recoveryEventId,
  myPubkey,
  cashuProofId // your stake
);
```

> **Note:** `addGuardianBond` is not listed in the primary hook return — it is an extended method available as `useSig4Sats().bondManager.addGuardianBond()`. It is surfaced separately because it is called by Guardians, not by the account holder initiating the recovery.

---

### Monitoring Recovery Progress

```tsx
function RecoveryProgress({ bond }: { bond: RecoveryBond }) {
  const signed = bond.guardianBonds.filter(g => g.signed).length;

  return (
    <div>
      <p>Bonds collected: {signed} of {bond.threshold} required</p>
      <p>Status: {bond.status}</p>
      {bond.status === 'threshold_met' && (
        <p className="text-green-500">Recovery authorized — proceed</p>
      )}
    </div>
  );
}
```

---

## Allowance Methods

### `createAllowance(recipientPubkey: string, amount: number, cadence: 'daily' | 'weekly' | 'monthly', constraints: AllowanceConstraints): Promise<AllowanceBond>`

Fund an allowance and issue blinded tokens to the recipient's vault.

```typescript
const allowance = await createAllowance(
  'npub1child...',
  50_000,      // sats total
  'weekly',
  {
    maxSingleSpend: 2_000,
    dailyLimit: 10_000,
    allowedRails: ['lightning', 'cashu'],
    allowedMints: ['https://trusted-mint.example'],
  }
);

console.log(`Issued ${allowance.tokenCount} tokens`);
```

---

### `spendAllowance(recipientPubkey: string, amount: number): Promise<void>`

Spend allowance tokens for a payment. Validates all constraints before consuming tokens.

```typescript
// Called before executing a payment from an allowance
try {
  await spendAllowance('npub1child...', 1_500);
} catch (e) {
  if (e instanceof AllowanceConstraintViolationError) {
    showError('This payment exceeds your allowance limit');
  }
}
```

---

### Checking Allowance Balance

```typescript
const myAllowances = allowances.filter(
  a => a.recipientPubkey === myPubkey && a.status === 'active'
);

const totalRemaining = myAllowances.reduce(
  (acc, a) => acc + (a.tokenCount - a.tokensSpent) * a.tokenDenomination,
  0
);
```

---

## Full Example: Bond Dashboard Component

```tsx
import { useSig4Sats } from '@/hooks/useSig4Sats';

function BondsDashboard() {
  const {
    entitlements,
    recoveryBonds,
    allowances,
    createEntitlement,
    createAllowance,
    isLoading,
  } = useSig4Sats();

  const activeEntitlements = entitlements.filter(e => e.status === 'active');
  const pendingRecoveries = recoveryBonds.filter(r => r.status === 'collecting');
  const activeAllowances = allowances.filter(a => a.status === 'active');

  return (
    <div className="space-y-6">
      {/* Entitlements Section */}
      <section>
        <h2 className="text-white font-semibold">
          Entitlement Tokens ({activeEntitlements.length} active)
        </h2>
        {activeEntitlements.map(e => (
          <div key={e.entitlementEventId} className="border border-zinc-800 rounded p-3">
            <p>{e.featureId}</p>
            <p className="text-zinc-400 text-sm">
              Expires {new Date(e.expiresAt).toLocaleDateString()}
            </p>
          </div>
        ))}
        <button
          onClick={() => createEntitlement('premium-feature', 10_000, 'https://mint.example')}
          disabled={isLoading}
        >
          Buy Entitlement
        </button>
      </section>

      {/* Recovery Section */}
      <section>
        <h2 className="text-white font-semibold">
          Recovery Bonds ({pendingRecoveries.length} pending)
        </h2>
        {pendingRecoveries.map(r => {
          const bonded = r.guardianBonds.filter(g => g.signed).length;
          return (
            <div key={r.recoveryEventId} className="border border-zinc-800 rounded p-3">
              <p>Recovery: {r.recoveryEventId.slice(0, 12)}...</p>
              <p>{bonded}/{r.threshold} Guardians bonded</p>
            </div>
          );
        })}
      </section>

      {/* Allowances Section */}
      <section>
        <h2 className="text-white font-semibold">
          Allowances ({activeAllowances.length} active)
        </h2>
        {activeAllowances.map(a => {
          const pct = Math.round((a.tokensSpent / a.tokenCount) * 100);
          return (
            <div key={a.recipientPubkey} className="border border-zinc-800 rounded p-3">
              <p>→ {a.recipientPubkey.slice(0, 16)}...</p>
              <p>{a.tokensSpent}/{a.tokenCount} tokens spent ({pct}%)</p>
              <p className="text-zinc-400 text-sm">Refreshes {a.cadence}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
```

---

## Related

- [BondManager API](../libraries/sig4sats.md) — Underlying bond manager
- [Sig4Sats Bonds Guide](../../user-guides/wallet/sig4sats-bonds.md) — User documentation
- [Tutorial: Setting Up Sig4Sats Bonds](../../tutorials/sig4sats-bonds.md)
- [useCashu](./use-cashu.md) — Cashu layer used by bonds
