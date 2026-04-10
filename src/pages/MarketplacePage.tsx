/**
 * Satnam v2 — Marketplace Page
 * Phase 3: NIP-90 DVM marketplace
 *
 * Tab navigation: Discover | My Jobs | Credits
 *
 * - Provider discovery (grid of ProviderCards with search/filter)
 * - "Submit Job" button → JobSubmitForm
 * - Active jobs list
 * - Job result display
 * - Credit envelope panel
 */

import { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import clsx from 'clsx';
import {
  Store,
  Briefcase,
  CreditCard,
  Search,
  X,
  RefreshCw,
} from 'lucide-react';

import { useMarketplace } from '../hooks/useMarketplace.js';
import { useCreditLifecycle } from '../hooks/useCreditLifecycle.js';

import ProviderCard from '../components/marketplace/ProviderCard.js';
import JobSubmitForm from '../components/marketplace/JobSubmitForm.js';
import JobResultDisplay from '../components/marketplace/JobResultDisplay.js';
import ActiveJobsList from '../components/marketplace/ActiveJobsList.js';
import CreditEnvelopePanel from '../components/marketplace/CreditEnvelopePanel.js';

import type { DVMProvider, Job } from '../hooks/useMarketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MainTab = 'discover' | 'jobs' | 'credits';

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

function TabBar({
  active,
  onChange,
  counts,
}: {
  active: MainTab;
  onChange: (t: MainTab) => void;
  counts: { discover: number; jobs: number; credits: number };
}) {
  const tabs: Array<{ id: MainTab; label: string; Icon: typeof Store; count: number }> = [
    { id: 'discover', label: 'Discover', Icon: Store, count: counts.discover },
    { id: 'jobs', label: 'My Jobs', Icon: Briefcase, count: counts.jobs },
    { id: 'credits', label: 'Credits', Icon: CreditCard, count: counts.credits },
  ];

  return (
    <div className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-[#2a2a2a]" role="tablist" aria-label="Marketplace sections">
      {tabs.map(tab => {
        const isActive = active === tab.id;
        const { Icon } = tab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-[#f7931a] text-black'
                : 'text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800',
            )}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count > 0 && (
              <span className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-black/20' : 'bg-slate-800',
              )}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discover tab
// ---------------------------------------------------------------------------

function DiscoverTab() {
  const { providers, isLoading } = useMarketplace();
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<DVMProvider | null>(null);
  const [showJobForm, setShowJobForm] = useState(false);
  const [jobFormProvider, setJobFormProvider] = useState<DVMProvider | null>(null);

  const filtered = search
    ? providers.filter(p =>
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.pubkey.includes(search.toLowerCase()) ||
        p.supportedJobKinds.some((jt: number) => String(jt).includes(search))
      )
    : providers;

  const handleSubmitJob = useCallback((provider: DVMProvider) => {
    setJobFormProvider(provider);
    setShowJobForm(true);
  }, []);

  const handleJobComplete = (_jobId: string) => {
    setShowJobForm(false);
    setJobFormProvider(null);
  };

  if (showJobForm) {
    return (
      <JobSubmitForm
        provider={jobFormProvider ?? undefined}
        onComplete={handleJobComplete}
        onCancel={() => { setShowJobForm(false); setJobFormProvider(null); }}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search providers, job types…"
          aria-label="Search providers"
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-48 skeleton rounded-xl" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && providers.length === 0 && (
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center">
            <Store size={28} className="text-blue-400" />
          </div>
          <div>
            <h3 className="heading-display text-lg text-[#f5f5f5] mb-1">No Providers Found</h3>
            <p className="text-sm text-[#555555]">Connect to relays to discover DVM providers on the Nostr network.</p>
          </div>
        </div>
      )}

      {/* Provider grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs text-[#555555]">{filtered.length} provider{filtered.length !== 1 ? 's' : ''} found</p>
          {filtered.map(provider => (
            <ProviderCard
              key={provider.pubkey}
              provider={provider}
              onSubmitJob={handleSubmitJob}
              onViewDetails={p => setSelectedProvider(p)}
            />
          ))}
        </div>
      )}

      {/* No search results */}
      {!isLoading && providers.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8">
          <Search size={24} className="mx-auto text-[#555555] mb-2" />
          <p className="text-sm text-[#555555]">No providers match "{search}"</p>
        </div>
      )}

      {/* Provider detail modal overlay */}
      {selectedProvider && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-label="Provider details">
          <div className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-[#111111] border border-[#2a2a2a]">
            <div className="p-4 border-b border-[#2a2a2a] flex items-center justify-between">
              <h3 className="font-display text-[#f7931a]">Provider Details</h3>
              <button
                type="button"
                onClick={() => setSelectedProvider(null)}
                aria-label="Close provider details"
                className="p-1.5 rounded-lg text-[#555555] hover:text-[#a0a0a0] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <ProviderCard
                provider={selectedProvider}
                onSubmitJob={p => {
                  setSelectedProvider(null);
                  handleSubmitJob(p);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Jobs tab
// ---------------------------------------------------------------------------

function MyJobsTab() {
  const { activeJobs } = useMarketplace();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  if (selectedJob) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelectedJob(null)}
          className="flex items-center gap-2 text-sm text-[#555555] hover:text-[#a0a0a0] transition-colors"
        >
          ← Back to jobs
        </button>
        <JobResultDisplay
          job={selectedJob}
          onAccepted={() => setSelectedJob(null)}
          onRejected={() => setSelectedJob(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="heading-display text-xl text-[#f7931a]">My Jobs</h2>
        <span className="text-xs text-[#555555]">{activeJobs.length} total</span>
      </div>

      <ActiveJobsList
        onSelectJob={job => {
          if (job.result || job.status !== 'pending') {
            setSelectedJob(job);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credits tab
// ---------------------------------------------------------------------------

function CreditsTab() {
  const { envelopes } = useCreditLifecycle(null, null, null);

  const totalCommitted = envelopes.reduce((s, e) => s + e.maxSats, 0);
  const totalSpent = envelopes.reduce((s, _e) => s, 0);
  const activeCount = envelopes.filter(e => !['Settlement', 'Default'].includes(e.state)).length;

  return (
    <div className="space-y-5">
      <h2 className="heading-display text-xl text-[#f7931a]">Credit Envelopes</h2>

      {envelopes.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3 text-center">
            <p className="font-bold text-lg text-[#f7931a]">{activeCount}</p>
            <p className="text-xs text-[#555555]">Active</p>
          </div>
          <div className="card p-3 text-center">
            <p className="font-mono font-bold text-lg text-[#f5f5f5]">{totalCommitted.toLocaleString()}</p>
            <p className="text-xs text-[#555555]">Committed</p>
          </div>
          <div className="card p-3 text-center">
            <p className="font-mono font-bold text-lg text-[#f5f5f5]">{totalSpent.toLocaleString()}</p>
            <p className="text-xs text-[#555555]">Spent</p>
          </div>
        </div>
      )}

      <CreditEnvelopePanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MarketplacePage() {
  const { providers, activeJobs, isLoading } = useMarketplace();
  const { envelopes } = useCreditLifecycle(null, null, null);
  const [activeTab, setActiveTab] = useState<MainTab>('discover');

  const counts = {
    discover: providers.length,
    jobs: activeJobs.length,
    credits: envelopes.filter(e => !['Settlement', 'Default'].includes(e.state)).length,
  };

  return (
    <>
      <Helmet>
        <title>Satnam — Marketplace</title>
        <meta name="description" content="NIP-90 DVM marketplace. Discover providers, submit jobs, and manage credit envelopes." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          {/* Page header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center">
                <Store size={20} className="text-blue-400" />
              </div>
              <div>
                <h1 className="heading-display text-2xl text-[#f7931a]">Marketplace</h1>
                <p className="text-xs text-[#555555]">NIP-90 DVM network</p>
              </div>
            </div>

            {/* Refresh indicator */}
            {isLoading && (
              <RefreshCw size={16} className="text-[#555555] animate-spin" aria-label="Loading" />
            )}
          </div>

          {/* Tab navigation */}
          <TabBar active={activeTab} onChange={setActiveTab} counts={counts} />

          {/* Tab content */}
          <div id={`tabpanel-${activeTab}`} role="tabpanel" aria-label={activeTab}>
            {activeTab === 'discover' && <DiscoverTab />}
            {activeTab === 'jobs' && <MyJobsTab />}
            {activeTab === 'credits' && <CreditsTab />}
          </div>
        </div>
      </main>
    </>
  );
}


