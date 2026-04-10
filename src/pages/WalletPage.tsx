/**
 * Satnam v2 — Wallet Page (Financial Command Center)
 * Phase 5: 8-tab financial command center.
 *
 * Tabs:
 * 1. Overview   — WalletDashboard + RailHealthIndicator
 * 2. Send/Recv  — Send payment, generate invoice
 * 3. Transactions — Full transaction list
 * 4. Cascades   — CascadeBuilder + execution history
 * 5. Scheduled  — ScheduledPaymentsPanel
 * 6. Swaps      — AtomicSwapPanel
 * 7. Bonds      — BondDashboard (Sig4Sats)
 * 8. Analytics  — PaymentFlowDashboard
 */

import { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import clsx from 'clsx';
import {
  LayoutDashboard,
  Send,
  List,
  GitBranch,
  Repeat,
  ArrowLeftRight,
  Shield,
  BarChart3,
  Zap,
} from 'lucide-react';

// Existing components
import WalletDashboard from '../components/wallet/WalletDashboard.js';
import type { Transaction } from '../components/wallet/TransactionList.js';

// New payment components
import RailHealthIndicator from '../components/payments/RailHealthIndicator.js';
import PaymentFlowDashboard from '../components/payments/PaymentFlowDashboard.js';
import CascadeBuilder from '../components/payments/CascadeBuilder.js';
import AtomicSwapPanel from '../components/payments/AtomicSwapPanel.js';
import ScheduledPaymentsPanel from '../components/payments/ScheduledPaymentsPanel.js';
import BondDashboard from '../components/payments/BondDashboard.js';

// ============================================================================
// Mock data
// ============================================================================

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: '1',
    type: 'lightning',
    direction: 'in',
    status: 'complete',
    amountMsats: 21000000n,
    description: 'Coffee ⚡',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    paymentHash: 'a1b2c3d4e5f6' + '00'.repeat(26),
  },
  {
    id: '2',
    type: 'lightning',
    direction: 'out',
    status: 'complete',
    amountMsats: 5000000n,
    description: 'Nostr zap',
    timestamp: Math.floor(Date.now() / 1000) - 7200,
    paymentHash: 'b2c3d4e5f6a7' + '00'.repeat(26),
    fee: 50n,
  },
  {
    id: '3',
    type: 'cashu',
    direction: 'in',
    status: 'complete',
    amountMsats: 1000000n,
    description: 'Cashu token received',
    timestamp: Math.floor(Date.now() / 1000) - 86400,
  },
  {
    id: '4',
    type: 'lightning',
    direction: 'out',
    status: 'pending',
    amountMsats: 50000000n,
    description: 'Pending payment',
    timestamp: Math.floor(Date.now() / 1000) - 300,
  },
];

// ============================================================================
// Tab configuration
// ============================================================================

type TabId = 'overview' | 'send-receive' | 'transactions' | 'cascades' | 'scheduled' | 'swaps' | 'bonds' | 'analytics';

interface Tab {
  id: TabId;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
  color: string;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard, color: '#f7931a' },
  { id: 'send-receive', label: 'Send / Receive', shortLabel: 'Send', icon: Send, color: '#f7931a' },
  { id: 'transactions', label: 'Transactions', shortLabel: 'Txns', icon: List, color: '#a0a0a0' },
  { id: 'cascades', label: 'Cascades', shortLabel: 'Cascade', icon: GitBranch, color: '#ffd700' },
  { id: 'scheduled', label: 'Scheduled', shortLabel: 'Sched.', icon: Repeat, color: '#22c55e' },
  { id: 'swaps', label: 'Swaps', shortLabel: 'Swaps', icon: ArrowLeftRight, color: '#3b82f6' },
  { id: 'bonds', label: 'Bonds', shortLabel: 'Bonds', icon: Shield, color: '#ffd700' },
  { id: 'analytics', label: 'Analytics', shortLabel: 'Stats', icon: BarChart3, color: '#a855f7' },
];

// ============================================================================
// NWC Setup form
// ============================================================================

function NwcSetup({ onConnect }: { onConnect: (uri: string) => void }) {
  const [uri, setUri] = useState('');
  const [label, setLabel] = useState('');

  const handleConnect = () => {
    if (!uri.trim().startsWith('nostr+walletconnect://')) return;
    onConnect(uri.trim());
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
      <div>
        <h3 className="heading-display text-lg text-[#F7931A] tracking-wider uppercase mb-1">
          Connect Wallet
        </h3>
        <p className="text-sm text-slate-500">
          Connect a NIP-47 Nostr Wallet Connect wallet (Alby Hub, PhoenixD, LND, CLN).
        </p>
      </div>

      <div>
        <label htmlFor="nwc-label" className="block text-xs font-medium text-slate-400 mb-1.5">
          Connection Label
        </label>
        <input
          id="nwc-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My Alby Hub"
          className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#F7931A] transition-colors"
        />
      </div>

      <div>
        <label htmlFor="nwc-uri" className="block text-xs font-medium text-slate-400 mb-1.5">
          NWC URI <span className="text-[#F7931A]">*</span>
        </label>
        <textarea
          id="nwc-uri"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="nostr+walletconnect://..."
          rows={3}
          className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-[#F7931A] transition-colors resize-none"
          aria-required="true"
        />
        <p className="mt-1 text-xs text-slate-600">Stored encrypted in your local vault. Never transmitted.</p>
      </div>

      <button
        type="button"
        onClick={handleConnect}
        disabled={!uri.trim().startsWith('nostr+walletconnect://')}
        className="w-full py-3 rounded-xl font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Connect
      </button>

      <div>
        <p className="text-xs text-slate-600 mb-2 text-center">Compatible wallets</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {['Alby Hub', 'PhoenixD', 'LND', 'CLN', 'Mutiny'].map((name) => (
            <span key={name} className="text-xs px-2 py-1 rounded-full border border-slate-700 text-slate-500">
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Send / Receive tab content
// ============================================================================

function SendReceiveTab({
  onSend,
  onMakeInvoice,
}: {
  onSend: (bolt11: string) => Promise<{ success: boolean; preimage: string }>;
  onMakeInvoice: (msats: bigint, desc: string) => Promise<{ bolt11: string; paymentHash: string }>;
}) {
  const [mode, setMode] = useState<'send' | 'receive'>('send');
  const [bolt11, setBolt11] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState<number>(1000);
  const [invoiceDesc, setInvoiceDesc] = useState('');
  const [generatedInvoice, setGeneratedInvoice] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ success: boolean; preimage: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = useCallback(async () => {
    if (!bolt11.trim()) return;
    setIsLoading(true);
    const result = await onSend(bolt11.trim());
    setSendResult(result);
    setIsLoading(false);
  }, [bolt11, onSend]);

  const handleMakeInvoice = useCallback(async () => {
    setIsLoading(true);
    const { bolt11: inv } = await onMakeInvoice(BigInt(invoiceAmount * 1000), invoiceDesc);
    setGeneratedInvoice(inv);
    setIsLoading(false);
  }, [invoiceAmount, invoiceDesc, onMakeInvoice]);

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-xl border border-slate-800 overflow-hidden bg-slate-900">
        {(['send', 'receive'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setSendResult(null); setGeneratedInvoice(null); }}
            aria-pressed={mode === m}
            className={clsx(
              'flex-1 py-3 text-sm font-medium transition-colors capitalize',
              mode === m ? 'bg-[#f7931a] text-black' : 'text-slate-400 hover:text-slate-300'
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'send' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
          <div>
            <label htmlFor="bolt11-input" className="block text-xs text-slate-400 mb-1.5">
              Lightning Invoice (BOLT-11)
            </label>
            <textarea
              id="bolt11-input"
              value={bolt11}
              onChange={(e) => setBolt11(e.target.value)}
              placeholder="lnbc..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 font-mono text-xs focus:outline-none focus:border-[#f7931a] transition-colors resize-none"
            />
          </div>

          {sendResult && (
            <div className={clsx(
              'px-3 py-2 rounded-lg text-xs',
              sendResult.success
                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-400'
            )}>
              {sendResult.success ? `Payment sent. Preimage: ${sendResult.preimage.slice(0, 16)}…` : 'Payment failed'}
            </div>
          )}

          <button
            type="button"
            onClick={handleSend}
            disabled={!bolt11.trim() || isLoading}
            className="w-full py-3 rounded-xl font-medium bg-[#f7931a] text-black hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <Zap size={16} aria-hidden="true" />
            {isLoading ? 'Paying…' : 'Pay Invoice'}
          </button>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
          <div>
            <label htmlFor="inv-amount" className="block text-xs text-slate-400 mb-1.5">Amount (sats)</label>
            <input
              id="inv-amount"
              type="number"
              min={1}
              value={invoiceAmount}
              onChange={(e) => setInvoiceAmount(parseInt(e.target.value, 10) || 0)}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-mono text-lg focus:outline-none focus:border-[#f7931a] transition-colors"
            />
          </div>

          <div>
            <label htmlFor="inv-desc" className="block text-xs text-slate-400 mb-1.5">Description (optional)</label>
            <input
              id="inv-desc"
              type="text"
              value={invoiceDesc}
              onChange={(e) => setInvoiceDesc(e.target.value)}
              placeholder="Payment for..."
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
            />
          </div>

          {generatedInvoice && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3">
              <p className="text-xs text-slate-500 mb-2">Invoice (copy and share)</p>
              <p className="text-[10px] font-mono text-slate-300 break-all">{generatedInvoice.slice(0, 80)}…</p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(generatedInvoice)}
                className="mt-2 text-xs text-[#f7931a] hover:underline"
              >
                Copy full invoice
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleMakeInvoice}
            disabled={invoiceAmount <= 0 || isLoading}
            className="w-full py-3 rounded-xl font-medium bg-[#f7931a] text-black hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Generating…' : 'Generate Invoice'}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Transactions tab
// ============================================================================

function TransactionsTab({ transactions }: { transactions: Transaction[] }) {
  // Simple inline transaction list (references existing TransactionList data shapes)
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800">
      {transactions.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">No transactions yet</p>
      ) : (
        transactions.map((tx) => {
          const sats = Math.floor(Number(tx.amountMsats) / 1000);
          return (
            <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
              <div className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                tx.direction === 'in' ? 'bg-green-500/10' : 'bg-slate-800'
              )}>
                <Zap
                  size={14}
                  className={tx.direction === 'in' ? 'text-green-400' : 'text-slate-400'}
                  aria-hidden="true"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-300 truncate">{tx.description || 'Payment'}</p>
                <p className="text-xs text-slate-500 capitalize">{tx.type} · {tx.status}</p>
              </div>
              <div className="text-right">
                <p className={clsx(
                  'text-sm font-mono font-medium',
                  tx.direction === 'in' ? 'text-green-400' : 'text-slate-300'
                )}>
                  {tx.direction === 'in' ? '+' : '−'}{sats.toLocaleString()}
                </p>
                <p className="text-xs text-slate-500">sats</p>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ============================================================================
// Tab navigation (scrollable horizontal tabs for mobile)
// ============================================================================

function TabNav({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: Tab[];
  activeTab: TabId;
  onSelect: (id: TabId) => void;
}) {
  return (
    <nav
      className="flex overflow-x-auto gap-1 pb-0.5 no-scrollbar"
      aria-label="Wallet navigation tabs"
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onSelect(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs whitespace-nowrap transition-all flex-shrink-0',
              isActive
                ? 'font-medium'
                : 'text-slate-500 hover:text-slate-400 hover:bg-slate-800/50'
            )}
            style={isActive ? {
              backgroundColor: `${tab.color}20`,
              color: tab.color,
              border: `1px solid ${tab.color}30`,
            } : {}}
          >
            <tab.icon size={13} aria-hidden="true" />
            {tab.shortLabel}
          </button>
        );
      })}
    </nav>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function WalletPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [balance] = useState<bigint>(84000000n);
  const [cashuBalance] = useState<number>(5030);
  const [transactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const handleConnect = useCallback((_uri: string) => {
    setIsConnected(true);
  }, []);

  const handleSend = useCallback(async (_bolt11: string) => {
    await new Promise((r) => setTimeout(r, 2000));
    return { success: true, preimage: '00'.repeat(32) };
  }, []);

  const handleMakeInvoice = useCallback(async (amountMsats: bigint, _description: string) => {
    await new Promise((r) => setTimeout(r, 1000));
    return {
      bolt11: 'lnbc' + Math.floor(Number(amountMsats) / 1000) + 'n1p' + 'x'.repeat(100),
      paymentHash: '00'.repeat(32),
    };
  }, []);

  const handleCheckPayment = useCallback(async (_paymentHash: string) => {
    return 'pending' as const;
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setIsLoading(false);
  }, []);

  const handleCascadeExecute = useCallback((nodes: unknown[], totalSats: number) => {
    console.info('[Wallet] Cascade execute', { nodes, totalSats });
  }, []);

  return (
    <>
      <Helmet>
        <title>Satnam — Wallet</title>
        <meta name="description" content="Financial command center: Lightning, Cashu, cascades, swaps, bonds, and analytics." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h1 className="heading-display text-2xl text-[#F7931A] tracking-wider uppercase">
              Wallet
            </h1>
            {isConnected && (
              <div className="flex items-center gap-1.5 text-xs text-green-500">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Connected
              </div>
            )}
          </div>

          {!isConnected ? (
            /* NWC setup — not connected */
            <NwcSetup onConnect={handleConnect} />
          ) : (
            <>
              {/* Tab navigation */}
              <div className="mb-4">
                <TabNav tabs={TABS} activeTab={activeTab} onSelect={setActiveTab} />
              </div>

              {/* Tab panels */}
              <div>
                {/* Overview */}
                <div
                  id="tabpanel-overview"
                  role="tabpanel"
                  aria-labelledby="tab-overview"
                  hidden={activeTab !== 'overview'}
                >
                  {activeTab === 'overview' && (
                    <div className="space-y-4">
                      <WalletDashboard
                        lightningBalanceMsats={balance}
                        cashuBalanceSats={cashuBalance}
                        isLoading={isLoading}
                        transactions={transactions}
                        onSend={handleSend}
                        onMakeInvoice={handleMakeInvoice}
                        onCheckPayment={handleCheckPayment}
                        onRefresh={handleRefresh}
                      />
                      <RailHealthIndicator />
                    </div>
                  )}
                </div>

                {/* Send / Receive */}
                <div
                  id="tabpanel-send-receive"
                  role="tabpanel"
                  aria-labelledby="tab-send-receive"
                  hidden={activeTab !== 'send-receive'}
                >
                  {activeTab === 'send-receive' && (
                    <SendReceiveTab
                      onSend={handleSend}
                      onMakeInvoice={handleMakeInvoice}
                    />
                  )}
                </div>

                {/* Transactions */}
                <div
                  id="tabpanel-transactions"
                  role="tabpanel"
                  aria-labelledby="tab-transactions"
                  hidden={activeTab !== 'transactions'}
                >
                  {activeTab === 'transactions' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs text-slate-500 uppercase tracking-widest">
                          All Transactions
                        </h2>
                        <span className="text-xs text-slate-500">{transactions.length} total</span>
                      </div>
                      <TransactionsTab transactions={transactions} />
                    </div>
                  )}
                </div>

                {/* Cascades */}
                <div
                  id="tabpanel-cascades"
                  role="tabpanel"
                  aria-labelledby="tab-cascades"
                  hidden={activeTab !== 'cascades'}
                >
                  {activeTab === 'cascades' && (
                    <CascadeBuilder onExecute={handleCascadeExecute} />
                  )}
                </div>

                {/* Scheduled */}
                <div
                  id="tabpanel-scheduled"
                  role="tabpanel"
                  aria-labelledby="tab-scheduled"
                  hidden={activeTab !== 'scheduled'}
                >
                  {activeTab === 'scheduled' && <ScheduledPaymentsPanel />}
                </div>

                {/* Swaps */}
                <div
                  id="tabpanel-swaps"
                  role="tabpanel"
                  aria-labelledby="tab-swaps"
                  hidden={activeTab !== 'swaps'}
                >
                  {activeTab === 'swaps' && <AtomicSwapPanel />}
                </div>

                {/* Bonds */}
                <div
                  id="tabpanel-bonds"
                  role="tabpanel"
                  aria-labelledby="tab-bonds"
                  hidden={activeTab !== 'bonds'}
                >
                  {activeTab === 'bonds' && <BondDashboard />}
                </div>

                {/* Analytics */}
                <div
                  id="tabpanel-analytics"
                  role="tabpanel"
                  aria-labelledby="tab-analytics"
                  hidden={activeTab !== 'analytics'}
                >
                  {activeTab === 'analytics' && <PaymentFlowDashboard />}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

