# Tutorial: Setting Up Sig4Sats Bonds

This tutorial walks through one concrete example of each Sig4Sats bond type:

1. **Entitlement Bond** — Unlock a premium feature by paying Cashu
2. **Recovery Bond** — Set up Guardian collateral for a recovery approval
3. **Allowance Bond** — Fund a weekly spending allowance for an offspring

**Time:** 30–45 minutes  
**Prerequisites:** Satnam wallet with Cashu balance; at least one group with Guardian role

---

## Part 1: Entitlement Bond — Unlocking a Premium Feature

Entitlement bonds give you a blinded capability token in exchange for a Cashu payment. The bond is private: the feature provider cannot link your payment to your feature access.

### Scenario

You want to unlock the **Advanced Analytics** feature for 30 days. It costs 10,000 sats. You have Cashu proofs at `https://mint.example`.

### Step 1: Open the Bond Dashboard

1. Go to **Wallet → Bonds**.
2. Click the **Entitlements** tab.

You see a list of available features with their prices and durations.

### Step 2: Select the Feature

Find **Advanced Analytics** in the feature list. Click **Buy Bond**.

The system displays:
- Feature ID: `advanced-analytics`
- Cost: 10,000 sats
- Validity: 30 days
- Mint: `https://mint.example`

### Step 3: Review the Adaptor Signature Offer

Before payment, Satnam fetches the adaptor signature offer from the feature provider's Nostr event. The UI displays:

```
Provider: npub1provider...
Adaptor point: 02abc123...
Offer expires: in 10 minutes
```

Click **Verify Offer** to confirm the adaptor signature is mathematically well-formed. The UI shows a green checkmark.

### Step 4: Pay and Receive the Token

Click **Pay 10,000 sats**. The system:

1. Deducts 10,000 sats from your Cashu balance at `https://mint.example`.
2. The payment preimage is revealed, which completes the adaptor signature.
3. A blinded capability token is generated and stored in your OPFS Vault.

You see a success confirmation:

```
✓ Entitlement bond active
Feature: Advanced Analytics
Expires: May 5, 2026
Token stored in vault (encrypted)
```

### Step 5: Access the Feature

The **Advanced Analytics** tab in your Wallet now shows as unlocked. Each time you access it, Satnam silently presents your blinded token. The provider verifies it without learning your identity.

### Step 6: View the Bond

In **Wallet → Bonds → Entitlements**:

```
Advanced Analytics    ● active
Expires: May 5, 2026
Paid: 10,000 sats
```

When the bond expires, the status changes to `expired` and the feature is locked again. You can purchase a new bond to renew.

---

## Part 2: Recovery Bond — Guardian Collateral for Recovery

Recovery bonds require Guardians to post economic collateral before approving a recovery request. This creates accountability: Guardians who approve fraudulent recoveries lose their bond.

### Scenario

Alice (account holder) has lost her device. She wants to initiate recovery through her 2-of-3 Guardian group: Bob, Carol, and Dave.

### Step 1: Initiate the Recovery Request (Alice)

Alice's recovery request is a Nostr event that Bob, Carol, and Dave receive. Assume it has ID `recovery-evt-abc123`.

On **any** Guardian's device:

1. Go to **Wallet → Bonds → Recovery**.
2. Click **New Recovery Bond**.
3. Enter the Recovery Event ID: `recovery-evt-abc123`
4. Set threshold: `2` (2-of-3)
5. Enter Guardian pubkeys:
   - `npub1bob...`
   - `npub1carol...`
   - `npub1dave...`
6. Click **Initiate Bond Collection**.

Satnam publishes a Nostr notification to Bob, Carol, and Dave.

### Step 2: Bob Posts His Bond

Bob receives the notification in **Wallet → Bonds → Recovery**:

```
Recovery request: recovery-evt-abc123
Status: collecting (0/2 bonds)
[Add My Bond]
```

Bob clicks **Add My Bond**:
- Bond amount: 10,000 sats (configurable; default is the group's minimum collateral setting)
- Source: Bob's Cashu balance

Bob reviews and clicks **Post Bond**. 10,000 sats are locked in recovery escrow. The bond status updates to `collecting (1/2)`.

### Step 3: Carol Posts Her Bond

Carol sees the same notification. She opens **Wallet → Bonds → Recovery → recovery-evt-abc123** and clicks **Add My Bond**.

After Carol's bond is posted, the status updates to `threshold_met`:

```
Recovery request: recovery-evt-abc123
Status: ✓ threshold_met (2/2 bonds)
Bonded Guardians:
  ● Bob     10,000 sats ✓
  ● Carol   10,000 sats ✓
  ○ Dave    (not bonded)
[Execute Recovery]
```

### Step 4: Execute the Recovery

Any Guardian can now click **Execute Recovery**. The system:

1. Verifies the threshold has been met (2 of 3 Guardians bonded and signed).
2. Issues a **recovery capability token** — stored in Alice's new vault.
3. Returns both Guardians' bonds (10,000 sats each) to their Cashu balances.

```
✓ Recovery executed
Recovery token issued
Bob's bond: returned
Carol's bond: returned
```

### Step 5: What Happens If Recovery Is Fraudulent

If Alice's old device is later found and the recovery is determined to have been fraudulent:

1. Alice's Guardian raises a dispute.
2. The bond escrow smart contract (client-side enforcement) burns or redirects the bonds.
3. Bob and Carol lose their 10,000-sat stakes.

This economic stake ensures Guardians perform due diligence before approving a recovery.

---

## Part 3: Allowance Bond — Weekly Spending Allowance

Allowance bonds let Guardians fund offspring or employees with blinded spending tokens that have built-in limits.

### Scenario

Parent (Guardian) wants to give their teenager Alice a weekly allowance of 50,000 sats with these constraints:
- No single payment over 5,000 sats
- Maximum 20,000 sats per day
- Lightning and Cashu allowed
- Only from the trusted family mint

### Step 1: Create the Allowance Bond

As the Guardian:

1. Go to **Wallet → Bonds → Allowances**.
2. Click **New Allowance Bond**.
3. Fill in the details:
   - **Recipient:** `npub1alice_teenager...`
   - **Total amount:** `50,000 sats`
   - **Token denomination:** `1,000 sats`
   - **Cadence:** `weekly`
4. Set constraints:
   - Max single spend: `5,000 sats`
   - Daily limit: `20,000 sats`
   - Allowed rails: `Lightning`, `Cashu`
   - Allowed mints: `https://family-mint.example`
5. Click **Fund Allowance**.

The system mints 50 blinded tokens of 1,000 sats each and delivers them to Alice's vault.

Confirmation:

```
✓ Allowance bond created
Recipient: npub1alice_teenager...
Tokens issued: 50 × 1,000 sats
Total value: 50,000 sats
Refreshes: weekly (next: Monday)
```

### Step 2: Alice Receives the Allowance

On Alice's device, **Wallet → Overview** shows a new **Allowance** balance:

```
Allowance balance: 50,000 sats
  (50 tokens × 1,000 sats)
Spending limits:
  Max per payment: 5,000 sats
  Daily remaining: 20,000 sats
```

### Step 3: Alice Makes a Purchase

Alice buys a game skin for 3,500 sats via a Lightning address. Before the payment executes:

1. Satnam checks: `3,500 < maxSingleSpend (5,000)` ✓
2. Satnam checks: `3,500 + 0 today < dailyLimit (20,000)` ✓
3. 4 tokens (4,000 sats) are consumed; 500 sats in change is reminted.

After the purchase:
```
Allowance balance: 46,500 sats
Daily spent: 3,500 / 20,000 sats
```

### Step 4: Alice Tries to Exceed the Single-Payment Limit

Alice tries to pay a 7,000-sat invoice. Satnam blocks it:

```
✗ Payment blocked
Amount (7,000 sats) exceeds your allowance limit of 5,000 sats per payment.
```

The payment does not execute. No tokens are consumed.

### Step 5: Guardian Monitors the Allowance

As the Guardian, in **Wallet → Bonds → Allowances**:

```
Alice's weekly allowance
Tokens: 46.5/50 remaining (3.5 tokens spent)
Daily rate: 3,500 sats/day (avg)
Status: active
Refreshes: Monday
```

The Guardian can see spending rate but **not** which specific merchants Alice paid.

### Step 6: Allowance Refreshes Automatically

On Monday, the scheduler automatically:
1. Refunds unconsumed tokens (46.5 tokens) to the Guardian's Cashu balance.
2. Issues 50 fresh tokens for the new week.
3. Resets the daily counter.

The Guardian can adjust the allowance amount, cadence, or constraints before the next refresh.

---

## Summary

You have now set up all three Sig4Sats bond types:

| Bond Type | What You Did |
|---|---|
| Entitlement | Paid 10,000 sats Cashu → received a 30-day Advanced Analytics token |
| Recovery | Collected 2-of-3 Guardian bonds → issued a recovery capability token |
| Allowance | Funded a 50,000-sat weekly allowance with spending constraints |

### Key Takeaways

- **Entitlement bonds** are private — the provider cannot link payment to access.
- **Recovery bonds** create accountability — Guardians have real money at stake.
- **Allowance bonds** give oversight with privacy — aggregate visibility, not transaction-level surveillance.
- All tokens are stored encrypted in OPFS Vault. No server ever holds them.

### What to Explore Next

- [Sig4Sats Bonds Guide](../user-guides/wallet/sig4sats-bonds.md) — Full feature reference
- [useSig4Sats Hook](../developer-reference/hooks/use-sig4sats.md) — Build bond flows programmatically
- [BondManager API](../developer-reference/libraries/sig4sats.md) — Library reference
- [Tutorial: Building Your First Payment Cascade](./payment-cascade.md)
