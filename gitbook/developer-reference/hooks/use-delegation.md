# useDelegation

**File:** `src/hooks/useDelegation.ts`
**Provider:** `DelegationProvider` (requires `VaultProvider`, `CepsProvider`)

---

## Purpose

`useDelegation` provides access to the NIP-26 delegation graph — the RBAC layer in Satnam v2. It replaces database role tables entirely. Role assignments are NIP-26 delegation events stored on Nostr relays and cached locally.

---

## Return Value Shape

```typescript
interface UseDelegationReturn {
  // Role queries
  myRole: 'Guardian' | 'Steward' | 'Adult' | 'Offspring' | null;
  getRoleFor: (pubkey: string, groupPubkey: string) => Promise<Role | null>;
  canDo: (capability: Capability, groupPubkey: string) => Promise<boolean>;

  // Delegation events
  delegations: DelegationEvent[];
  getDelegationChain: (pubkey: string) => DelegationEvent[];

  // Issue delegation (Guardian/Steward only)
  issueDelegation: (params: {
    delegatePubkey: string;
    role: 'Steward' | 'Adult' | 'Offspring';
    allowedKinds: number[];
    expiresAt?: number;
    groupPubkey: string;
  }) => Promise<NostrEvent>;

  revokeDelegation: (delegationEventId: string) => Promise<void>;

  // Sync
  syncFromRelay: () => Promise<void>;

  // State
  loading: boolean;
  error: string | null;
}

type Role = 'Guardian' | 'Steward' | 'Adult' | 'Offspring';

type Capability =
  | 'createGroup'
  | 'addRemoveMembers'
  | 'signDelegation'
  | 'modifySpendPolicy'
  | 'spendLightning'
  | 'spendCashu'
  | 'createAgent'
  | 'submitDvmJob'
  | 'publishAttestation'
  | 'registerSkill'
  | 'initiateFrostCeremony'
  | 'participateFrostCeremony'
  | 'nfcProofOfLife'
  | 'exportVaultBackup';
```

---

## Role Hierarchy

```
Guardian (Trust Protector) — highest authority
  └── Steward (Trustee) — operational authority
        ├── Adult (Mature Beneficiary) — spending within policy
        └── Offspring (Immature Beneficiary) — restricted, needs approval
```

See specification §4.1 for the full capability matrix.

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `getRoleFor` | `pubkey`, `groupPubkey` | `Role \| null` | Traverse delegation chain to determine role |
| `canDo` | `capability`, `groupPubkey` | `boolean` | Check if current principal has a specific capability |
| `getDelegationChain` | `pubkey` | `DelegationEvent[]` | Return chain from pubkey to Guardian |
| `issueDelegation` | params | `NostrEvent` | Sign and publish NIP-26 delegation event |
| `revokeDelegation` | `delegationEventId` | `void` | Publish a revocation event (kind:5 delete) |
| `syncFromRelay` | — | `void` | Refresh delegation graph from Pylon |

---

## NIP-26 Delegation Event Structure

A Guardian delegating Steward authority:

```json
{
  "kind": 1,
  "pubkey": "<guardian_pubkey>",
  "created_at": 1700000000,
  "tags": [
    [
      "delegation",
      "<steward_pubkey>",
      "kind=1&kind=4&kind=9735&kind=27235&kind=39200&created_at<1735689600",
      "<guardian_sig_over_conditions>"
    ]
  ],
  "content": "NIP-26 delegation: Steward role granted"
}
```

The conditions string restricts which event kinds the delegate can sign and sets an expiry timestamp.

---

## Example Usage in a Component

### Role-Gated UI

```tsx
import { useDelegation } from '@hooks/useDelegation';

function GroupAdminActions({ groupPubkey }: { groupPubkey: string }) {
  const delegation = useDelegation();
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canInitiateFrost, setCanInitiateFrost] = useState(false);

  useEffect(() => {
    async function checkPermissions() {
      const [members, frost] = await Promise.all([
        delegation.canDo('addRemoveMembers', groupPubkey),
        delegation.canDo('initiateFrostCeremony', groupPubkey),
      ]);
      setCanManageMembers(members);
      setCanInitiateFrost(frost);
    }
    checkPermissions();
  }, [groupPubkey]);

  return (
    <div>
      {canManageMembers && (
        <button>Add/Remove Members</button>
      )}
      {canInitiateFrost && (
        <button>Start DKG Ceremony</button>
      )}
      <p>Your role: {delegation.myRole}</p>
    </div>
  );
}
```

### Issue a Delegation

```tsx
import { useDelegation } from '@hooks/useDelegation';

function AssignStewardForm({ groupPubkey }: { groupPubkey: string }) {
  const delegation = useDelegation();
  const [stewardPubkey, setStewardPubkey] = useState('');

  async function handleAssign() {
    const event = await delegation.issueDelegation({
      delegatePubkey: stewardPubkey,
      role: 'Steward',
      allowedKinds: [1, 4, 9735, 27235, 39200],
      expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600, // 1 year
      groupPubkey,
    });
    console.log('Delegation published:', event.id);
  }

  return (
    <div>
      <input
        value={stewardPubkey}
        onChange={(e) => setStewardPubkey(e.target.value)}
        placeholder="Steward pubkey (hex)"
      />
      <button onClick={handleAssign}>Assign Steward</button>
    </div>
  );
}
```

---

## Related Hooks

- [`useFrost`](./use-frost.md) — role-gated (Guardian only for DKG initiation)
- [`useAgentProfile`](./use-agent-profile.md) — agent creation requires delegation

## Related Libraries

- [Libraries overview](../libraries/README.md) — `nip26` module
