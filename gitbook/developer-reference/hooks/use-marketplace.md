# useMarketplace

**File:** `src/hooks/useMarketplace.ts`
**Provider:** `CepsProvider` (requires `VaultProvider`)
**Feature flag:** `VITE_ENABLE_NIP90=true`

---

## Purpose

`useMarketplace` is the NIP-90 DVM (Data Vending Machine) client interface. It discovers providers (kind:31990), submits job requests (kind:5xxx), tracks results (kind:6xxx), and manages the NIP-AC credit envelope lifecycle.

---

## Return Value Shape

```typescript
interface UseMarketplaceReturn {
  // Provider discovery
  providers: DvmProvider[];
  discoverProviders: (jobKind: number) => Promise<void>;
  getProvider: (pubkey: string) => DvmProvider | undefined;

  // Job lifecycle
  activeJobs: JobRecord[];
  submitJob: (request: DvmJobRequest, connectionId?: string) => Promise<string>; // Returns job event ID
  cancelJob: (jobEventId: string) => Promise<void>;
  getJobResult: (jobEventId: string) => Promise<DvmJobResult | null>;
  submitFeedback: (jobEventId: string, resultEventId: string, rating: number, comment: string) => Promise<void>;

  // Credit lifecycle
  creditRecords: CreditLifecycleRecord[];
  createIntent: (intent: CreditIntentContent) => Promise<string>; // Returns event ID
  acceptOffer: (intentId: string, offerId: string) => Promise<string>; // Returns envelope ID
  authorizeSpend: (envelopeId: string, amount: number, purpose: string) => Promise<void>;

  // Payment
  payJobResult: (resultEventId: string) => Promise<PaymentResult>;

  // State
  loading: boolean;
  error: string | null;
}

interface DvmProvider {
  pubkey: string;
  name?: string;
  about?: string;
  supportedKinds: number[];   // Job kinds this provider handles
  priceMsats?: bigint;        // Typical pricing
  reputationScore?: number;   // Derived from settlement receipts
  skills: string[];           // NIP-SKL skill scope IDs
}

interface DvmJobRequest {
  kind: number;               // 5000–5999 per NIP-90
  input: DvmInput[];
  params: DvmParam[];
  bid_msats?: bigint;
  relays?: string[];
  encryptTo?: string;         // Pubkey for NIP-44 encrypted results
}

interface JobRecord {
  requestEventId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider?: string;
  result?: DvmJobResult;
  submittedAt: number;
}

interface DvmJobResult {
  eventId: string;
  kind: number;               // 6xxx
  content: string;
  amountTag?: string;         // Invoice or payment info
  statusTag?: string;
}
```

---

## NIP-90 Kind Ranges

| Range | Type | Description |
|---|---|---|
| 5000–5999 | Job Request | Consumer → Provider |
| 6000–6999 | Job Result | Provider → Consumer (kind + 1000) |
| 7000 | Job Feedback | Consumer reputation signal |
| 31990 | Provider Profile | Provider capability announcement |

---

## Example Usage in a Component

### Browse Providers

```tsx
import { useMarketplace } from '@hooks/useMarketplace';

function ProviderBrowser() {
  const marketplace = useMarketplace();

  useEffect(() => {
    // Discover providers that handle text generation jobs (kind 5100)
    marketplace.discoverProviders(5100);
  }, []);

  return (
    <div>
      <h2>Available Providers</h2>
      {marketplace.loading && <p>Discovering providers...</p>}
      {marketplace.providers.map((provider) => (
        <div key={provider.pubkey} className="provider-card">
          <h3>{provider.name ?? provider.pubkey.slice(0, 8) + '...'}</h3>
          <p>{provider.about}</p>
          <p>
            Price:{' '}
            {provider.priceMsats != null
              ? `${provider.priceMsats / 1000n} sats`
              : 'Variable'}
          </p>
          <p>Reputation: {provider.reputationScore ?? 'No data'}</p>
          <JobSubmitButton providerPubkey={provider.pubkey} />
        </div>
      ))}
    </div>
  );
}
```

### Submit a Job

```tsx
import { useMarketplace } from '@hooks/useMarketplace';

function JobSubmitForm({ providerPubkey }: { providerPubkey: string }) {
  const marketplace = useMarketplace();
  const [query, setQuery] = useState('');

  async function handleSubmit() {
    const jobId = await marketplace.submitJob({
      kind: 5100,           // Text generation
      input: [{ data: query, type: 'text' }],
      params: [{ key: 'provider', value: providerPubkey }],
      bid_msats: 5000n,     // Max bid: 5 sats
    });

    console.log('Job submitted:', jobId);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter your request..."
      />
      <button type="submit" disabled={marketplace.loading}>
        Submit Job (max 5 sats)
      </button>
    </form>
  );
}
```

### Active Jobs Panel

```tsx
import { useMarketplace } from '@hooks/useMarketplace';

function ActiveJobsList() {
  const marketplace = useMarketplace();

  return (
    <div>
      <h2>Active Jobs</h2>
      {marketplace.activeJobs.map((job) => (
        <div key={job.requestEventId}>
          <span>Kind {job.status}</span>
          <span>Submitted {new Date(job.submittedAt * 1000).toLocaleTimeString()}</span>
          {job.status === 'completed' && job.result && (
            <div>
              <p>{job.result.content}</p>
              {job.result.amountTag && (
                <button
                  onClick={() => marketplace.payJobResult(job.result!.eventId)}
                >
                  Pay Invoice
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### NIP-AC Credit Lifecycle

```tsx
import { useMarketplace } from '@hooks/useMarketplace';

function CreditEnvelopeFlow() {
  const marketplace = useMarketplace();

  async function createResearchIntent() {
    // Step 1: Publish intent
    const intentId = await marketplace.createIntent({
      description: 'Research 5 companies in the renewable energy sector',
      budget_sats: 5000,
      deadline_unix: Math.floor(Date.now() / 1000) + 3600,
      required_skills: ['research', 'summarization'],
    });

    console.log('Intent published:', intentId);
    // Providers respond with offers (kind:39241)
    // offers shown in marketplace.creditRecords
  }

  async function acceptProviderOffer(intentId: string, offerId: string) {
    // Step 2: Accept offer → creates credit envelope
    const envelopeId = await marketplace.acceptOffer(intentId, offerId);
    console.log('Envelope created:', envelopeId);
  }

  return (
    <div>
      <button onClick={createResearchIntent}>
        Post Research Intent
      </button>
      {marketplace.creditRecords.map((record) => (
        <div key={record.envelopeId}>
          <p>State: {record.state}</p>
          <p>Spent: {record.spentSats}/{record.maxSats} sats</p>
        </div>
      ))}
    </div>
  );
}
```

---

## Related Hooks

- [`useNwc`](./use-nwc.md) — payment for job results
- [`useCashu`](./use-cashu.md) — eCash payment rail for jobs
- [`useAgentProfile`](./use-agent-profile.md) — agents participate as providers and consumers

## Related Libraries

- [NIP-AC types](../libraries/README.md) — `nip-ac` module
