/**
 * Satnam v2 — Wallet Page
 * Phase 2: NWC wallet + Cashu integration.
 *
 * Provides full wallet management:
 * - Balance display (Lightning + Cashu)
 * - Send payments via NWC (NIP-47)
 * - Receive payments (BOLT-11 invoice generation)
 * - Transaction history with filtering
 * - NWC connection management
 */

import React, { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import WalletDashboard from '../components/wallet/WalletDashboard.js';
import type { Transaction } from '../components/wallet/TransactionList.js';

// ---------------------------------------------------------------------------
// Mock data (replaced by real NWC data in production)
// ---------------------------------------------------------------------------

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: '1',
    type: 'lightning',
    direction: 'in',
    status: 'complete',
    amountMsats: 21000000n, // 21,000 sats
    description: 'Coffee ⚡',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    paymentHash: 'a1b2c3d4e5f6' + '00'.repeat(26),
  },
  {
    id: '2',
    type: 'lightning',
    direction: 'out',
    status: 'complete',
    amountMsats: 5000000n, // 5,000 sats
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
    amountMsats: 1000000n, // 1,000 sats
    description: 'Cashu token received',
    timestamp: Math.floor(Date.now() / 1000) - 86400,
  },
  {
    id: '4',
    type: 'lightning',
    direction: 'out',
    status: 'pending',
    amountMsats: 50000000n, // 50,000 sats
    description: 'Pending payment',
    timestamp: Math.floor(Date.now() / 1000) - 300,
  },
];

// ---------------------------------------------------------------------------
// NWC Setup placeholder
// ---------------------------------------------------------------------------

function NwcSetup({ onConnect }: { onConnect: (uri: string) => void }) {
  const [uri, setUri] = useState('');
  const [label, setLabel] = useState('');

  const handleConnect = () => {
    if (!uri.trim().startsWith('nostr+walletconnect://')) return;
    onConnect(uri.trim());
  };

  return (
    <div className="card space-y-6">
      <div>
        <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase mb-2">
          Connect Wallet
        </h3>
        <p className="text-sm text-[#555555]">
          Connect a NIP-47 Nostr Wallet Connect wallet (Alby Hub, PhoenixD, LND, CLN).
        </p>
      </div>

      <div>
        <label htmlFor="nwc-label" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Connection Label
        </label>
        <input
          id="nwc-label"
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="My Alby Hub"
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555]
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
        />
      </div>

      <div>
        <label htmlFor="nwc-uri" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          NWC URI <span className="text-[#F7931A]">*</span>
        </label>
        <textarea
          id="nwc-uri"
          value={uri}
          onChange={e => setUri(e.target.value)}
          placeholder="nostr+walletconnect://..."
          rows={3}
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555] font-mono text-xs
            focus:outline-none focus:border-[#F7931A]
            transition-colors resize-none
          "
          aria-required="true"
        />
        <p className="mt-1 text-xs text-[#555555]">
          Stored encrypted in your local vault. Never transmitted.
        </p>
      </div>

      <button
        onClick={handleConnect}
        disabled={!uri.trim().startsWith('nostr+walletconnect://')}
        className="
          w-full py-3 rounded-lg font-medium
          bg-[#F7931A] text-black
          hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        "
      >
        Connect
      </button>

      {/* Protocol badges */}
      <div>
        <p className="text-xs text-[#555555] mb-2 text-center">Compatible wallets</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {['Alby Hub', 'PhoenixD', 'LND', 'CLN', 'Mutiny'].map(name => (
            <span
              key={name}
              className="text-xs px-2 py-1 rounded-full border border-[#2a2a2a] text-[#555555]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function WalletPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [balance] = useState<bigint>(84000000n); // 84,000 sats in msats
  const [cashuBalance] = useState<number>(1234);
  const [transactions] = useState<Transaction[]>(MOCK_TRANSACTIONS);
  const [isLoading, setIsLoading] = useState(false);

  const handleConnect = useCallback((_uri: string) => {
    // In production: store encrypted URI in vault, establish NWC connection
    setIsConnected(true);
  }, []);

  const handleSend = useCallback(async (bolt11: string) => {
    // In production: call nwcManager.payInvoice(bolt11)
    await new Promise(r => setTimeout(r, 2000)); // Simulate
    return {
      success: true,
      preimage: '00'.repeat(32),
    };
  }, []);

  const handleMakeInvoice = useCallback(async (amountMsats: bigint, description: string) => {
    // In production: call nwcManager.makeInvoice(amountMsats, description)
    await new Promise(r => setTimeout(r, 1000));
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
    await new Promise(r => setTimeout(r, 1000));
    setIsLoading(false);
  }, []);

  return (
    <>
      <Helmet>
        <title>Satnam — Wallet</title>
        <meta name="description" content="Lightning and Cashu wallet management." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="font-display text-2xl text-[#F7931A] tracking-wider uppercase">
              Wallet
            </h1>
            {isConnected && (
              <div className="flex items-center gap-1.5 text-xs text-green-500">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                Connected
              </div>
            )}
          </div>

          {!isConnected ? (
            <NwcSetup onConnect={handleConnect} />
          ) : (
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
          )}
        </div>
      </main>
    </>
  );
}
