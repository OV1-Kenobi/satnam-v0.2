# NIP-90: DVM Marketplace

NIP-90 defines the Data Vending Machine (DVM) protocol — a decentralized marketplace where consumers publish job requests and providers respond with results. Satnam v2 implements the full NIP-90 client stack, enabling Principals and Agents to buy compute from the OpenAgents Autopilot marketplace.

---

## Overview

A Data Vending Machine is a Nostr entity that accepts structured job requests (`kind:5xxx`), processes them, and returns results (`kind:6xxx`). Consumers subscribe to results and pay via Lightning or Cashu.

The Satnam DVM client handles:
- Constructing and signing job requests
- Subscribing to job results and feedback
- Provider discovery
- Payment execution via NWC
- Credit envelope lifecycle integration (NIP-AC)

---

## Job Request (kind:5xxx)

Job kinds are in the range 5000–5999. The specific kind indicates the job type (e.g., 5100 = text generation, 5200 = image generation, 5300 = data analysis).

**Construction:**

```typescript
interface DvmJobRequest {
  kind: number;          // 5000-5999 per NIP-90
  input: DvmInput[];     // Input data items
  params: DvmParam[];    // Job parameters
  bid_msats?: bigint;    // Maximum price willing to pay
  relays?: string[];     // Preferred result relays
  encryptTo?: string;    // Pubkey for NIP-44 encryption (privacy)
}

function constructJobRequest(request: DvmJobRequest): UnsignedEvent {
  const tags: string[][] = [];

  for (const input of request.input) {
    // Format: ["i", <data>, <type>, <relay?>]
    tags.push(['i', input.data, input.type, ...(input.relay ? [input.relay] : [])]);
  }

  for (const param of request.params) {
    // Format: ["param", <key>, <value>]
    tags.push(['param', param.key, param.value]);
  }

  if (request.bid_msats) {
    tags.push(['bid', request.bid_msats.toString()]);
  }

  for (const relay of (request.relays ?? [])) {
    tags.push(['relays', relay]);
  }

  if (request.encryptTo) {
    tags.push(['encrypted']);
  }

  return {
    kind: request.kind,
    tags,
    content: request.encryptTo
      ? nip44Encrypt(JSON.stringify(request.input), request.encryptTo)
      : '',
    created_at: Math.floor(Date.now() / 1000),
  };
}
```

**Example — text generation request:**

```json
{
  "kind": 5100,
  "tags": [
    ["i", "Summarize the top 5 news stories about Bitcoin today", "text"],
    ["param", "model", "gpt-4o"],
    ["param", "max_tokens", "500"],
    ["bid", "2000"],
    ["relays", "wss://pylon.openagents.com"]
  ],
  "content": ""
}
```

---

## Job Result (kind:6xxx)

Job results use kind = job_request_kind + 1000. So a `kind:5100` request produces a `kind:6100` result.

**Subscription filter:**

```typescript
const resultFilter = {
  kinds: [request.kind + 1000],  // e.g., 6100 for text generation
  '#e': [requestEventId],         // Reference to specific job request
  since: requestTimestamp,
};
```

**Example result event:**

```json
{
  "kind": 6100,
  "pubkey": "<provider_pubkey>",
  "tags": [
    ["e", "<job_request_event_id>", "", "request"],
    ["p", "<consumer_pubkey>"],
    ["amount", "1800", "msats", "<bolt11_invoice>"],
    ["status", "success"]
  ],
  "content": "Here are the top 5 Bitcoin news stories today:\n\n1. ..."
}
```

| Tag | Description |
|---|---|
| `e` | Reference to the job request event |
| `p` | Consumer pubkey |
| `amount` | Amount in msats, optionally followed by a BOLT-11 invoice |
| `status` | `success` \| `error` \| `partial` |

If the job was submitted with `encryptTo`, the `content` is NIP-44 encrypted and must be decrypted with the consumer's nsec.

---

## Job Feedback (kind:7000)

Published by the consumer after receiving and verifying results:

```json
{
  "kind": 7000,
  "pubkey": "<consumer_pubkey>",
  "tags": [
    ["e", "<job_request_event_id>", "", "request"],
    ["e", "<job_result_event_id>", "", "result"],
    ["p", "<provider_pubkey>"],
    ["status", "success"],
    ["amount", "1800", "msats"]
  ],
  "content": "Result was accurate, well-formatted, and delivered within 30 seconds."
}
```

Job feedback contributes to provider reputation. The NIP-AC settlement receipt (`kind:39244`) references the feedback event for the complete audit chain.

---

## Provider Discovery (kind:31990)

Providers advertise their capabilities via `kind:31990` handler information events:

```json
{
  "kind": 31990,
  "pubkey": "<provider_pubkey>",
  "tags": [
    ["d", "<provider_id>"],
    ["k", "5100"],
    ["k", "5200"],
    ["name", "FastInference-Pro"],
    ["about", "High-throughput inference for text and image tasks"],
    ["nip05", "fast-inference@openagents.com"],
    ["picture", "https://..."],
    ["pricing", "1000", "msats", "per_1k_tokens"],
    ["reputation", "4.87"],
    ["skill", "<skill_scope_id>"]
  ],
  "content": ""
}
```

**Discovery subscription:**

```typescript
// Subscribe to providers for a specific job kind
const providerFilter = {
  kinds: [31990],
  '#k': [targetJobKind.toString()],  // e.g., "5100" for text generation
};
```

The Satnam marketplace UI displays providers ranked by reputation score, with their NIP-SKL skill attestation levels and pricing.

---

## Payment Flow

```
1. Consumer receives job result (kind:6xxx)
   └── Result includes `amount` tag with BOLT-11 invoice

2. Satnam presents invoice to Principal
   ├── If within agent spend policy → auto-pay
   └── If above threshold → Principal approval required

3. Payment via NWC
   └── nwcClient.payInvoice(bolt11)

4. Payment confirmed → Publish feedback (kind:7000)
   └── Include payment proof in feedback `content`

5. (Optional) NIP-AC settlement
   └── Publish kind:39244 settlement receipt if using credit envelope
```

**Agent auto-pay logic:**

```typescript
async function handleJobResult(result: JobResultEvent): Promise<void> {
  const invoice = result.tags.find(t => t[0] === 'amount')?.[3];
  const amountMsats = BigInt(result.tags.find(t => t[0] === 'amount')?.[1] ?? 0);

  if (amountMsats <= agentSpendPolicy.max_single_spend_msats &&
      amountMsats <= agentSpendPolicy.requires_approval_above_msats) {
    // Auto-pay within policy
    await nwcClient.payInvoice(invoice);
    await publishFeedback(result, 'success');
  } else {
    // Escalate to Principal for approval
    await notifyGovernor(result, amountMsats);
  }
}
```

---

## DvmMarketplace Class

The `DvmMarketplace` class in `src/lib/nip90/` wraps the complete NIP-90 client lifecycle:

```typescript
class DvmMarketplace {
  // Discovery
  async discoverProviders(jobKind: number): Promise<DvmProvider[]>;
  async getProviderProfile(providerPubkey: string): Promise<DvmProvider>;

  // Job lifecycle
  async submitJob(request: DvmJobRequest): Promise<JobSubmission>;
  async subscribeToResult(jobEventId: string): AsyncIterator<JobResult>;
  async cancelJob(jobEventId: string): Promise<void>;

  // Payment
  async payForResult(result: JobResult): Promise<PaymentReceipt>;
  async publishFeedback(result: JobResult, rating: FeedbackRating): Promise<void>;

  // Credit envelope integration
  async submitJobWithEnvelope(
    request: DvmJobRequest,
    envelope: CreditEnvelope
  ): Promise<JobSubmission>;
}
```

The `useMarketplace` React hook wraps `DvmMarketplace` with state management for the UI components (`ProviderCard`, `JobSubmitForm`, `JobResultDisplay`, `ActiveJobsList`, `CreditEnvelopePanel`).
