# Tutorial: Create Your First Group

This tutorial walks you through creating a FROST-managed group from start to finish. By the end, you will have a group with a shared public key, assigned roles for each member, and your first co-signed group event published to Nostr.

**Time:** 15–20 minutes  
**Prerequisites:** Two or more Satnam identities (you + at least one other person), both with vaults unlocked

---

## What You Are Building

A Satnam group is a federation of Principals that shares a common Nostr identity (public key). The group's private key never exists in any single place — it is split across members using FROST threshold signatures.

For this tutorial, you will create a 2-of-3 group:
- You as **Guardian** (Trust Protector)
- One other person as **Steward** (Trustee)
- One more person as **Adult** (Mature Beneficiary)

Any 2 of these 3 members can co-sign group events.

---

## Step 1: Navigate to Groups

1. Open Satnam v2 at [satnam.pub](https://satnam.pub)
2. Unlock your vault if prompted (WebAuthn biometric or passphrase)
3. From the dashboard, tap **Groups** in the navigation
4. Tap **Create Group**

You are now in the GroupCreateFlow component.

---

## Step 2: Configure Group Parameters

1. **Group Name:** Enter a name for your group (e.g., "Smith Family Trust" or "Project Alpha")
2. **Threshold:** Select **2-of-3** from the threshold picker
   - This means any 2 of the 3 members can co-sign
   - For higher security, you could choose 3-of-3 (all must sign)
3. **Tap Continue**

---

## Step 3: Add Participants

You need to add the npubs of all participants before the FROST ceremony begins.

1. **Your npub is auto-filled** as participant #1 (you will be Guardian)
2. Tap **Add Participant** and paste the npub of your Steward
3. Tap **Add Participant** again and paste the npub of your Adult
4. Verify all three npubs are listed correctly
5. Tap **Continue to Key Ceremony**

> **Important:** The other two participants must have Satnam v2 open and their vaults unlocked. They will need to respond to the DKG ceremony invitation.

---

## Step 4: FROST Distributed Key Generation (DKG) Ceremony

This is the cryptographic core of the process. Each participant generates their share of the group key without anyone ever seeing the full key.

1. Satnam publishes a ceremony invitation to the Pylon relay
2. **You will see:** "Waiting for participants to join…" with a list of pending participants
3. **Other participants:** They will see a notification in their Satnam app — "Group ceremony invitation from [your npub]". They tap **Join Ceremony**.
4. Once all three participants have joined, the DKG ceremony begins automatically

**What happens during the ceremony (shown in the UI):**

- **Round 1 — Commitments:** "Generating and broadcasting polynomial commitments…"
- **Round 2 — Share Exchange:** "Exchanging encrypted shares with participants…"
- **Verification:** "Verifying received shares against commitments…"
- **Key Derivation:** "Deriving group public key…"

The ceremony takes approximately 10–30 seconds depending on network latency.

5. **Success:** You will see "Group Created!" with the group's new npub (e.g., `npub1abc...`). All three participants see the same npub — this is the shared group identity.
6. Each participant's `bfshare` is stored in their OPFS Vault (`frost/{group_npub}.bfshare`)

> **Technical note:** The group public key is derived from the DKG output through FROST mathematics. No party ever held the full corresponding private key — it exists only as a latent property of the three shares acting together.

---

## Step 5: Assign Roles via NIP-26 Delegation

Now you need to formally assign roles. As Guardian, you sign NIP-26 delegation events that grant each member their capabilities.

1. Navigate to your group page (it should open automatically after creation)
2. Tap **Manage Members** → **Role Assignment**
3. You see the three participants listed with their npubs

**Assign Steward role:**
1. Tap the Steward participant
2. Select **Steward** from the role dropdown
3. Set the delegation expiry (recommended: 1 year from today)
4. Tap **Sign Delegation**
5. Your vault prompts for authorization (WebAuthn or passphrase confirmation)
6. The `kind:1` delegation event is signed with your nsec and published to Pylon

**Assign Adult role:**
1. Repeat the process for the Adult participant
2. Select **Adult** from the role dropdown
3. Set expiry and tap **Sign Delegation**

> **What just happened:** You published two NIP-26 delegation events. These events are signed by your nsec and grant specific event-kind permissions to each delegate. They are cryptographically verifiable by anyone — no database lookup required.

---

## Step 6: Verify Roles Are Active

1. Each participant opens Satnam v2 — their role should be visible in the group page
2. The Steward should see: "Your Role: Steward" with capabilities listed
3. The Adult should see: "Your Role: Adult" with their capability set

You can verify the delegation events are on-relay:
1. From the group page, tap **Group Details** → **Delegation Graph**
2. You will see a tree: Your npub (Guardian) → Steward npub, Adult npub
3. Each delegation shows the event ID, conditions string, and expiry

---

## Step 7: Sign Your First Group Event

Let's publish a group profile update — a `kind:0` event signed by the group's FROST keypair.

1. Navigate to your group page
2. Tap **Edit Group Profile**
3. Update the group description and tap **Save**
4. Satnam initiates a **FROST signing ceremony:**
   - You see: "Waiting for co-signers (need 1 more)…"
   - Your Steward (or the other threshold participant) opens Satnam and sees: "Co-sign request: Update group profile"
5. The Steward taps **Sign**
6. Both partial signatures are combined by Satnam
7. The final `kind:0` event is published to the relay network with the group's npub

**Verification:**
1. Copy the group npub
2. Open any Nostr client (Damus, Amethyst, etc.)
3. Search for the group npub
4. You should see the group profile — a `kind:0` event signed by a pubkey that no single person controls

---

## What You Accomplished

- Created a FROST group with a shared public key that no single party can abuse
- Ran a distributed key generation ceremony — no server involved, no full key ever existed
- Assigned roles using NIP-26 delegation events (not a database table)
- Co-signed a group event using threshold Schnorr signatures

**Next steps:**
- [Connect a wallet to your group](../user-guides/wallet/README.md)
- [Create an agent under your group](deploy-agent.md)
- [Set up NFC cards for physical ceremony verification](nfc-setup.md)
