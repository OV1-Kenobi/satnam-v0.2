# Cashu Client

**Module path:** `src/lib/cashu/`
**Type definitions:** `src/lib/cashu/types.ts`
**Package:** `@cashu/cashu-ts@^2.5.0`
**Import alias:** `@lib/cashu`

---

## Overview

Cashu is the eCash payment rail in Satnam v2. It provides **blind-signed bearer tokens** denominated in satoshis — the privacy-preserving alternative to Lightning for micropayments, performance bonds, and agent-to-agent commerce.

Key properties:
- **Bearer instrument** — proofs are like cash; possession equals ownership
- **Blind-signed** — the mint cannot link minting to spending (unlinkability)
- **Sats-only** — all amounts in satoshis (Axiom 1)
- **Vault-stored** — proofs are encrypted in OPFS; leaking them loses the sats

### Use Cases in Satnam v2

| Use Case | Description |
|---|---|
| Metered platform actions | Event publish, task creation, contact addition — priced in blind tokens |
| Agent-to-agent micropayments | Sub-invoice-minimum payments where Lightning routing is uneconomical |
| Sig4Sats performance bonds | Task completion bonds posted as tokens, redeemed on success |
| Privacy preference | When users prefer no Lightning routing metadata, Cashu is the spend rail |

---

## Type Definitions

### `CashuProof`

A single Cashu bearer token. Proofs are the fundamental unit of the Cashu protocol. Anyone possessing a valid proof can redeem it at the mint.

```typescript
interface CashuProof {
  id: string;     // Keyset ID from the issuing mint
  amount: number; // Denomination in satoshis
  secret: string; // Blinded secret scalar (hex or stringified DLEQ JSON)
  C: string;      // Unblinded mint signature (hex-encoded compressed secp256k1 point)
}
```

### `MintInfo`

Metadata about a configured Cashu mint.

```typescript
interface MintInfo {
  url: string;        // Mint base URL (e.g. https://mint.minibits.cash/Bitcoin)
  name?: string;      // Human-readable name from /v1/info
  nuts: number[];     // Supported NUT numbers (e.g. [0, 1, 2, 4, 5, 6, 7, 8, 9])
  balance: number;    // Total sats held at this mint (sum of stored proof denominations)
  isAllowed: boolean; // Whether this mint is in the group's allowed_mints policy
}
```

### `MeltResult`

Result of a melt (Lightning payment) operation.

```typescript
interface MeltResult {
  paid: boolean;         // Whether the Lightning payment succeeded
  preimage?: string;     // Payment preimage (hex) — only if paid
  change?: CashuProof[]; // Change proofs from Lightning fee over-estimation
}
```

### `ProofStatus`

State of a proof as reported by the mint's check-state endpoint.

```typescript
interface ProofStatus {
  proof: CashuProof;
  state: 'valid' | 'spent' | 'pending';
}
```

### `TokenPayload`

Decoded structure of a serialized Cashu token string (`cashuA...`).

```typescript
interface TokenPayload {
  token: Array<{
    mint: string;          // Mint URL that issued these proofs
    proofs: CashuProof[];
  }>;
  memo?: string;           // Optional human-readable memo
  unit: 'sat';             // Always 'sat' in Satnam v2
}
```

---

## CashuClient API

```typescript
interface CashuClient {
  // Mint management
  addMint(mintUrl: string): Promise<void>;
  removeMint(mintUrl: string): Promise<void>;
  listMints(): Promise<MintInfo[]>;

  // Token operations
  mintTokens(amountSats: number, mintUrl: string): Promise<CashuProof[]>;
  meltTokens(proofs: CashuProof[], bolt11: string): Promise<MeltResult>;
  sendTokens(amountSats: number, mintUrl: string): Promise<string>; // Returns serialized token
  receiveTokens(serializedToken: string): Promise<CashuProof[]>;
  getBalance(mintUrl?: string): Promise<number>; // Sats across all proofs (or for one mint)

  // Proof management
  checkProofStatus(proofs: CashuProof[]): Promise<ProofStatus[]>;
  swapProofs(proofs: CashuProof[], mintUrl: string): Promise<CashuProof[]>;
}
```

---

## Coin Selection Algorithm

When spending, the client selects the smallest set of proofs that satisfies the requested amount (similar to Bitcoin coin selection). The goals are:

1. **Exact match preferred** — use proofs that sum exactly to the amount.
2. **Minimize dust** — prefer larger denominations first.
3. **Privacy** — avoid reusing the same proof combination twice (linkability risk).
4. **Change minimization** — prefer proof sets that minimize change returned.

```typescript
// Internal coin selection (simplified)
function selectProofs(
  available: CashuProof[],
  targetSats: number
): { selected: CashuProof[]; change: number } {
  // Sort by denomination descending
  const sorted = [...available].sort((a, b) => b.amount - a.amount);
  const selected: CashuProof[] = [];
  let total = 0;

  for (const proof of sorted) {
    if (total >= targetSats) break;
    selected.push(proof);
    total += proof.amount;
  }

  if (total < targetSats) {
    throw new Error('InsufficientBalance');
  }

  return { selected, change: total - targetSats };
}
```

When change is returned from the mint (due to Lightning fee over-estimation in a melt), the change proofs are stored back to the vault.

---

## Proof Storage in Vault

Proofs are stored encrypted at `vault/cashu/{mintUrlHash}.proofs`. The `mintUrlHash` is the hex-encoded SHA-256 of the mint URL, which avoids filesystem-illegal characters in URLs.

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function mintUrlHash(url: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(url)));
}

// Read proofs for a mint
const proofs = await vault.getCashuProofs(mintUrlHash(mintUrl));

// Write proofs (after mint or receive)
await vault.storeCashuProofs(mintUrlHash(mintUrl), updatedProofs);
```

**After every token operation** — mint, melt, send, receive — the vault is updated atomically. The client never leaves proofs in a partially-updated state.

---

## Allowed Mints Policy

Guardian-configured mint allowlist enforced by the group's `AgentWalletPolicy`:

```typescript
interface AgentWalletPolicy {
  allowed_mints: string[]; // Empty = allow all. Non-empty = whitelist.
  sweep_threshold_sats: number;
  sweep_destination: string | null;
  sweep_rail: 'lightning' | 'cashu';
}
```

When `allowed_mints` is non-empty, the `CashuClient` rejects operations targeting unlisted mints and the UI marks them as `isAllowed: false` in `MintInfo`.

---

## Code Examples

### Mint Tokens from Lightning

```typescript
import { useCashu } from '@hooks/useCashu';

function MintFlow() {
  const cashu = useCashu();

  async function mintFromLightning(sats: number, mintUrl: string) {
    // 1. Request a Lightning invoice from the mint
    const proofs = await cashu.mintTokens(sats, mintUrl);
    // The mintTokens flow:
    //   a. GET /v1/mint/quote/bolt11 → receive BOLT-11 invoice
    //   b. Pay invoice via NWC (or user scans QR)
    //   c. POST /v1/mint/bolt11 with blind secrets → receive signed proofs
    //   d. Store proofs in vault
    console.log(`Minted ${proofs.reduce((s, p) => s + p.amount, 0)} sats`);
    return proofs;
  }
}
```

### Send Cashu Token

```typescript
const cashu = useCashu();

async function sendToken(sats: number, mintUrl: string) {
  // Selects proofs, sends them to mint for splitting if needed, returns serialized token
  const token = await cashu.sendTokens(sats, mintUrl);
  // token is a cashuA... base64url string
  // Share this string with the recipient (copy to clipboard, display as QR, etc.)
  return token;
}
```

### Receive Cashu Token

```typescript
const cashu = useCashu();

async function receiveToken(tokenString: string) {
  // Validates, swaps proofs at the mint (prevents double-spend), stores in vault
  const proofs = await cashu.receiveTokens(tokenString);
  const totalSats = proofs.reduce((sum, p) => sum + p.amount, 0);
  console.log(`Received ${totalSats} sats`);
}
```

### Melt (Pay Lightning Invoice with eCash)

```typescript
const cashu = useCashu();

async function payWithCashu(bolt11: string, mintUrl: string) {
  // Select proofs matching invoice amount + fee estimate
  const balance = await cashu.getBalance(mintUrl);
  const proofs = await vault.getCashuProofs(mintUrlHash(mintUrl));

  const result = await cashu.meltTokens(proofs, bolt11);
  if (result.paid) {
    console.log('Paid. Preimage:', result.preimage);
    // Change proofs (if any) are automatically stored back to vault
    if (result.change?.length) {
      console.log('Change returned:', result.change.reduce((s, p) => s + p.amount, 0), 'sats');
    }
  } else {
    console.error('Payment failed — proofs not spent, still valid');
  }
}
```

### Check Total Balance

```typescript
const cashu = useCashu();

// Balance across all mints
const totalSats = await cashu.getBalance();

// Balance at a specific mint
const mintBalance = await cashu.getBalance('https://mint.minibits.cash/Bitcoin');
```

---

## NUT Support

Satnam v2 requires mints to support at minimum NUTs 0, 1, 3, 4, 5, and 6:

| NUT | Feature | Required |
|---|---|---|
| NUT-00 | Basic Cashu protocol | Yes |
| NUT-01 | Mint information endpoint | Yes |
| NUT-03 | Swap (split) proofs | Yes |
| NUT-04 | Mint tokens from Lightning | Yes |
| NUT-05 | Melt tokens to Lightning | Yes |
| NUT-06 | Restore backed-up proofs | Recommended |
| NUT-07 | Token state check | Yes |
| NUT-08 | Lightning fee return | Recommended |
| NUT-09 | Restore (DLEQ) | Recommended |

Mint capabilities are discovered via `GET /v1/info` and stored in `MintInfo.nuts`.

---

## Related

- [useCashu hook](../hooks/use-cashu.md)
- [Vault library](./vault.md) — Cashu proofs stored in vault
- [NWC library](./nwc.md) — Lightning payment rail (alternative)
- Specification §6.2 — Cashu / eCash
