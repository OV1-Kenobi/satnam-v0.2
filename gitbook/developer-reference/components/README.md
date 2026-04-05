# Components Overview

Satnam v2 has **52 React components** organized by domain. All components are pure presentational-plus-hook consumers — they do not perform cryptographic operations directly or access the vault. All state comes from hooks.

---

## Component Tree by Domain

### Groups (3 components)

```
GroupsPage
├── GroupCreateFlow         — Multi-step wizard: name → threshold → participants → DKG ceremony
├── GroupMemberList         — Displays participants with roles; role-gated action buttons
└── RoleAssignment          — Issue NIP-26 delegation to assign Steward/Adult/Offspring roles
```

| Component | File | Description |
|---|---|---|
| `GroupCreateFlow` | `src/components/groups/GroupCreateFlow.tsx` | Guardian-only. Steps: group name → threshold config → participant pubkeys → DKG ceremony status → completion |
| `GroupMemberList` | `src/components/groups/GroupMemberList.tsx` | Lists group members with avatars, roles, and last-seen status |
| `RoleAssignment` | `src/components/groups/RoleAssignment.tsx` | Form to issue or revoke a NIP-26 delegation event |

---

### Wallet (6 components)

```
WalletPage
├── WalletDashboard         — Balance display, recent transactions, quick actions
├── SendPayment             — BOLT-11 input, amount confirmation, payment status
├── ReceivePayment          — Generate invoice, display QR code, monitor payment
├── TransactionList         — Paginated history with filter by type/date
├── NWCModal                — NWC URI connection setup dialog
└── NWCWalletSetupModal     — First-run wallet connection guide
```

| Component | File | Description |
|---|---|---|
| `WalletDashboard` | `src/components/wallet/WalletDashboard.tsx` | Balance in sats (orange), 3 quick-action buttons, recent tx list |
| `SendPayment` | `src/components/wallet/SendPayment.tsx` | Paste/scan BOLT-11, confirm amount, call `nwc.payInvoice()` |
| `ReceivePayment` | `src/components/wallet/ReceivePayment.tsx` | Amount input, `nwc.makeInvoice()`, QR display, polling for payment |
| `TransactionList` | `src/components/wallet/TransactionList.tsx` | Virtualized list with `TxListOptions` filters |
| `NWCModal` | `src/components/wallet/NWCModal.tsx` | Add/remove NWC connection, set default |
| `NWCWalletSetupModal` | `src/components/wallet/NWCWalletSetupModal.tsx` | Onboarding: explains NWC, links to Alby Hub |

---

### NFC (3 components)

```
NfcTapHandler               — Continuous Web NFC scan; iOS Universal Link handler
├── PinEntry                — 4–8 digit PIN pad with lockout countdown
└── ProofOfLifeFlow         — Mutual ceremony UI: scan peer → await reciprocal → PIN exchange → attest → publish → confirm
```

| Component | File | Description |
|---|---|---|
| `NfcTapHandler` | `src/components/nfc/NfcTapHandler.tsx` | Manages NFC reader lifecycle; calls `nfc.processTap()` |
| `PinEntry` | `src/components/nfc/PinEntry.tsx` | Masked PIN input, shows lockout timer if locked |
| `ProofOfLifeFlow` | `src/components/nfc/ProofOfLifeFlow.tsx` | Full mutual Proof of Life ceremony with 10-state progress indicator: IDLE → INITIATED → SCANNING_PEER → PEER_VERIFIED → AWAITING_RECIPROCAL → MUTUAL_VERIFIED → WELCOME_SENT → ATTESTING → PUBLISHED → CONFIRMED |

---

### Agents (5 components)

```
AgentsPage
├── AgentCreateFlow         — Multi-step: name/capabilities → wallet policy → skills → confirm
├── AgentCard               — Summary card: name, pubkey, autonomy level, balance, status
├── AgentDetailPanel        — Full agent detail: profile, state, schedule, active sessions
├── SpendPolicyEditor       — Form controls for AgentWalletPolicy fields
└── AgentMonitoringPanel    — Real-time: heartbeat status, active task, resource usage
```

| Component | File | Description |
|---|---|---|
| `AgentCreateFlow` | `src/components/agents/AgentCreateFlow.tsx` | Calls `agentProfile.createAgent()`, shows Nostr event ID on success |
| `AgentCard` | `src/components/agents/AgentCard.tsx` | Compact card with status badge (idle/working/paused/error) |
| `AgentDetailPanel` | `src/components/agents/AgentDetailPanel.tsx` | Full detail view; pulls kind:39201 state events |
| `SpendPolicyEditor` | `src/components/agents/SpendPolicyEditor.tsx` | Guardian-only. Calls `agentProfile.updateWalletPolicy()` |
| `AgentMonitoringPanel` | `src/components/agents/AgentMonitoringPanel.tsx` | Polls bridge heartbeat; shows compute load, task queue |

---

### Skills (3 components)

```
AgentDetailPanel (or SkillsTab)
├── SkillRegistrationForm   — Register NIP-SKL kind:33400 manifest
├── SkillCard               — Summary: name, version, attestation tier
└── SkillAttestationPanel   — Issue/view NIP-32 label attestations
```

---

### Marketplace (5 components)

```
MarketplacePage
├── ProviderCard            — DVM provider: name, supported kinds, price, reputation
├── JobSubmitForm           — Input, parameters, bid, submit kind:5xxx
├── JobResultDisplay        — Rendered result content, pay button
├── ActiveJobsList          — Pending/processing/completed jobs with status badges
└── CreditEnvelopePanel     — NIP-AC lifecycle: intent → offer → envelope → settlement
```

---

### Probe (4 components)

```
AgentDetailPanel (Probe tab)
├── ProbeSessionPanel       — Session list, subscribe controls
├── ToolCallApproval        — Approve/Reject/Modify modal for pending tool calls
├── SessionDiffRenderer     — Syntax-highlighted file diffs with line numbers
└── ExecutionResultPanel    — Stdout/stderr, file change summary, test results
```

---

### Circle of Trust (6 components)

```
CircleOfTrustPage
├── TrustOverviewPanel         — Concentric ring visualization; stats bar
├── ContactTrustCard           — Per-contact trust display with score gauge and ledger preview
├── HandshakeLedger            — Encrypted timeline of meetings, messages, payments, attestations
├── IdentityTrustPanel         — Your trust profile as others see it
├── FinancialTrustPanel        — Payment history, credit envelope settlement, Sig4Sats bonds
└── SkillsTrustPanel           — Skills attested by PoL-verified contacts
```

| Component | File | Description |
|---|---|---|
| `TrustOverviewPanel` | `src/components/circle-of-trust/TrustOverviewPanel.tsx` | Concentric ring visualization (inner: high trust ≥70, middle: medium 30–69, outer: new <30) with total-contacts/avg-score/total-meetings stats bar |
| `ContactTrustCard` | `src/components/circle-of-trust/ContactTrustCard.tsx` | Contact name/npub/NIP-05, trust score gauge (colored arc 0–100), meeting count + dates, 4-factor breakdown bars, handshake ledger preview, quick actions |
| `HandshakeLedger` | `src/components/circle-of-trust/HandshakeLedger.tsx` | Chronological timeline with block-height markers, "Verified Handshake" badges for PoL meetings, exportable proof option |
| `IdentityTrustPanel` | `src/components/circle-of-trust/IdentityTrustPanel.tsx` | Verification count, trust chain depth, skill attestations from trusted contacts, financial reputation |
| `FinancialTrustPanel` | `src/components/circle-of-trust/FinancialTrustPanel.tsx` | Payment history with contacts, credit envelope settlement rate, reputation deltas, Sig4Sats bond history |
| `SkillsTrustPanel` | `src/components/circle-of-trust/SkillsTrustPanel.tsx` | Skills attested by PoL-verified contacts, attestation tier breakdown, skill growth over time |

---

### Note to Self (2 components)

```
NoteToSelfPanel
└── NoteToSelfComposer         — Compose and send an encrypted self-note
```

| Component | File | Description |
|---|---|---|
| `NoteToSelfPanel` | `src/components/note-to-self/NoteToSelfPanel.tsx` | Markdown-capable compose area, reverse-chronological notes list, category/tag filter, search |
| `NoteToSelfComposer` | `src/components/note-to-self/NoteToSelfComposer.tsx` | Text input, category selector, tag input, save button — calls `useNoteToSelf().sendNote()` |

---

### Calls (3 components)

```
CallInitiator               — Voice/video call button on contact profiles
IncomingCallOverlay         — Incoming call notification with accept/reject
ActiveCallPanel             — Active call UI: video feeds, controls, duration timer
```

| Component | File | Description |
|---|---|---|
| `CallInitiator` | `src/components/calls/CallInitiator.tsx` | Voice/video toggle buttons on contact profile; calls `useCalls().initiateCall()` |
| `IncomingCallOverlay` | `src/components/calls/IncomingCallOverlay.tsx` | Full-screen overlay: caller info, accept (green) / decline (red) buttons; calls `answerCall()` or `declineCall()` |
| `ActiveCallPanel` | `src/components/calls/ActiveCallPanel.tsx` | Video feeds (remote full-screen, local inset), mute/video-toggle/end-call controls, duration timer |

---

### Dashboards (4 components)

```
HomePage
├── DelegationHealthPanel   — Active delegations expiry, flagged gaps in chain
├── PerformanceReportPanel  — Agent reputation scores, settlement success rate
├── SessionManagerPanel     — All active Probe sessions across agents
└── SystemStatusPanel       — Pylon connection, vault lock status, feature flags
```

---

### Errors (2 components)

```
App root
├── ErrorBoundary           — React error boundary with "reload" action
└── OfflineBanner           — Shown when Pylon WebSocket is disconnected
```

---

## Design System Summary

### Color Palette

| Token | Value | Usage |
|---|---|---|
| `bitcoin-orange` | `#f7931a` | Primary accent — balances, amounts, CTAs |
| `zinc-950` | `#09090b` | App background |
| `zinc-900` | `#18181b` | Card backgrounds |
| `zinc-800` | `#27272a` | Borders, dividers |
| `zinc-400` | `#a1a1aa` | Secondary text |
| `white` | `#ffffff` | Primary text |
| `green-500` | `#22c55e` | Success states, incoming payments |
| `red-500` | `#ef4444` | Errors, outgoing payments, failed states |

### Typography

| Use | Font | Class |
|---|---|---|
| Display headings | Cinzel (self-hosted, invariant S7) | `font-cinzel` |
| UI text | System sans-serif stack | `font-sans` |
| Amounts | Monospace | `font-mono` |
| Code blocks | Monospace | `font-mono` |

### Shared Patterns

**Cards:**
```tsx
<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
  {/* content */}
</div>
```

**Primary button (Bitcoin orange):**
```tsx
<button className="bg-bitcoin-orange hover:bg-bitcoin-orange/90 text-black font-semibold px-4 py-2 rounded-md">
  {label}
</button>
```

**Status badges:**
```tsx
// Status badge colors by type
const statusColors = {
  active:    'bg-green-900 text-green-300',
  idle:      'bg-zinc-800 text-zinc-400',
  working:   'bg-blue-900 text-blue-300',
  paused:    'bg-yellow-900 text-yellow-300',
  error:     'bg-red-900 text-red-300',
  completed: 'bg-green-900 text-green-300',
  failed:    'bg-red-900 text-red-300',
} as const;

function StatusBadge({ status }: { status: keyof typeof statusColors }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[status]}`}>
      {status}
    </span>
  );
}
```

**Loading spinner:**
```tsx
<div className="animate-spin h-4 w-4 border-2 border-bitcoin-orange border-t-transparent rounded-full" />
```

**Sats amount display:**
```tsx
function SatsAmount({ msats }: { msats: bigint }) {
  const sats = msats / 1000n;
  return (
    <span className="font-mono text-bitcoin-orange">
      {sats.toLocaleString()} <span className="text-zinc-400 text-sm">sats</span>
    </span>
  );
}
```

---

## Common Import Paths

```typescript
// Components
import { WalletDashboard } from '@components/wallet/WalletDashboard';
import { AgentCard } from '@components/agents/AgentCard';
import { ToolCallApproval } from '@components/probe/ToolCallApproval';
import { ErrorBoundary } from '@components/errors/ErrorBoundary';

// Hooks used within components
import { useVault } from '@hooks/useVault';
import { useNwc } from '@hooks/useNwc';
import { useProbeSession } from '@hooks/useProbeSession';

// Utilities
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Shared class helper
export function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(...inputs));
}
```
