/**
 * @component WalletDashboard
 * @description Wallet overview: balance display, recent transactions, send/receive buttons.
 *
 * Displays Lightning (NWC) and Cashu balances, recent transaction history,
 * and provides quick access to send/receive flows.
 */

import React, { useState } from 'react';
import SendPayment from './SendPayment.js';
import ReceivePayment from './ReceivePayment.js';
import TransactionList, { type Transaction } from './TransactionList.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletDashboardProps {
  lightningBalanceMsats?: bigint;
  cashuBalanceSats?: number;
  isLoading?: boolean;
  transactions?: Transaction[];
  onSend?: (bolt11: string) => Promise<{ success: boolean; preimage?: string; error?: string }>;
  onMakeInvoice?: (amountMsats: bigint, description: string) => Promise<{ bolt11: string; paymentHash: string }>;
  onCheckPayment?: (paymentHash: string) => Promise<'pending' | 'paid' | 'expired'>;
  onRefresh?: () => Promise<void>;
}

type Modal = 'none' | 'send' | 'receive';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(msats: bigint): { whole: string; frac: string } {
  const sats = Number(msats) / 1000;
  if (sats >= 1_000_000) {
    return { whole: (sats / 1_000_000).toFixed(2), frac: 'M sats' };
  }
  if (sats >= 1_000) {
    return { whole: (sats / 1_000).toFixed(1), frac: 'K sats' };
  }
  return { whole: sats.toFixed(sats < 1 ? 3 : 0), frac: 'sats' };
}

// ---------------------------------------------------------------------------
// Balance card
// ---------------------------------------------------------------------------

function BalanceCard({
  lightningMsats,
  cashuSats,
  isLoading,
  onRefresh,
}: {
  lightningMsats?: bigint;
  cashuSats?: number;
  isLoading?: boolean;
  onRefresh?: () => void;
}) {
  const totalSats =
    (lightningMsats !== undefined ? Number(lightningMsats) / 1000 : 0) +
    (cashuSats ?? 0);
  const formatted = formatSats(BigInt(Math.floor(totalSats * 1000)));

  return (
    <div className="card bg-gradient-to-br from-[#1a1a1a] to-[#111111] border-[#2a2a2a]">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-1">
            Total Balance
          </p>
          {isLoading ? (
            <div className="skeleton h-12 w-40 rounded" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-4xl font-bold text-[#f5f5f5]">
                {formatted.whole}
              </span>
              <span className="text-[#555555] text-base">{formatted.frac}</span>
            </div>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 rounded-lg border border-[#2a2a2a] text-[#555555] hover:text-[#a0a0a0] hover:border-[#3a3a3a] transition-colors disabled:opacity-40"
            aria-label="Refresh balance"
          >
            ↻
          </button>
        )}
      </div>

      {/* Sub-balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm" aria-hidden="true">⚡</span>
            <span className="text-xs text-[#555555]">Lightning</span>
          </div>
          {isLoading ? (
            <div className="skeleton h-4 w-20 rounded" />
          ) : (
            <p className="font-mono text-sm font-semibold text-[#f5f5f5]">
              {lightningMsats !== undefined
                ? `${(Number(lightningMsats) / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} sats`
                : '—'
              }
            </p>
          )}
        </div>

        <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm" aria-hidden="true">🔵</span>
            <span className="text-xs text-[#555555]">Cashu</span>
          </div>
          {isLoading ? (
            <div className="skeleton h-4 w-20 rounded" />
          ) : (
            <p className="font-mono text-sm font-semibold text-[#f5f5f5]">
              {cashuSats !== undefined
                ? `${cashuSats.toLocaleString()} sats`
                : '—'
              }
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal overlay
// ---------------------------------------------------------------------------

function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet */}
      <div className="relative w-full max-w-md mx-auto bg-[#111111] border-t sm:border border-[#2a2a2a] rounded-t-2xl sm:rounded-2xl p-6 pb-safe max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick stats
// ---------------------------------------------------------------------------

function QuickStats({ transactions }: { transactions: Transaction[] }) {
  const received = transactions
    .filter(t => t.direction === 'in' && t.status === 'complete')
    .reduce((sum, t) => sum + t.amountMsats, 0n);

  const sent = transactions
    .filter(t => t.direction === 'out' && t.status === 'complete')
    .reduce((sum, t) => sum + t.amountMsats, 0n);

  const items = [
    { label: 'Received',     value: `${(Number(received) / 1000).toLocaleString()} sats`, icon: '↓', color: 'text-green-500' },
    { label: 'Sent',         value: `${(Number(sent) / 1000).toLocaleString()} sats`,     icon: '↑', color: 'text-[#F7931A]' },
    { label: 'Transactions', value: String(transactions.length),                             icon: '📋', color: 'text-[#3B82F6]' },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map(item => (
        <div key={item.label} className="card p-3 text-center">
          <p className={`text-lg font-bold mb-0.5 ${item.color}`} aria-hidden="true">{item.icon}</p>
          <p className="font-mono text-xs font-semibold text-[#f5f5f5] truncate">{item.value}</p>
          <p className="text-xs text-[#555555] mt-0.5">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function WalletDashboard({
  lightningBalanceMsats,
  cashuBalanceSats,
  isLoading = false,
  transactions = [],
  onSend,
  onMakeInvoice,
  onCheckPayment,
  onRefresh,
}: WalletDashboardProps) {
  const [modal, setModal] = useState<Modal>('none');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return (
    <div className="space-y-6">
      {/* Balance */}
      <BalanceCard
        lightningMsats={lightningBalanceMsats}
        cashuSats={cashuBalanceSats}
        isLoading={isLoading || refreshing}
        onRefresh={handleRefresh}
      />

      {/* Send / Receive buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setModal('send')}
          className="
            flex flex-col items-center gap-2 p-4 rounded-xl
            bg-[#F7931A] text-black
            hover:bg-[#c46e00] active:scale-95
            transition-all duration-150
            font-medium
          "
          aria-label="Send payment"
        >
          <span className="text-2xl" aria-hidden="true">↑</span>
          <span>Send</span>
        </button>

        <button
          onClick={() => setModal('receive')}
          className="
            flex flex-col items-center gap-2 p-4 rounded-xl
            bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5]
            hover:border-[#F7931A] hover:text-[#F7931A] active:scale-95
            transition-all duration-150
            font-medium
          "
          aria-label="Receive payment"
        >
          <span className="text-2xl" aria-hidden="true">↓</span>
          <span>Receive</span>
        </button>
      </div>

      {/* Quick stats */}
      {transactions.length > 0 && (
        <QuickStats transactions={transactions} />
      )}

      {/* Transaction list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm text-[#a0a0a0] uppercase tracking-widest">
            Activity
          </h3>
        </div>
        <TransactionList
          transactions={transactions}
          isLoading={isLoading}
        />
      </div>

      {/* Send modal */}
      <Modal open={modal === 'send'} onClose={() => setModal('none')}>
        <SendPayment
          balance={lightningBalanceMsats}
          onSend={onSend}
          onClose={() => setModal('none')}
        />
      </Modal>

      {/* Receive modal */}
      <Modal open={modal === 'receive'} onClose={() => setModal('none')}>
        <ReceivePayment
          onMakeInvoice={onMakeInvoice}
          onCheckPayment={onCheckPayment}
          onClose={() => setModal('none')}
        />
      </Modal>
    </div>
  );
}
