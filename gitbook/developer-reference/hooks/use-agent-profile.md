# useAgentProfile

**File:** `src/hooks/useAgentProfile.ts`
**Provider:** `CepsProvider` (requires `VaultProvider`)

---

## Purpose

`useAgentProfile` creates, updates, and subscribes to NIP-SA agent profiles (kind:39200). It handles the full lifecycle: constructing the Nostr event, signing it with the agent's nsec from the OPFS Vault, and publishing via CEPS to Pylon.

---

## Return Value Shape

```typescript
interface UseAgentProfileReturn {
  // Current principal's agents
  agents: AgentProfile[];
  getAgent: (agentNpub: string) => AgentProfile | undefined;

  // CRUD
  createAgent: (request: CreateAgentRequest) => Promise<AgentProfile>;
  updateAgent: (agentNpub: string, updates: Partial<AgentProfileContent>) => Promise<AgentProfile>;
  updateWalletPolicy: (agentNpub: string, policy: Partial<AgentWalletPolicy>) => Promise<void>;
  deleteAgent: (agentNpub: string) => Promise<void>; // Publishes kind:5 delete

  // Queries
  fetchAgentByNpub: (npub: string) => Promise<AgentProfile | null>;

  // State
  loading: boolean;
  error: string | null;
}
```

---

## Key Types

```typescript
interface CreateAgentRequest {
  agentNsecHex: string;        // From OPFS Vault — zeroed after use
  governorPubkeyHex: string;
  groupPubkeyHex?: string;
  username: string;            // e.g. "my-agent" → NIP-05: my-agent@satnam.pub
  profileContent: AgentProfileContent;
  walletPolicy?: Partial<AgentWalletPolicy>;
  coordinationRelays?: string[];
  enabledSkillScopeIds?: string[];
}

interface AgentProfileContent {
  name: string;
  about: string;
  picture?: string;
  capabilities: AgentCapabilityKey[];
  autonomy_level: 'bounded' | 'supervised' | 'autonomous';
  version: string;
}

interface AgentWalletPolicy {
  max_single_spend_sats: number;           // Default: 1000
  daily_limit_sats: number;               // Default: 100000
  requires_approval_above_sats: number;   // Default: 10000
  preferred_spend_rail: 'lightning' | 'cashu' | 'auto'; // Default: 'auto'
  allowed_mints: string[];
  sweep_threshold_sats: number;           // Default: 50000
  sweep_destination: string | null;
  sweep_rail: 'lightning' | 'cashu';
}
```

---

## Published Event Structure

`createAgent` publishes a kind:39200 event:

```json
{
  "kind": 39200,
  "pubkey": "<agentPubkeyHex>",
  "created_at": 1700000000,
  "tags": [
    ["d", "profile"],
    ["operator", "<governorPubkeyHex>"],
    ["signer", "<groupPubkeyHex>"],
    ["lud16", "my-agent@satnam.pub"],
    ["nip05", "my-agent@satnam.pub"],
    ["enabled_skills", "<skill_scope_id>"],
    ["wallet_policy", "{\"max_single_spend_sats\":1000,\"daily_limit_sats\":100000}"],
    ["coordination_relay", "wss://pylon.openagents.com"]
  ],
  "content": "{\"name\":\"ResearchBot\",\"about\":\"Researches market data\",\"capabilities\":[\"research\"],\"autonomy_level\":\"bounded\",\"version\":\"2.0.0\"}"
}
```

---

## Example Usage in a Component

### Agent Creation Form

```tsx
import { useAgentProfile } from '@hooks/useAgentProfile';
import { useVault } from '@hooks/useVault';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

function AgentCreateFlow() {
  const agentProfile = useAgentProfile();
  const vault = useVault();
  const [form, setForm] = useState({
    username: '',
    name: '',
    about: '',
    autonomy: 'bounded' as const,
  });

  async function handleCreate() {
    // 1. Generate agent keypair
    const nsec = generateSecretKey();
    const npub = getPublicKey(nsec);
    const nsecHex = bytesToHex(nsec);

    // 2. Store agent nsec in vault
    await vault.storeAgentNsec(npub, nsec);
    nsec.fill(0); // Zero from heap immediately

    // 3. Create agent profile
    const agent = await agentProfile.createAgent({
      agentNsecHex: nsecHex, // Hook zeroes after signing
      governorPubkeyHex: myPubkey,
      username: form.username,
      profileContent: {
        name: form.name,
        about: form.about,
        capabilities: ['research', 'summarization'],
        autonomy_level: form.autonomy,
        version: '2.0.0',
      },
      walletPolicy: {
        max_single_spend_sats: 500,
        daily_limit_sats: 10000,
      },
    });

    console.log('Agent created:', agent.pubkey);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
      <input
        value={form.username}
        onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))}
        placeholder="Username (e.g. my-agent)"
      />
      <input
        value={form.name}
        onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Display name"
      />
      <textarea
        value={form.about}
        onChange={(e) => setForm(f => ({ ...f, about: e.target.value }))}
        placeholder="Agent description"
      />
      <button type="submit" disabled={agentProfile.loading}>
        Create Agent
      </button>
    </form>
  );
}
```

### Spend Policy Editor

```tsx
import { useAgentProfile } from '@hooks/useAgentProfile';

function SpendPolicyEditor({ agentNpub }: { agentNpub: string }) {
  const { getAgent, updateWalletPolicy, loading } = useAgentProfile();
  const agent = getAgent(agentNpub);

  if (!agent) return null;

  async function handleUpdate(newPolicy: Partial<AgentWalletPolicy>) {
    await updateWalletPolicy(agentNpub, newPolicy);
  }

  return (
    <div>
      <h3>Spend Policy</h3>
      <label>
        Max single spend (sats):
        <input
          type="number"
          defaultValue={agent.walletPolicy.max_single_spend_sats}
          onBlur={(e) =>
            handleUpdate({ max_single_spend_sats: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Daily limit (sats):
        <input
          type="number"
          defaultValue={agent.walletPolicy.daily_limit_sats}
          onBlur={(e) =>
            handleUpdate({ daily_limit_sats: Number(e.target.value) })
          }
        />
      </label>
    </div>
  );
}
```

---

## Related Hooks

- [`useVault`](./use-vault.md) — agent nsec stored in vault
- [`useDelegation`](./use-delegation.md) — role-gated (Adult+ can create agents)
- [`useMarketplace`](./use-marketplace.md) — agents participate in DVM marketplace
