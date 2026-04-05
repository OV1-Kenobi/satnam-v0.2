# Managing Roles

In Satnam, roles are not rows in a database — they are **NIP-26 delegation events** published to Nostr relays. Every role assignment, modification, and revocation is a signed Nostr event with a verifiable chain back to the group Guardian.

---

## How NIP-26 Delegation Works

NIP-26 is the Nostr delegation specification. A delegation event grants one Nostr pubkey (the *delegate*) the authority to act on behalf of another (the *delegator*), within defined constraints:

- **Which event kinds** the delegate can publish on the delegator's behalf
- **Time bounds** — when the delegation expires
- **Additional conditions** defined in the conditions string

In Satnam, a Guardian assigning the Steward role signs a delegation that authorizes the Steward's pubkey to publish specific event kinds (group operations, payments, etc.) on the Guardian's behalf, until a specified expiry.

### Delegation Event Structure

A Guardian delegating Steward authority to pubkey `P`:

```json
{
  "kind": 1,
  "pubkey": "<guardian_pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["delegation",
     "<steward_pubkey>",
     "kind=1&kind=4&kind=9735&kind=27235&kind=39200&created_at<1735689600",
     "<guardian_sig_over_conditions>"]
  ],
  "content": "NIP-26 delegation: steward role granted to <steward_npub>"
}
```

The `conditions` string specifies:
- `kind=1&kind=4&...` — which event kinds the Steward can sign
- `created_at<1735689600` — expiry timestamp (Unix seconds)

---

## Role Capability Matrix

The full set of capabilities for each role:

| Capability | Guardian | Steward | Adult | Offspring |
|---|---|---|---|---|
| Create group | ✓ | — | — | — |
| Add/remove members | ✓ | ✓ (up to Adult) | — | — |
| Sign NIP-26 delegation | ✓ | ✓ (for Adult/Offspring only) | — | — |
| Modify spending policy | ✓ | ✓ (within Guardian-set limits) | — | — |
| Spend (Lightning) | ✓ | ✓ | ✓ (within policy) | Requires approval |
| Spend (Cashu) | ✓ | ✓ | ✓ (within policy) | Requires approval |
| Create agent (NIP-SA) | ✓ | ✓ | ✓ (within span of control) | — |
| Submit DVM job (NIP-90) | ✓ | ✓ | ✓ | Requires approval |
| Receive DVM job (provider) | ✓ | ✓ | ✓ | — |
| Publish NIP-CA attestation | ✓ | — | — | — |
| Revoke NIP-CA attestation | ✓ | — | — | — |
| Register skill (NIP-SKL) | ✓ | ✓ | ✓ | — |
| Initiate FROST key ceremony | ✓ | — | — | — |
| Participate in FROST ceremony | ✓ | ✓ | — | — |
| NFC Proof of Life ceremony | ✓ | ✓ | ✓ | ✓ (requires Guardian co-sign) |
| Export vault backup | ✓ | ✓ | ✓ | — |

---

## Assigning Roles via NIP-26 Delegation

### Assigning Steward

Only the Guardian can assign the Steward role.

1. Navigate to **Groups → [Your Group] → Members**.
2. Click **Invite Steward**.
3. Enter the new Steward's `npub` or NIP-05 name.
4. Set the delegation expiry date (when the Steward role expires and must be re-issued).
5. Click **Issue Delegation**.

Satnam constructs the NIP-26 delegation event with the Steward-level kind list and your specified expiry. You sign it with your Guardian nsec (via the unlocked vault). The event is published to Pylon via CEPS.

### Assigning Adult

The Guardian or any Steward can assign the Adult role.

1. Navigate to **Groups → [Your Group] → Members → Add Member**.
2. Enter the member's `npub`.
3. Select role: **Adult**.
4. Set expiry.
5. Click **Issue Delegation**.

### Assigning Offspring

The Guardian or any Steward can assign the Offspring role.

Same flow as Adult, but select role: **Offspring**.

---

## Delegation Expiry

Every delegation has an expiry timestamp embedded in the conditions string (`created_at<{unix_timestamp}`). When the expiry passes:

- The delegation is no longer valid for server-side NIP-98 verification.
- The member's capabilities are effectively suspended until the delegation is re-issued.
- The expired delegation event remains on the relay — Satnam's delegation graph marks it as expired.

### Expiry Alerts

Satnam monitors delegation expiries and shows alerts:
- **7 days before expiry:** Yellow warning in the group member list
- **1 day before expiry:** Red warning
- **On expiry:** Member status changes to "Suspended" in the group view

### Renewing a Delegation

To renew an expiring delegation:
1. Navigate to **Groups → [Your Group] → Members**.
2. Find the member with the expiring delegation.
3. Click **Renew Delegation**.
4. Set the new expiry date.
5. Sign and publish the updated delegation event.

> **Note:** Renewing issues a new delegation event. The old expired event remains on the relay but is superseded by the new one (Satnam's graph picks the most recent valid delegation).

---

## Revoking a Delegation

To immediately revoke a member's authority:

1. Navigate to **Groups → [Your Group] → Members**.
2. Find the member to revoke.
3. Click **Revoke Delegation**.
4. Confirm the revocation.

Satnam publishes a NIP-26 revocation event (a delegation event with `created_at<{now}`, effectively setting expiry to the past). CEPS distributes this to all configured relays.

> **Warning:** Revocation depends on relay propagation. If a member is operating offline or on a relay that has not received the revocation, they may continue acting with their old delegation for a brief window. For critical revocations, contact the member directly.

---

## Viewing the Delegation Graph

The delegation graph gives you a visual overview of all active delegations in the group.

1. Navigate to **Groups → [Your Group] → Delegation Graph**.
2. The graph shows:
   - Guardian at the root
   - Stewards connected directly to the Guardian
   - Adults/Offspring connected to their delegating Steward or Guardian
   - Agents nested under their creating Principal
   - Color coding: green (active), yellow (expiring soon), red (expired)

The delegation graph is also accessible from the **DelegationHealthPanel** in the agent monitoring dashboard.

---

## How Delegation Is Verified Server-Side

When a member makes an authenticated request to a Satnam serverless function, verification works as follows:

1. The `Authorization` header contains a NIP-98 event signed by the member's nsec.
2. If the event includes a NIP-26 `delegation` tag, the function:
   a. Extracts the delegator pubkey (the Guardian or Steward who issued the delegation)
   b. Verifies the delegation signature using secp256k1 Schnorr
   c. Verifies the current event's kind and timestamp satisfy the delegation conditions
3. The authenticated identity is the *delegator*, acting through the *delegate*.
4. For role-gated operations, the function checks the delegator's role level.

This means role checks happen at the cryptographic level — not against a database table. The delegation chain is self-contained in the event.

---

## Related Pages

- [Group Overview](./README.md) — Role hierarchy and trust estate framing
- [Creating a Group](./creating-a-group.md) — DKG ceremony and initial setup
- [Agents: Creating an Agent](../agents/creating-an-agent.md) — Agent delegation within a group
- [NIP-26 in the Glossary](../../overview/glossary.md#n) — Protocol definition
