/**
 * Satnam v2 — Wallet Page (stub)
 * Phase 2, Week 7–8: NWC connection manager, Cashu client, BOLT-11 invoices.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function WalletPage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Wallet</title>
        <meta name="description" content="Lightning and Cashu wallet via NWC." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-3xl text-[#f7931a]">Wallet</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          NWC wallet + Cashu coming in Phase 2, Week 7–8.
        </p>
      </main>
    </>
  );
}
