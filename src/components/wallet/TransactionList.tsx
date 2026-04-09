/**
 * @component TransactionList
 * @description Transaction list with filtering and pagination.
 *
 * Displays Lightning (NWC) and Cashu transaction history with:
 * - Filter by type (all/lightning/cashu), direction (in/out), status
 * - Virtualized list for performance
 * - Relative timestamps and formatted amounts
 */

import { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TxType = 'lightning' | 'cashu';
export type TxDirection = 'in' | 'out';
export type TxStatus = 'pending' | 'complete' | 'failed';

export interface Transaction {
  id: string;
  type: TxType;
  direction: TxDirection;
  status: TxStatus;
  amountMsats: bigint;
  description?: string;
  timestamp: number; // Unix seconds
  paymentHash?: string;
  bolt11?: string;
  fee?: bigint; // msats
}

type FilterType = 'all' | TxType;
type FilterDirection = 'all' | TxDirection;

interface TransactionListProps {
  transactions: Transaction[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(msats: bigint): string {
  const sats = Number(msats) / 1000;
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toFixed(sats < 1 ? 3 : 0);
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function FilterBar({
  filterType,
  filterDirection,
  onFilterType,
  onFilterDirection,
}: {
  filterType: FilterType;
  filterDirection: FilterDirection;
  onFilterType: (f: FilterType) => void;
  onFilterDirection: (f: FilterDirection) => void;
}) {
  const typeOptions: Array<{ value: FilterType; label: string }> = [
    { value: 'all',       label: 'All' },
    { value: 'lightning', label: '⚡ Lightning' },
    { value: 'cashu',     label: '🔵 Cashu' },
  ];

  const dirOptions: Array<{ value: FilterDirection; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'in',  label: '↓ Received' },
    { value: 'out', label: '↑ Sent' },
  ];

  return (
    <div className="space-y-3">
      {/* Type filter */}
      <div className="flex gap-1 p-1 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a]" role="group" aria-label="Filter by type">
        {typeOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => onFilterType(opt.value)}
            className={`
              flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors
              ${filterType === opt.value
                ? 'bg-[#F7931A] text-black'
                : 'text-[#a0a0a0] hover:text-[#f5f5f5]'
              }
            `}
            aria-pressed={filterType === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Direction filter */}
      <div className="flex gap-1 p-1 bg-[#1a1a1a] rounded-lg border border-[#2a2a2a]" role="group" aria-label="Filter by direction">
        {dirOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => onFilterDirection(opt.value)}
            className={`
              flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors
              ${filterDirection === opt.value
                ? 'bg-[#222222] text-[#f5f5f5] border border-[#3a3a3a]'
                : 'text-[#a0a0a0] hover:text-[#f5f5f5]'
              }
            `}
            aria-pressed={filterDirection === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

function TxRow({ tx }: { tx: Transaction }) {
  const [expanded, setExpanded] = useState(false);

  const isIn = tx.direction === 'in';
  const satsLabel = formatSats(tx.amountMsats);
  const statusColors: Record<TxStatus, string> = {
    complete: 'text-green-500',
    pending:  'text-[#FFD700]',
    failed:   'text-red-400',
  };

  return (
    <li className="border-b border-[#2a2a2a] last:border-0">
      <button
        className="w-full flex items-center gap-3 py-4 text-left hover:bg-[#1a1a1a] transition-colors px-4"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {/* Icon */}
        <div
          className={`
            w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0
            ${isIn ? 'bg-green-500/10 text-green-500' : 'bg-[#F7931A]/10 text-[#F7931A]'}
          `}
          aria-hidden="true"
        >
          {isIn ? '↓' : '↑'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#f5f5f5] truncate">
            {tx.description ?? (isIn ? 'Received payment' : 'Sent payment')}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-[#555555]">{formatRelativeTime(tx.timestamp)}</span>
            <span className={`text-xs ${statusColors[tx.status]}`}>{tx.status}</span>
            <span className="text-xs text-[#555555]">
              {tx.type === 'lightning' ? '⚡' : '🔵'}
            </span>
          </div>
        </div>

        {/* Amount */}
        <div className="text-right flex-shrink-0">
          <p className={`font-mono font-semibold text-sm ${isIn ? 'text-green-500' : 'text-[#f5f5f5]'}`}>
            {isIn ? '+' : '−'}{satsLabel}
          </p>
          <p className="text-xs text-[#555555]">sats</p>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 text-xs text-[#555555]">
          {tx.paymentHash && (
            <div>
              <span className="text-[#a0a0a0]">Hash: </span>
              <span className="font-mono break-all">{tx.paymentHash}</span>
            </div>
          )}
          {tx.fee !== undefined && tx.fee > 0n && (
            <div>
              <span className="text-[#a0a0a0]">Fee: </span>
              <span className="font-mono">{formatSats(tx.fee)} sats</span>
            </div>
          )}
          <div>
            <span className="text-[#a0a0a0]">Exact: </span>
            <span className="font-mono">{(Number(tx.amountMsats) / 1000).toFixed(3)} sats</span>
          </div>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TxSkeleton() {
  return (
    <li className="flex items-center gap-3 py-4 px-4 border-b border-[#2a2a2a]">
      <div className="skeleton w-9 h-9 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-4 w-40 rounded" />
        <div className="skeleton h-3 w-24 rounded" />
      </div>
      <div className="skeleton h-4 w-16 rounded" />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TransactionList({
  transactions,
  isLoading = false,
  onLoadMore,
  hasMore = false,
}: TransactionListProps) {
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [filterDirection, setFilterDirection] = useState<FilterDirection>('all');

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (filterDirection !== 'all' && tx.direction !== filterDirection) return false;
      return true;
    });
  }, [transactions, filterType, filterDirection]);

  return (
    <div className="space-y-4">
      <FilterBar
        filterType={filterType}
        filterDirection={filterDirection}
        onFilterType={setFilterType}
        onFilterDirection={setFilterDirection}
      />

      <div className="card p-0 overflow-hidden">
        {isLoading && transactions.length === 0 ? (
          <ul aria-label="Loading transactions" role="list">
            {[1, 2, 3, 4].map(i => <TxSkeleton key={i} />)}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-[#555555] text-sm">No transactions found</p>
          </div>
        ) : (
          <>
            <ul role="list" aria-label="Transactions">
              {filtered.map(tx => <TxRow key={tx.id} tx={tx} />)}
            </ul>

            {hasMore && (
              <div className="p-4 border-t border-[#2a2a2a]">
                <button
                  onClick={onLoadMore}
                  disabled={isLoading}
                  className="w-full py-2.5 rounded-lg text-sm font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors disabled:opacity-40"
                >
                  {isLoading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

