# Hooks Overview

Satnam v2 exposes **13 React hooks** that provide feature-level access to the underlying library modules. All hooks follow a consistent Provider → Hook → Component pattern and are safe for React Strict Mode.

---

## All Hooks

| Hook | File | One-Line Description |
|---|---|---|
| [`useVault`](./use-vault.md) | `src/hooks/useVault.ts` | Unlock, lock, and interact with the OPFS encrypted key vault |
| [`useFrost`](./use-frost.md) | `src/hooks/useFrost.ts` | Run FROST DKG ceremonies and group signing sessions |
| [`useNwc`](./use-nwc.md) | `src/hooks/useNwc.ts` | Manage NWC wallet connections and execute Lightning payments |
| [`useCashu`](./use-cashu.md) | `src/hooks/useCashu.ts` | Mint, melt, send, and receive Cashu eCash tokens |
| [`useDelegation`](./use-delegation.md) | `src/hooks/useDelegation.ts` | Traverse the NIP-26 delegation graph and verify role permissions |
| [`useNfc`](./use-nfc.md) | `src/hooks/useNfc.ts` | Handle NFC card taps, CMAC verification, and Proof of Life ceremonies |
| [`useAgentProfile`](./use-agent-profile.md) | `src/hooks/useAgentProfile.ts` | Create, update, and subscribe to NIP-SA agent profiles (kind:39200) |
| [`useCreditLifecycle`](./use-credit-lifecycle.md) | `src/hooks/useCreditLifecycle.ts` | Manage NIP-AC credit envelope state machine |
| [`useSkillManager`](./use-skill-manager.md) | `src/hooks/useSkillManager.ts` | Register skills (NIP-SKL kind:33400) and manage attestations |
| [`useMarketplace`](./use-marketplace.md) | `src/hooks/useMarketplace.ts` | Browse DVM providers, submit NIP-90 jobs, track results |
| [`useProbeSession`](./use-probe-session.md) | `src/hooks/useProbeSession.ts` | Subscribe to Probe trajectory events and submit tool approvals |
| [`usePylon`](./use-pylon.md) | `src/hooks/usePylon.ts` | Monitor Pylon relay connection status and authentication |
| [`useSpacetimeBridge`](./use-spacetime-bridge.md) | `src/hooks/useSpacetimeBridge.ts` | SpacetimeDB bridge presence heartbeats and compute assignments |

---

## Usage Pattern: Provider → Hook → Component

All stateful hooks are backed by React Context providers. The provider instantiates the underlying library module once and exposes it to the component tree. This prevents duplicate WebSocket connections and vault handles.

### Provider Setup (App Root)

```tsx
// src/App.tsx
import { VaultProvider } from '@providers/VaultProvider';
import { FrostProvider } from '@providers/FrostProvider';
import { NwcProvider } from '@providers/NwcProvider';
import { CashuProvider } from '@providers/CashuProvider';
import { CepsProvider } from '@providers/CepsProvider';

export function App() {
  return (
    <VaultProvider>
      <CepsProvider>
        <FrostProvider>
          <NwcProvider>
            <CashuProvider>
              <RouterProvider router={router} />
            </CashuProvider>
          </NwcProvider>
        </FrostProvider>
      </CepsProvider>
    </VaultProvider>
  );
}
```

### Hook Usage in Components

```tsx
import { useVault } from '@hooks/useVault';
import { useNwc } from '@hooks/useNwc';

function PaymentButton({ invoice }: { invoice: string }) {
  const vault = useVault();
  const nwc = useNwc();

  if (!vault.isUnlocked) {
    return <button onClick={vault.promptUnlock}>Unlock Vault to Pay</button>;
  }

  return (
    <button onClick={() => nwc.payInvoice(invoice)}>
      Pay Invoice
    </button>
  );
}
```

---

## Hook Conventions

All hooks follow these conventions:

**Naming:** `use{Feature}` — singular, camelCase.

**Return shape:** Each hook returns an object (not a tuple) with named fields:
```typescript
const { isUnlocked, storeNsec, getNsec, lock, unlock } = useVault();
const { payInvoice, getBalance, connections, defaultConnection } = useNwc();
```

**Loading states:** Async operations expose a `loading` boolean and `error` value:
```typescript
const { mintTokens, loading, error } = useCashu();
```

**Error handling:** Errors use the typed discriminant enums from `@lib/errors`:
```typescript
import { VaultError } from '@lib/vault/types';
// hook.error?.message === VaultError.VaultLocked
```

**Effect cleanup:** All subscriptions are cleaned up in `useEffect` return functions. Hooks that open WebSocket connections close them on unmount.

**Strict mode safety:** All hooks are safe for React 18 Strict Mode (no double-effect side effects).

---

## Provider Dependency Order

Providers have an implied initialization order. `VaultProvider` must be outermost because other providers (FROST, NWC, Cashu) read key material from the vault.

```
VaultProvider           ← outermost — all others depend on vault
  └── CepsProvider      ← second — FROST, agents, probe use CEPS
        └── FrostProvider
        └── NwcProvider
        └── CashuProvider
        └── DelegationProvider
```

---

## Hook Pages

- [useVault](./use-vault.md)
- [useFrost](./use-frost.md)
- [useNwc](./use-nwc.md)
- [useCashu](./use-cashu.md)
- [useDelegation](./use-delegation.md)
- [useNfc](./use-nfc.md)
- [useAgentProfile](./use-agent-profile.md)
- [useMarketplace](./use-marketplace.md)
- [useProbeSession](./use-probe-session.md)
