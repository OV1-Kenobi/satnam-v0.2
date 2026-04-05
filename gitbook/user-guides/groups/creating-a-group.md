# Creating a Group

This guide walks through the Guardian flow for creating a new Satnam group — from setting the group name through completing the FROST Distributed Key Generation (DKG) ceremony.

> **Prerequisite:** You must have a Satnam identity set up and your vault unlocked. Only a Principal with Guardian authority can initiate a new group.

---

## Step 1: Start the Group Creation Flow

1. Navigate to **Groups** in the Satnam sidebar.
2. Click **Create Group**.
3. The `GroupCreateFlow` wizard opens.

---

## Step 2: Name Your Group and Set the Threshold

1. **Group Name:** Enter a name for your group (e.g., "Smith Family Trust", "Acme Ops Team").
2. **Threshold:** Set the threshold signing requirement. This is the minimum number of keyholders required to authorize a group signature.

   Common configurations:
   | Threshold | Setup | Meaning |
   |---|---|---|
   | 2-of-2 | Guardian + 1 Steward | Both must agree |
   | 2-of-3 | Guardian + 2 Stewards | Any 2 of 3 can sign |
   | 3-of-5 | Guardian + 4 Stewards | Any 3 of 5 can sign |

   > **Tip:** 2-of-3 is the most common threshold — it requires two parties to agree, but the group can operate even if one keyholder is temporarily unavailable.

3. Click **Next**.

---

## Step 3: Add Participants

Participants are the keyholders who will receive FROST shares. Each participant needs to be online during the DKG ceremony.

1. Enter each participant's `npub` (Nostr public key) or NIP-05 name (`name@satnam.pub`).
2. Assign each participant a provisional role:
   - You (the initiator) are automatically set as **Guardian**.
   - Additional participants are set as **Steward** by default.
3. Confirm the participant list. The total number of participants must be ≥ the threshold.

> **Note:** All participants must have Satnam v2 installed and their vault unlocked during the DKG ceremony. The ceremony requires each participant to be online on a Nostr relay.

---

## Step 4: The FROST DKG Ceremony

The DKG ceremony is a cryptographic protocol in which all participants jointly generate the group keypair without any single party ever holding the full private key. Here is what happens under the hood — explained in accessible terms:

### What is a DKG Ceremony?

A Distributed Key Generation ceremony is how FROST creates a group keypair. Think of it like each participant contributing a secret ingredient to a recipe — the final result (the group key) is collectively produced, but no single person knows all the ingredients.

### The Ceremony Flow

```
Step 1: Initiator (you) ──► publishes "ceremony start" event to Pylon relay
                                        │
Step 2: Each participant ──────────────►│ joins the ceremony
                                        │
Step 3: Participants exchange commitment messages (Round 1)
        Each party: generates random secret, publishes commitment
                                        │
Step 4: Participants exchange shares (Round 2)
        Each party: computes share contributions, distributes encrypted shares
                                        │
Step 5: Each participant verifies received shares
        Each party: verifies consistency of all received data
                                        │
Step 6: Group public key is derived ──► published to Pylon (kind:39200)
        Each participant stores their bfshare in OPFS Vault
```

### What You See in Satnam

1. Satnam shows a **Waiting for participants** screen. You and each Steward see a status panel with each participant listed.
2. As participants open the ceremony link (sent via NIP-17 direct message), their status updates to "Ready".
3. Once all participants are ready, click **Begin Ceremony**.
4. The ceremony runs automatically — progress indicators show Round 1 and Round 2 completing.
5. On success, a confirmation screen shows the derived group public key (`npub`).

### Duration

The DKG ceremony typically completes in 10–30 seconds over a normal internet connection. Most of the time is relay latency.

---

## Step 5: Storing FROST Shares

After the ceremony completes:

- **Each participant** stores their FROST `bfshare` file automatically in their OPFS Vault at `frost/{group_npub}.bfshare`.
- **Each participant** stores the group `bfprofile` at `frost/{group_npub}.bfprofile`.
- The group public key (group `npub`) is derived — no party holds the group private key.

> **Warning:** If a participant loses their FROST share (device loss with no vault backup), they can no longer co-sign group operations. The group can recover by initiating a **share rotation ceremony** — this generates new shares for all participants while preserving the group public key.

---

## Step 6: Adding Members After Creation

Members with Steward roles (who hold FROST shares) are added during the DKG ceremony. To add Adult or Offspring members (who do not hold FROST shares):

1. Navigate to **Groups → [Your Group] → Members**.
2. Click **Add Member**.
3. Enter the new member's `npub` or NIP-05 name.
4. Select their role: **Adult** or **Offspring**.
5. The Guardian or Steward signs a NIP-26 delegation event for this member.
6. The delegation event is published to Pylon.

The new member appears in the group member list once the delegation event is confirmed on the relay.

---

## Understanding Threshold in Practice

A 2-of-3 group means that any 2 of the 3 keyholders (Guardian + 2 Stewards) can authorize a group operation:

```
    Guardian ─── Steward A ─── Steward B
    (share #1)   (share #2)   (share #3)

Valid signing combinations:
  ✓ Guardian + Steward A
  ✓ Guardian + Steward B
  ✓ Steward A + Steward B
```

Group operations that require the group keypair include:
- Group profile updates (kind:39200)
- Group payment authorizations above the single-sig threshold
- Group attestation issuance (NIP-CA)

For day-to-day spending within policy limits, individual members (Guardian, Steward, Adult) can spend without a group signing ceremony.

---

## What Happens If a Keyholder Is Lost?

FROST supports **share rotation** — generating new shares without changing the group public key. The group's Nostr identity is preserved.

Rotation triggers:
- Guardian decision (scheduled rotation)
- Suspected share compromise
- Member departure (replace their share)
- Policy-mandated periodic rotation

To initiate a rotation: **Groups → [Your Group] → Settings → Rotate Shares**. This begins a new ceremony with the remaining available keyholders.

---

## Related Pages

- [Group Overview](./README.md) — Role hierarchy and use cases
- [Managing Roles](./managing-roles.md) — NIP-26 delegation after group creation
- [FROST in the Architecture](../../overview/architecture.md) — Technical details of threshold signing
