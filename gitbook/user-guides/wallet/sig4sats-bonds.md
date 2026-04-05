# Sig4Sats Bonds

Sig4Sats is Satnam's cryptographic bond system. It uses **adaptor signatures** — a technique that ties a Cashu payment to a Nostr event signature, ensuring that payment and authorization happen atomically. Either both happen or neither does.

Satnam v2 introduces three bond types, each serving a distinct purpose in the trust hierarchy.

---

## How Adaptor Signatures Work (Simplified)

An adaptor signature is a partial cryptographic signature that only becomes valid when a secret is revealed. In Satnam:

1. A **signer** creates a partial signature over a message, bound to a secret point `T` (the "adaptor point").
2. A **verifier** can confirm the partial signature is well-formed without being able to use it.
3. When a **Cashu payment** is made, the payment preimage reveals the secret that completes the signature.
4. The two events — payment and authorization — are now **atomically linked**: you can't have one without the other.

This means:
- The payer cannot steal the authorization without paying.
- The signer cannot receive payment without granting authorization.
- Neither party needs to trust the other.

---

## Bond Type 1: Entitlement Bonds

**Purpose:** Pay Cashu → receive a blinded capability token for a premium feature.

An entitlement bond grants you access to a gated feature (e.g., advanced analytics, extended agent autonomy, marketplace priority) in exchange for a Cashu payment. The bond token proves you have paid without revealing your identity to the feature provider.

### How It Works

1. You request an entitlement for `featureId`.
2. The feature provider creates an adaptor signature offer: "Pay X sats and I'll complete this signature."
3. You pay the Cashu amount. The mint reveals the preimage, which completes the provider's signature.
4. The completed signature produces a **blinded entitlement token** — stored in your OPFS Vault.
5. When you access the feature, you present the token. The provider verifies it without knowing who you are.
6. The token is marked `spent` after use and cannot be reused.

### Entitlement Bond Lifecycle

```
[requested] → [paid] → [active] → [spent]
                                 → [expired]
```

| Status | Meaning |
|---|---|
| `active` | Token is valid and unused |
| `spent` | Token has been redeemed for feature access |
| `expired` | Token exceeded its validity window |

### Setting Up an Entitlement Bond

1. Open **Wallet → Bonds → Entitlements**.
2. Click **New Entitlement Bond**.
3. Select the feature from the available list (or enter a custom `featureId`).
4. Review the amount and expiry.
5. Click **Pay & Activate**. The Cashu payment happens atomically with token issuance.

### Privacy Guarantees

- The Cashu mint cannot link the payment to the token issuance (Chaumian blindness).
- The feature provider cannot link the token presentation to the payment — they only see the blinded token.
- The token is stored encrypted in your OPFS Vault and never transmitted in plaintext.

---

## Bond Type 2: Recovery Bonds

**Purpose:** Guardians stake economic collateral to authorize recovery approvals (N-of-M consensus).

When an account recovery is needed (e.g., lost device, lost nsec), it must be approved by a threshold of Guardians. Recovery bonds ensure Guardians have real economic skin-in-the-game — a Guardian who carelessly approves a fraudulent recovery request loses their bond.

### How It Works

1. A **recovery request** is initiated (by the account holder or a trusted contact).
2. Each participating Guardian **posts a Cashu bond** (e.g., 10,000 sats) as collateral.
3. Once the threshold is met (e.g., 2-of-3 Guardians have bonded and signed), a **recovery capability token** is issued.
4. If the recovery is executed legitimately:
   - Bonds are returned to each Guardian.
   - Recovery proceeds.
5. If the recovery is later proven fraudulent:
   - Bonds are forfeited (burned or redistributed to the legitimate account holder).

### Recovery Bond Lifecycle

```
[collecting] → [threshold_met] → [executed] → (bonds returned)
            → [expired]                     → (bonds returned)
```

| Status | Meaning |
|---|---|
| `collecting` | Waiting for more Guardians to post bonds |
| `threshold_met` | Enough Guardians have bonded; recovery can proceed |
| `executed` | Recovery has been performed; bonds returned |
| `refunded` | Recovery cancelled or timed out; bonds returned |
| `expired` | Recovery window elapsed; bonds returned |

### Initiating a Recovery Bond (as Guardian)

1. Open **Wallet → Bonds → Recovery**.
2. Click **New Recovery Bond**.
3. Select or enter the `recoveryEventId` (from the recovery request event).
4. Set the threshold (e.g., 2-of-3).
5. Enter participating Guardian pubkeys.
6. Click **Post Bond**. Your Cashu bond is locked into the recovery escrow.

Other Guardians see the pending recovery in their **Wallet → Bonds → Recovery** panel and can add their bonds.

### Participating as a Guardian

When another Guardian initiates a recovery bond request, you receive a Nostr notification. Open **Wallet → Bonds → Recovery**, find the pending request, review the recovery event, and click **Add My Bond** to post your collateral.

---

## Bond Type 3: Allowance Bonds

**Purpose:** Guardians fund offspring spending with blinded Cashu tokens that enforce spending rules.

An allowance bond is a pre-funded bucket of Cashu tokens with built-in spending constraints. A Guardian (parent, employer) creates the allowance; the recipient (offspring, employee) spends from it within the defined limits. The tokens are blinded — the Guardian cannot see exactly which individual transactions were made, only the total spent balance.

### How It Works

1. A Guardian creates an allowance bond: deposits X sats, specifies constraints.
2. The system issues N blinded tokens of denomination D to the recipient's vault.
3. The recipient spends tokens from their allowance for qualifying payments.
4. The Guardian sees the aggregate spending rate but not individual transactions.
5. At the configured cadence (daily/weekly/monthly), the allowance refreshes with new tokens.

### Spending Constraints

| Constraint | Description |
|---|---|
| `maxSingleSpend` | Maximum sats for a single transaction |
| `dailyLimit` | Maximum sats per day across all transactions |
| `allowedRails` | Which rails the recipient can spend on (`lightning`, `cashu`) |
| `allowedMints` | Which Cashu mints are permitted for eCash spending |

### Allowance Bond Lifecycle

```
[active] → (tokens depleted) → [depleted]
         → (Guardian pauses) → [paused] → [active]
         → (expiry)          → [expired]
```

### Creating an Allowance Bond (as Guardian)

1. Open **Wallet → Bonds → Allowances**.
2. Click **New Allowance Bond**.
3. Select the recipient (from your group members or enter a pubkey).
4. Set the total amount (sats), token denomination, and cadence.
5. Configure constraints:
   - Max single spend
   - Daily limit
   - Allowed rails
   - Allowed mints (optional)
6. Click **Fund Allowance**. Cashu tokens are issued to the recipient's vault.

### Using an Allowance (as Recipient)

When you have an active allowance bond, a dedicated balance appears in **Wallet → Overview → Allowance**. Payments made within the constraints automatically draw from this balance. If a payment exceeds a constraint (e.g., `maxSingleSpend`), it is rejected with a constraint violation notice.

### Allowance Privacy

- The Guardian can see the **aggregate tokens spent** vs. total (e.g., "14 of 20 tokens used").
- The Guardian cannot see which specific payments were made.
- The token denomination sets the granularity of the Guardian's visibility.

---

## Bond Dashboard

Open **Wallet → Bonds** to see all three bond types in one view:

- **Entitlements** — Active features, expiry countdowns, spent tokens
- **Recovery** — Active recovery requests, Guardian participation, threshold progress bars
- **Allowances** — Funding status (as Guardian) and spending status (as recipient), spending rate charts

---

## Use Cases by Role

| Role | Entitlement Bonds | Recovery Bonds | Allowance Bonds |
|---|---|---|---|
| Guardian | Unlock Guardian-tier features | Approve/deny recovery requests with stake | Fund offspring or employee allowances |
| Steward | Unlock Steward features | Participate in recovery thresholds | Manage team allowances |
| Adult | Unlock premium features | Initiate recovery requests | Receive and spend allowances |
| Offspring | Unlock limited features | — | Receive allowance, spend within limits |
| Agent | Unlock agent premium capabilities | — | Spend from operator-funded allowance |

---

## Security Notes

- All bond tokens and adaptor signature data are stored encrypted in your OPFS Vault.
- Adaptor signatures use Schnorr primitives from `@noble/curves/secp256k1` — no new cryptography libraries.
- Bond expiry is enforced client-side. Expired tokens are automatically invalidated.
- Recovery bond collateral is Cashu-backed — it is not custodied by Satnam. The escrow logic runs on-device.

---

## Related Pages

- [Wallet Overview](./README.md)
- [Cashu eCash](./cashu-ecash.md) — The bearer token layer used by all bond types
- [BondManager API](../../developer-reference/libraries/sig4sats.md) — Developer reference
- [useSig4Sats Hook](../../developer-reference/hooks/use-sig4sats.md) — React hook
- [Tutorial: Setting Up Sig4Sats Bonds](../../tutorials/sig4sats-bonds.md)
