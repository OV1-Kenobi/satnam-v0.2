# Sig4Sats Library (`src/lib/sig4sats/`)

The Sig4Sats library implements three cryptographic bond types backed by Cashu eCash and adaptor signatures. All bond operations are client-side; all keys and tokens are stored encrypted in the OPFS Vault. No new production dependencies are introduced — adaptor signatures use Schnorr primitives from `@noble/curves/secp256k1` which is already present.

---

## Installation and Import

```typescript
import { BondManager } from '@/lib/sig4sats';
import type {
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  AllowanceConstraints,
  AdaptorSignature,
  Sig4SatsBond,
  BondType,
} from '@/lib/sig4sats';

// Adaptor signature utilities
import {
  createAdaptorSignature,
  verifyAdaptorSignature,
  extractSecret,
} from '@/lib/sig4sats';
```

---

## Types Reference

### `BondType`

```typescript
type BondType = 'entitlement' | 'recovery' | 'allowance';
```

### `EntitlementBond`

A capability token issued in exchange for a Cashu payment.

```typescript
interface EntitlementBond {
  type: 'entitlement';
  featureId: string;
  amount: number;             // sats paid
  blindedToken: string;       // stored in OPFS Vault
  entitlementEventId: string; // Nostr event ID
  expiresAt: number;          // Unix timestamp
  status: 'active' | 'spent' | 'expired';
}
```

### `RecoveryBond`

N-of-M Guardian consensus bond for account recovery authorization.

```typescript
interface RecoveryBond {
  type: 'recovery';
  recoveryEventId: string;
  guardianBonds: Array<{
    guardianPubkey: string;
    bondAmount: number;       // sats
    signed: boolean;
    bondProofId: string;      // Cashu proof ID
  }>;
  threshold: number;          // e.g. 2 for 2-of-3
  recoveryToken?: string;     // issued when threshold is met
  status: 'collecting' | 'threshold_met' | 'executed' | 'refunded' | 'expired';
}
```

### `AllowanceBond`

Guardian-funded spending allocation for an offspring or agent.

```typescript
interface AllowanceBond {
  type: 'allowance';
  guardianPubkey: string;
  recipientPubkey: string;
  totalAmount: number;        // sats
  tokenDenomination: number;  // sats per token
  tokenCount: number;
  tokensSpent: number;
  cadence: 'daily' | 'weekly' | 'monthly';
  constraints: AllowanceConstraints;
  status: 'active' | 'depleted' | 'paused' | 'expired';
}
```

### `AllowanceConstraints`

```typescript
interface AllowanceConstraints {
  maxSingleSpend: number;     // sats
  dailyLimit: number;         // sats
  allowedRails: ('lightning' | 'cashu')[];
  allowedMints?: string[];    // Cashu mint URLs; undefined = all mints allowed
}
```

### `AdaptorSignature`

```typescript
interface AdaptorSignature {
  partialSig: string;   // hex-encoded partial Schnorr signature
  adaptorPoint: string; // hex-encoded secp256k1 point T
  message: string;      // hex-encoded message being signed
}
```

### `Sig4SatsBond`

Union type for storage and display.

```typescript
type Sig4SatsBond = EntitlementBond | RecoveryBond | AllowanceBond;
```

---

## `BondManager`

The main class for managing all three bond types.

### Constructor

```typescript
const bondManager = new BondManager({
  cashu,    // CashuClient instance
  vault,    // VaultClient for OPFS storage
  nostr,    // CEPS instance for publishing events
});
```

---

## Entitlement Bond Methods

### `createEntitlementBond(featureId: string, amount: number, mintUrl: string): Promise<EntitlementBond>`

Create an entitlement bond: request an adaptor sig offer, pay Cashu, receive blinded token.

**Flow:**
1. Fetch the adaptor sig offer from the feature provider (via Nostr event).
2. Verify the adaptor signature is well-formed using `verifyAdaptorSignature()`.
3. Pay the Cashu amount at `mintUrl`. The payment reveals the preimage.
4. The preimage completes the adaptor sig, producing the blinded entitlement token.
5. Store the token encrypted in OPFS Vault.

```typescript
const bond = await bondManager.createEntitlementBond(
  'advanced-analytics',
  5_000, // sats
  'https://mint.example'
);
console.log(`Bond status: ${bond.status}`);
console.log(`Expires: ${new Date(bond.expiresAt).toISOString()}`);
```

---

### `validateEntitlementToken(featureId: string, token: string): Promise<boolean>`

Check if an entitlement token is valid (active and not expired or spent).

```typescript
const isValid = await bondManager.validateEntitlementToken('advanced-analytics', token);
```

---

### `spendEntitlementToken(featureId: string): Promise<void>`

Mark an entitlement token as spent. Called when the user accesses the gated feature. Prevents double-spending.

```typescript
await bondManager.spendEntitlementToken('advanced-analytics');
```

---

## Recovery Bond Methods

### `createRecoveryBond(recoveryEventId: string, guardians: string[], threshold: number): Promise<RecoveryBond>`

Initiate an N-of-M Guardian bond collection for a recovery request.

```typescript
const bond = await bondManager.createRecoveryBond(
  'recovery-event-id-abc123',
  ['npub1guardian1...', 'npub1guardian2...', 'npub1guardian3...'],
  2 // 2-of-3
);
```

This publishes a Nostr notification to the specified Guardian pubkeys requesting their bonds.

---

### `addGuardianBond(recoveryEventId: string, guardianPubkey: string, bondProof: string): Promise<RecoveryBond>`

Record a Guardian's bond contribution. Called on each Guardian's device when they post their bond.

```typescript
const updatedBond = await bondManager.addGuardianBond(
  'recovery-event-id-abc123',
  'npub1guardian1...',
  cashuProofId
);

if (updatedBond.status === 'threshold_met') {
  console.log('Threshold reached — recovery can proceed');
}
```

---

### `executeRecovery(recoveryEventId: string): Promise<string>`

If the threshold is met, issue the recovery capability token. Returns the token string.

```typescript
const recoveryToken = await bondManager.executeRecovery('recovery-event-id-abc123');
```

**Throws** `ThresholdNotMetError` if not enough Guardian bonds have been collected.

---

## Allowance Bond Methods

### `createAllowanceBond(recipientPubkey: string, amount: number, cadence: AllowanceBond['cadence'], constraints: AllowanceConstraints): Promise<AllowanceBond>`

Fund an allowance and issue blinded tokens to the recipient's vault.

```typescript
const allowance = await bondManager.createAllowanceBond(
  'npub1offspring...',
  100_000, // sats total
  'weekly',
  {
    maxSingleSpend: 5_000,
    dailyLimit: 20_000,
    allowedRails: ['lightning', 'cashu'],
    allowedMints: ['https://trusted-mint.example'],
  }
);

console.log(`Issued ${allowance.tokenCount} tokens of ${allowance.tokenDenomination} sats each`);
```

---

### `spendAllowanceToken(recipientPubkey: string, amount: number): Promise<void>`

Consume allowance tokens for a payment. Validates constraints before spending.

**Throws** `AllowanceConstraintViolationError` if:
- `amount > constraints.maxSingleSpend`
- Daily spending would exceed `constraints.dailyLimit`
- The payment rail is not in `constraints.allowedRails`

```typescript
await bondManager.spendAllowanceToken('npub1offspring...', 3_000);
```

---

### `getAllowanceBalance(recipientPubkey: string): Promise<{ remaining: number, spent: number, total: number }>`

Get the current allowance state for a recipient.

```typescript
const balance = await bondManager.getAllowanceBalance('npub1offspring...');
console.log(`${balance.remaining} sats remaining of ${balance.total}`);
```

---

### `listBonds(type?: BondType): Promise<Sig4SatsBond[]>`

List all bonds, optionally filtered by type.

```typescript
const entitlements = await bondManager.listBonds('entitlement');
const allBonds = await bondManager.listBonds();
```

---

## Adaptor Signature Utilities (`src/lib/sig4sats/adaptor.ts`)

Low-level adaptor signature primitives. These are used internally by `BondManager` but are exported for advanced use cases.

### `createAdaptorSignature(message: string, signerNsec: string, adaptorPoint: string): AdaptorSignature`

Create a partial Schnorr adaptor signature. The partial signature is not valid on its own — it becomes a valid Schnorr signature when combined with the secret behind `adaptorPoint`.

```typescript
import { createAdaptorSignature } from '@/lib/sig4sats';

const adaptor = createAdaptorSignature(
  messageHex,
  signerNsec,
  adaptorPointHex
);
```

Uses `@noble/curves/secp256k1` Schnorr primitives. No additional cryptography library is required.

---

### `verifyAdaptorSignature(partialSig: string, adaptorPoint: string, pubkey: string, message: string): boolean`

Verify that a partial adaptor signature is well-formed and bound to the correct public key and message.

```typescript
const isValid = verifyAdaptorSignature(
  adaptor.partialSig,
  adaptor.adaptorPoint,
  signerPubkeyHex,
  messageHex
);
```

---

### `extractSecret(fullSig: string, partialSig: string): string`

Extract the adaptor secret from a completed (full) signature and the original partial signature. This reveals the secret that was hidden behind the adaptor point — used internally to complete the atomic payment/authorization link.

```typescript
const secret = extractSecret(completedSignatureHex, adaptor.partialSig);
```

---

## Storage Layout

All bond data is stored encrypted in the OPFS Vault:

| Path | Content |
|---|---|
| `sig4sats/entitlements.json` | `EntitlementBond[]` |
| `sig4sats/recovery-bonds.json` | `RecoveryBond[]` |
| `sig4sats/allowances.json` | `AllowanceBond[]` (as Guardian: issued; as recipient: received) |
| `sig4sats/blinded-tokens/` | Individual blinded token files by featureId |

---

## Error Types

| Error | Thrown When |
|---|---|
| `ThresholdNotMetError` | `executeRecovery()` called before threshold is met |
| `TokenAlreadySpentError` | `spendEntitlementToken()` called on a spent token |
| `TokenExpiredError` | Token has passed its `expiresAt` timestamp |
| `AllowanceConstraintViolationError` | `spendAllowanceToken()` would exceed a constraint |
| `AllowanceDepletedError` | No remaining tokens in the allowance |

---

## Barrel Exports (`src/lib/sig4sats/index.ts`)

```typescript
export { BondManager } from './bond-manager';
export { createAdaptorSignature, verifyAdaptorSignature, extractSecret } from './adaptor';
export type {
  BondType,
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  AllowanceConstraints,
  AdaptorSignature,
  Sig4SatsBond,
} from './types';
export {
  ThresholdNotMetError,
  TokenAlreadySpentError,
  TokenExpiredError,
  AllowanceConstraintViolationError,
  AllowanceDepletedError,
} from './errors';
```

---

## Related

- [useSig4Sats Hook](../hooks/use-sig4sats.md) — React hook wrapper
- [Sig4Sats Bonds Guide](../../user-guides/wallet/sig4sats-bonds.md) — User-facing documentation
- [Tutorial: Setting Up Sig4Sats Bonds](../../tutorials/sig4sats-bonds.md)
- [Cashu Library](./cashu.md) — Bearer token layer used by bonds
