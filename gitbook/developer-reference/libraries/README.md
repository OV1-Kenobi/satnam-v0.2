# Libraries Overview

Satnam v2 is organized into **20 focused library modules** under `src/lib/`. Each module has a single responsibility, communicates through typed interfaces, and enforces strict trust-boundary rules. No module imports from application layers above it (pages, hooks, components).

---

## Module Map

| Module | Path | Responsibility |
|---|---|---|
| `vault` | `src/lib/vault/` | OPFS encrypted key storage — root of all key custody |
| `nip98` | `src/lib/nip98/` | NIP-98 HTTP authentication event construction and verification |
| `nip26` | `src/lib/nip26/` | NIP-26 delegation event construction, verification, and graph traversal |
| `frost` | `src/lib/frost/` | FROST threshold signing via `@frostr/bifrost` — DKG and group signing |
| `nwc` | `src/lib/nwc/` | NWC (NIP-47) connection manager — Lightning payments |
| `cashu` | `src/lib/cashu/` | Cashu eCash client — mint management, token operations |
| `nfc` | `src/lib/nfc/` | NTAG424 CMAC verification, PIN gate, Proof of Life state machine |
| `nip-sa` | `src/lib/nip-sa/` | NIP-SA Sovereign Agents — kinds 39200–39231 |
| `nip-ac` | `src/lib/nip-ac/` | NIP-AC Agent Credit — kinds 39240–39245 |
| `nip-skl` | `src/lib/nip-skl/` | NIP-SKL Skill Registry — kinds 33400–33401 |
| `nip90` | `src/lib/nip90/` | NIP-90 DVM marketplace — job requests, results, feedback |
| `nip17` | `src/lib/nip17/` | NIP-17 gift-wrapped DM construction and parsing |
| `ceps` | `src/lib/ceps/` | Central Event Publishing Service — relay abstraction layer |
| `probe` | `src/lib/probe/` | Probe session protocol — trajectory events, tool approvals |
| `pylon` | `src/lib/pylon/` | Pylon NIP-42 AUTH relay client |
| `bridge` | `src/lib/bridge/` | SpacetimeDB bridge via Pylon relay events |
| `agent/delegation` | `src/lib/agent/delegation/` | NIP-26 delegation graph — role hierarchy enforcement |
| `agent/wallet` | `src/lib/agent/wallet/` | Agent spend policy enforcement and rail selection |
| `agent/session` | `src/lib/agent/session/` | Agent session lifecycle management |
| `errors` | `src/lib/errors/` | Typed error discriminants — no data payloads in errors |

---

## Import Conventions

All library modules are aliased in `tsconfig.json` and Vite config. Use the `@lib/*` path alias:

```typescript
// Library modules
import { VaultOps, VaultError } from '@lib/vault/types';
import { FrostClient } from '@lib/frost/client';
import { NwcConnectionManager } from '@lib/nwc/manager';
import { CashuClient } from '@lib/cashu/client';
import { verifyCmac } from '@lib/nfc/cmac';
import { CepsClient } from '@lib/ceps/client';
import { PylonClient } from '@lib/pylon/client';

// Config
import { getPylonRelay, isFrostEnabled } from '@config/env';

// Components
import { WalletDashboard } from '@components/wallet/WalletDashboard';

// Hooks
import { useVault } from '@hooks/useVault';
import { useFrost } from '@hooks/useFrost';

// Pages
import { WalletPage } from '@pages/WalletPage';
```

**Convention rules:**
- Library modules may only import from other library modules or `@lib/errors`.
- Library modules never import from `@hooks/*`, `@components/*`, or `@pages/*`.
- The `vault` module is the only module permitted to read from OPFS.
- The `ceps` module is the only module permitted to publish Nostr events directly to relays.

---

## Dependency Graph

The arrows below show `A → B` meaning "A imports from B". The vault module is at the root; all modules that touch key material depend on it.

```
┌──────────────────────────────────────────────────────────────────┐
│                         Application Layer                         │
│  Pages → Hooks → Libraries                                        │
└──────────────────────────────────────────────────────────────────┘

Hooks:
  useVault         → vault
  useFrost         → frost, vault
  useNwc           → nwc, vault
  useCashu         → cashu, vault
  useDelegation    → nip26, vault
  useNfc           → nfc, vault
  useAgentProfile  → nip-sa, ceps, vault
  useMarketplace   → nip90, nip-ac, nwc, cashu
  useProbeSession  → probe, pylon

Library modules (internal dependencies):
  frost        → vault (reads bfshare/bfprofile), ceps (publishes DKG events)
  nwc          → vault (reads NWC URI)
  cashu        → vault (reads/writes proofs)
  nfc          → vault (reads NFC AES keys)
  nip-sa       → ceps (publishes kind:39200), vault
  nip-ac       → ceps (publishes kinds 39240-39245)
  nip90        → ceps (publishes kinds 5xxx/7000), nwc, cashu
  nip17        → ceps
  ceps         → pylon, nip98 (builds auth events for relay AUTH)
  pylon        → nip98 (NIP-42 AUTH event construction)
  bridge       → pylon
  probe        → pylon
  agent/wallet → nwc, cashu, nip-ac
  agent/delegation → nip26, vault
  nip98        → (no lib deps — uses @noble/curves directly)
  nip26        → (no lib deps — uses @noble/curves directly)
  errors       → (no deps)
```

---

## Module Pages

- [Vault](./vault.md) — OPFS encrypted key storage
- [FROST](./frost.md) — Threshold signing ceremonies
- [NWC](./nwc.md) — Lightning payments via Nostr Wallet Connect
- [Cashu](./cashu.md) — eCash tokens and mint management
- [NFC](./nfc.md) — NTAG424 cards and PIN gate
- [CEPS + Pylon](./ceps.md) — Event publishing and authenticated relay
- [SpacetimeDB Bridge](./bridge.md) — Real-time coordination via Pylon
