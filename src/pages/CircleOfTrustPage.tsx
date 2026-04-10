/**
 * Satnam v2 — Circle of Trust Page
 * Route: /circle
 * Spec: circle-of-trust-spec.md § CircleOfTrustPage
 *
 * 5 tabs:
 *   Overview  — TrustOverviewPanel (concentric rings)
 *   Contacts  — ContactTrustCard list with search/filter
 *   Identity  — IdentityTrustPanel
 *   Financial — FinancialTrustPanel
 *   Skills    — SkillsTrustPanel
 */

import { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import clsx from 'clsx';
import {
  Shield,
  Users,
  Fingerprint,
  Wallet,
  BookOpen,
  Search,
} from 'lucide-react';

import { useCircleOfTrust } from '../hooks/useCircleOfTrust.js';
import { calculateTrustScore } from '../lib/circle-of-trust/trust-engine.js';

import TrustOverviewPanel   from '../components/circle-of-trust/TrustOverviewPanel.js';
import ContactTrustCard     from '../components/circle-of-trust/ContactTrustCard.js';
import HandshakeLedger      from '../components/circle-of-trust/HandshakeLedger.js';
import IdentityTrustPanel   from '../components/circle-of-trust/IdentityTrustPanel.js';
import FinancialTrustPanel  from '../components/circle-of-trust/FinancialTrustPanel.js';
import SkillsTrustPanel     from '../components/circle-of-trust/SkillsTrustPanel.js';

import type { TrustedContact } from '../lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'contacts' | 'identity' | 'financial' | 'skills';
type TrustFilter = 'all' | 'high' | 'medium' | 'new';

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

function TabBar({
  active,
  onChange,
  counts,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: { contacts: number };
}) {
  const tabs: Array<{ id: Tab; label: string; icon: typeof Shield; count?: number }> = [
    { id: 'overview',  label: 'Overview',  icon: Shield,       },
    { id: 'contacts',  label: 'Contacts',  icon: Users,        count: counts.contacts },
    { id: 'identity',  label: 'Identity',  icon: Fingerprint,  },
    { id: 'financial', label: 'Financial', icon: Wallet,       },
    { id: 'skills',    label: 'Skills',    icon: BookOpen,     },
  ];

  return (
    <div
      className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-[#2a2a2a] overflow-x-auto"
      role="tablist"
      aria-label="Circle of Trust sections"
    >
      {tabs.map(tab => {
        const isActive = active === tab.id;
        const { icon: Icon } = tab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap min-w-fit',
              isActive
                ? 'bg-[#ffd700] text-black'
                : 'text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800',
            )}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count != null && tab.count > 0 && (
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
// Contacts tab
// ---------------------------------------------------------------------------

function ContactsTab({
  contacts,
  onMessage,
  onZap,
  onCall,
  onViewProfile,
}: {
  contacts: TrustedContact[];
  onMessage: (pub: string) => void;
  onZap: (pub: string) => void;
  onCall: (pub: string) => void;
  onViewProfile: (pub: string) => void;
}) {
  const [search, setSearch]           = useState('');
  const [filter, setFilter]           = useState<TrustFilter>('all');
  const [selectedPub, setSelectedPub] = useState<string | null>(null);
  const { handshakeLedger }           = useCircleOfTrust();

  const filterFn = (c: TrustedContact): boolean => {
    if (filter === 'high')   return c.trustScore > 70;
    if (filter === 'medium') return c.trustScore >= 30 && c.trustScore <= 70;
    if (filter === 'new')    return c.trustScore < 30;
    return true;
  };

  const filtered = contacts
    .filter(filterFn)
    .filter(c =>
      !search ||
      c.pubkey.toLowerCase().includes(search.toLowerCase()) ||
      (c.nip05 ?? '').toLowerCase().includes(search.toLowerCase()),
    );

  const FILTER_OPTIONS: Array<{ id: TrustFilter; label: string }> = [
    { id: 'all',    label: 'All' },
    { id: 'high',   label: 'High Trust' },
    { id: 'medium', label: 'Medium' },
    { id: 'new',    label: 'New' },
  ];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by npub or NIP-05…"
          aria-label="Search contacts"
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#ffd700] transition-colors"
        />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Trust filter">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setFilter(opt.id)}
            aria-pressed={filter === opt.id}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150',
              filter === opt.id
                ? 'bg-[#ffd700]/20 border border-[#ffd700]/50 text-[#ffd700]'
                : 'bg-slate-800 border border-[#2a2a2a] text-[#555555] hover:text-[#a0a0a0]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Contacts grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <Users size={28} className="mx-auto text-[#555555]" aria-hidden="true" />
          <p className="text-sm text-[#555555]">
            {contacts.length === 0
              ? 'No trusted contacts yet — complete a PoL ceremony to add contacts'
              : 'No contacts match your filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(contact => {
            const ts = calculateTrustScore(contact);
            return (
              <div key={contact.pubkey} className="space-y-3">
                <ContactTrustCard
                  contact={contact}
                  trustScore={ts}
                  onMessage={onMessage}
                  onZap={onZap}
                  onCall={onCall}
                  onViewProfile={(pub) => {
                    setSelectedPub(pub === selectedPub ? null : pub);
                    onViewProfile(pub);
                  }}
                />
                {/* Expanded ledger for selected contact */}
                {selectedPub === contact.pubkey && (
                  <HandshakeLedger
                    entries={handshakeLedger(contact.pubkey)}
                    contactLabel={contact.nip05 ?? contact.pubkey.slice(0, 12)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CircleOfTrustPage() {
  const { contacts, stats, identityProfile, isLoading } = useCircleOfTrust();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Placeholder handlers — wired to real routing/modals in later phases
  const handleMessage    = useCallback((_pub: string) => { console.info('Message'); }, []);
  const handleZap        = useCallback((_pub: string) => { console.info('Zap'); }, []);
  const handleCall       = useCallback((_pub: string) => { console.info('Call'); }, []);
  const handleViewProfile = useCallback((_pub: string) => { console.info('View profile'); }, []);
  const handleContactClick = useCallback((_pub: string) => {
    setActiveTab('contacts');
  }, []);

  return (
    <>
      <Helmet>
        <title>Satnam — Circle of Trust</title>
        <meta name="description" content="PoL-verified trusted contacts, identity reputation, and financial trust." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          {/* Page header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ffd700]/10 border border-[#ffd700]/20 flex items-center justify-center">
              <Shield size={20} className="text-[#ffd700]" aria-hidden="true" />
            </div>
            <div>
              <h1 className="heading-display text-2xl text-[#ffd700]">Circle of Trust</h1>
              <p className="text-xs text-[#555555]">PoL-verified identity & reputation</p>
            </div>
          </div>

          {/* Tab navigation */}
          <TabBar
            active={activeTab}
            onChange={setActiveTab}
            counts={{ contacts: contacts.length }}
          />

          {/* Tab content */}
          <div
            id={`tabpanel-${activeTab}`}
            role="tabpanel"
            aria-label={activeTab}
            tabIndex={0}
          >
            {activeTab === 'overview' && (
              <TrustOverviewPanel
                contacts={contacts}
                stats={stats}
                onContactClick={handleContactClick}
              />
            )}

            {activeTab === 'contacts' && (
              <ContactsTab
                contacts={contacts}
                onMessage={handleMessage}
                onZap={handleZap}
                onCall={handleCall}
                onViewProfile={handleViewProfile}
              />
            )}

            {activeTab === 'identity' && (
              <IdentityTrustPanel
                profile={identityProfile}
                isLoading={isLoading}
              />
            )}

            {activeTab === 'financial' && (
              <FinancialTrustPanel isLoading={isLoading} />
            )}

            {activeTab === 'skills' && (
              <SkillsTrustPanel isLoading={isLoading} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}


