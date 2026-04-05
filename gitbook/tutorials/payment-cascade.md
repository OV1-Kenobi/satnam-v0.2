# Tutorial: Building Your First Payment Cascade

This tutorial walks you through building a payment cascade from scratch — starting with a simple two-way percentage split and evolving it into a multi-tier distribution tree. By the end, you will have a reusable template that distributes revenue across your team automatically.

**Time:** 20–30 minutes  
**Prerequisites:** Satnam wallet connected (NWC, Cashu, or LNbits)

---

## Part 1: Your First Single-Tier Split

We will start simple: split a payment 70/30 between you and a collaborator.

### Step 1: Open the Cascade Builder

1. Go to **Wallet** in the navigation sidebar.
2. Click the **Cascades** tab.
3. Click **New Cascade**.

You will see an empty cascade builder with a label field and an empty node tree.

### Step 2: Name Your Cascade

Enter `My first split` in the **Label** field.

### Step 3: Set Execution Mode

Leave **Mode** as `parallel` — for a two-node split, both payments will fire simultaneously.

Set **Failure Policy** to `skip` — if one payment fails, the other still goes through.

### Step 4: Add the First Node

Click **Add Recipient**:

- **Recipient:** Enter your own npub (or Lightning address)
- **Percentage:** `70`
- **Rail:** `lightning`

Click **Save Node**.

### Step 5: Add the Second Node

Click **Add Recipient** again:

- **Recipient:** Enter your collaborator's npub or Lightning address
- **Percentage:** `30`
- **Rail:** `lightning`

Click **Save Node**.

### Step 6: Validate

The builder shows a green **Valid** badge. The percentage bar shows 70% + 30% = 100%.

### Step 7: Preview the Distribution

Click **Preview** and enter `100000` sats. You will see:

```
You            70,000 sats
Collaborator   30,000 sats
─────────────────────────
Total         100,000 sats
```

### Step 8: Save as Template

Click **Save as Template**. Your cascade is now stored and ready to execute.

### Step 9: Execute It

1. Click **Execute** on your new template.
2. Enter `50000` sats.
3. Click **Confirm**.
4. Watch the progress panel:
   ```
   ● You             [paid] 35,000 sats
   ● Collaborator    [paid] 15,000 sats
   ```

Congratulations — you have executed your first cascade.

---

## Part 2: Adding a Third Node

Now add an operations node that takes 10% off the top, reducing the split for the other two.

### Step 1: Edit Your Cascade

Open the cascade template and click **Edit**.

### Step 2: Add the Operations Node

Click **Add Recipient**:

- **Recipient:** Your ops wallet Lightning address
- **Percentage:** `10`
- **Rail:** `lnbits`

### Step 3: Adjust Existing Percentages

The builder warns: `Percentages sum to 110% — must be ≤ 100%`. Fix this:

- Edit **You**: change from `70` to `63`
- Edit **Collaborator**: change from `30` to `27`

Total: 63 + 27 + 10 = 100%. Validation passes.

### Step 4: Preview Again

Preview with 100,000 sats:

```
Ops wallet     10,000 sats (LNbits)
You            63,000 sats (Lightning)
Collaborator   27,000 sats (Lightning)
```

### Step 5: Save and Execute

Save the updated template. Execute it to verify all three payments land.

---

## Part 3: Building a Multi-Tier Tree

Now we will add sub-recipients to one of the nodes. The Collaborator will split their 27% between two sub-contractors.

### Step 1: Edit the Collaborator Node

Click **Edit** on the Collaborator node. Click **Add Child**:

- **Recipient:** Sub-contractor A's Lightning address
- **Percentage:** `60` (of Collaborator's amount)
- **Rail:** `auto`

Click **Save**. Then **Add Child** again:

- **Recipient:** Sub-contractor B's Lightning address
- **Percentage:** `40` (of Collaborator's amount)
- **Rail:** `cashu`

### Step 2: Understand the Math

With 100,000 sats total:
- Collaborator node receives 27,000 sats
  - Sub-A receives 60% of 27,000 = **16,200 sats**
  - Sub-B receives 40% of 27,000 = **10,800 sats**

The Collaborator node itself does **not** receive sats — the split happens at the sub-contractor level. If you want the Collaborator to keep some and distribute the rest, set sub-total percentages to less than 100%:

```
Collaborator node receives 27,000 sats:
  Sub-A   40%  →  10,800 sats
  Sub-B   30%  →   8,100 sats
  (keep)  30%  →   8,100 sats (retained by Collaborator's wallet)
```

### Step 3: Validate the Multi-Tier Tree

Click **Validate**. The builder checks each level independently:
- Root level: 10 + 63 + 27 = 100% ✓
- Collaborator children: 60 + 40 = 100% ✓

### Step 4: Preview the Full Tree

Preview with 100,000 sats:

```
Ops wallet       10,000 sats (LNbits)
You              63,000 sats (Lightning)
Collaborator: (distributes 27,000 sats)
  └── Sub-A      16,200 sats (Auto)
  └── Sub-B      10,800 sats (Cashu)
```

### Step 5: Switch to Sequential Mode

For multi-tier cascades, try `sequential` mode:

1. Click **Edit Cascade** (top level settings).
2. Change **Mode** to `sequential`.
3. Save.

In sequential mode, the cascade processes: Ops first → You second → Collaborator's sub-tree third. This lets you confirm the first payments before the tree descends.

---

## Part 4: Using Fixed Amounts

Sometimes a node should receive a fixed amount regardless of the total, not a percentage.

### Step 1: Edit the Ops Node

Open the Ops node and toggle **Fixed Amount** instead of **Percentage**.

Set the fixed amount to `5,000 sats`.

### Step 2: Observe the Calculation

With 100,000 sats total:
- Ops receives **5,000 sats** (fixed)
- Remaining: 95,000 sats distributed across 63% + 27% = 90% of the remaining:
  - You: 95,000 × 0.63 = 59,850 sats
  - Collaborator: 95,000 × 0.27 = 25,650 sats
  - (5,500 sats unallocated — stays with you as the sender)

> **Tip:** Fixed amounts are deducted from the parent total first. Percentages then apply to the remainder.

---

## Part 5: Scheduling a Cascade

Your cascade template can be executed on a recurring schedule:

1. Open **Wallet → Scheduled → New Schedule**.
2. Set recipient to a special self-address (your own npub).
3. Set amount to the total you want to distribute.
4. Under **On Execution**, select **Run Cascade** and pick your template.

> Currently, cascade execution from the scheduler is configured by combining a scheduled payment with a cascade trigger. The scheduled payment fires first, then triggers the cascade engine with the received amount.

---

## Summary

You have now built:
1. A single-tier two-way percentage split
2. A three-node flat distribution
3. A multi-tier recursive tree with sub-contractors
4. A cascade using fixed amounts alongside percentages

### What to Explore Next

- [Payment Cascades Guide](../user-guides/wallet/payment-cascades.md) — Full feature reference
- [useCascade Hook](../developer-reference/hooks/use-cascade.md) — Build cascades programmatically
- [Push Payments](../user-guides/wallet/push-payments.md) — Automate cascade execution
- [Tutorial: Sig4Sats Bonds](./sig4sats-bonds.md)
