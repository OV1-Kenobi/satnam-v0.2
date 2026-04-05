# NIP-26: Delegation

NIP-26 delegation events replace the database Role-Based Access Control (RBAC) system entirely. In v2, there is no `family_members` table, no `signing_permissions` table, and no `admin_hierarchy` table. Roles are cryptographically enforced through signed Nostr delegation events.

---

## How NIP-26 Replaces Database RBAC

| Concern | Database RBAC | NIP-26 Delegation |
|---|---|---|
| Role storage | `family_members.role` column in Supabase | Signed `kind:1` Nostr event on relay |
| Role proof | JWT claim or DB lookup | Cryptographic Schnorr signature over conditions |
| Role revocation | `DELETE` row or `UPDATE role` | Publish new delegation with past `created_at` expiry |
| Offline operation | Requires DB connection | Delegation events cached locally in IndexedDB |
| Audit trail | DB logs (mutable) | Nostr events (immutable, timestamped) |
| Scope constraints | Custom middleware | Conditions string: `kind=1&kind=27235&created_at<1735689600` |

---

## Delegation Event Structure

A NIP-26 delegation event is a standard `kind:1` Nostr event signed by the delegator, containing a `delegation` tag:

```json
{
  "kind": 1,
  "pubkey": "<guardian_pubkey_hex>",
  "created_at": 1700000000,
  "tags": [
    [
      "delegation",
      "<delegate_pubkey_hex>",
      "kind=1&kind=4&kind=9735&kind=27235&kind=39200&created_at<1735689600",
      "<guardian_schnorr_sig_over_sha256_of_conditions>"
    ]
  ],
  "content": "NIP-26 delegation: steward role granted to npub1...",
  "sig": "<guardian_sig_over_event>"
}
```

The `delegation` tag has four elements:

| Index | Field | Description |
|---|---|---|
| 0 | `"delegation"` | Tag name (literal) |
| 1 | Delegate pubkey | Hex pubkey of the entity receiving delegated authority |
| 2 | Conditions string | Comma-separated constraints on the delegation |
| 3 | Delegation signature | `schnorr.sign(sha256("nostr:delegation:" + delegate_pubkey + ":" + conditions), delegator_nsec)` |

---

## Conditions String Format

The conditions string constrains what the delegate can do on behalf of the delegator:

```
kind=27235&kind=39200&created_at<1735689600
```

| Condition | Format | Meaning |
|---|---|---|
| Kind allowlist | `kind=<number>` | Delegate may sign events of this kind |
| Expiry | `created_at<<unix_timestamp>` | Delegation expires at this timestamp |
| Not-before | `created_at><unix_timestamp>` | Delegation valid only after this time |

Multiple conditions are joined with `&`. All conditions must be satisfied for the delegation to be valid.

**Example conditions by role:**

| Role | Conditions String |
|---|---|
| Steward | `kind=1&kind=4&kind=9735&kind=27235&kind=39200&created_at<1735689600` |
| Adult | `kind=1&kind=9735&kind=39200&kind=5000&created_at<1735689600` |
| Offspring | `kind=1&created_at<1735689600` (limited to notes only, no payment or agent kinds) |

---

## Delegation Verification Flow

When a Netlify function receives a NIP-98 auth event that includes a NIP-26 `delegation` tag:

1. **Extract delegation components** from the `delegation` tag array
2. **Reconstruct the delegation token**: `"nostr:delegation:" + delegate_pubkey + ":" + conditions`
3. **Hash**: `sha256(delegation_token)` → 32 bytes
4. **Verify the delegation signature** using `schnorr.verify(delegation_sig, hash, delegator_pubkey)`
5. **Parse conditions string** and verify:
   - The event kind is in the allowlisted kinds
   - The event `created_at` satisfies all timestamp constraints
6. **Return the delegator pubkey** as the authenticated identity (not the signer's pubkey)

The authenticated identity for authorization purposes is the **delegator**, not the signer. A Steward signing with a Guardian's delegation has Guardian-level authority for the specific kinds in the conditions string.

---

## The DelegationGraph Class

The client maintains a local delegation graph, synced from Pylon and cached in encrypted IndexedDB:

```typescript
interface DelegationGraph {
  // Returns the chain of delegation from a pubkey back to a Guardian
  getChain(pubkey: string): DelegationEvent[];

  // Returns all active delegations issued by a pubkey
  getDelegationsFrom(pubkey: string): DelegationEvent[];

  // Checks if a pubkey has authority to perform an action at a given timestamp
  verifyChainAt(pubkey: string, timestamp: number): boolean;

  // Refreshes the delegation graph from relay
  syncFromRelay(relay: WebSocket): Promise<void>;

  // Revokes all delegations from a given pubkey
  revokeAll(delegatorPubkey: string): Promise<void>;
}
```

**Usage example** — verifying that a pubkey has Steward-level authority:

```typescript
const graph = useDelegation();

// Check if a pubkey can sign kind:39200 events at the current time
const canCreateAgent = graph.verifyChainAt(
  candidatePubkey,
  Math.floor(Date.now() / 1000)
);

// Get the full authority chain
const chain = graph.getChain(candidatePubkey);
// chain[0] = direct delegation event
// chain[chain.length - 1] = root Guardian delegation
```

---

## Role Capability Matrix

The four roles in Satnam v2 with their complete capability set:

| Capability | Guardian | Steward | Adult | Offspring |
|---|---|---|---|---|
| Create group | Yes | No | No | No |
| Add/remove members | Yes | Yes (≤Adult rank) | No | No |
| Sign NIP-26 delegation | Yes | Yes (Adult/Offspring only) | No | No |
| Modify spending policy | Yes | Yes (within Guardian limits) | No | No |
| Spend (Lightning) | Yes | Yes | Yes (within policy) | Requires approval |
| Spend (Cashu) | Yes | Yes | Yes (within policy) | Requires approval |
| Create agent (NIP-SA) | Yes | Yes | Yes (within span) | No |
| Submit DVM job (NIP-90) | Yes | Yes | Yes | Requires approval |
| Receive DVM job (provider) | Yes | Yes | Yes | No |
| Publish NIP-CA attestation | Yes | No | No | No |
| Revoke NIP-CA attestation | Yes | No | No | No |
| Register skill (NIP-SKL) | Yes | Yes | Yes | No |
| Initiate FROST key ceremony | Yes | No | No | No |
| Participate in FROST ceremony | Yes | Yes | No | No |
| NFC Proof of Life ceremony | Yes | Yes | Yes | Yes (Guardian co-sign required) |
| Export vault backup | Yes | Yes | Yes | No |

---

## Chain Verification

For multi-hop delegation chains (e.g., Offspring delegated by Adult delegated by Steward delegated by Guardian), each link in the chain is verified independently:

```
Guardian
  └── delegates to Steward (link A — signed by Guardian)
        └── delegates to Adult (link B — signed by Steward, within Guardian's bounds)
              └── delegates to Offspring (link C — signed by Adult, within Steward's bounds)
```

Chain verification rules:
1. Each link must have a valid Schnorr signature from the delegator
2. Each link's conditions must be a **subset** of the delegator's conditions — a Steward cannot grant more authority than the Guardian granted to them
3. All expiry timestamps must be satisfied at the time of verification
4. The root delegator must be a known Guardian (resolved from the group's `kind:39200` profile `operator` tag)

If any link in the chain fails, the entire chain is rejected. There are no partial delegations.

---

## Delegation Event Publication

Delegation events are published to:
1. **Pylon relay** (primary — authenticated via NIP-42 AUTH)
2. **Two public relays** (outbox model — for redundancy)

They are cached locally in encrypted IndexedDB (same master key as OPFS Vault) so the delegation graph is available offline. When connectivity is restored, the graph is synced against the relay to catch any revocations.

**Revocation** is accomplished by publishing a `kind:5` deletion request for the original delegation event, and by issuing a new delegation event with an `created_at<` expiry set in the past. Clients check both deletion requests and expiry conditions.
