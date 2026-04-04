/**
 * Satnam v2 — Marketplace Page (stub)
 * Phase 3, Week 12: NIP-90 DVM marketplace (job requests, results, payments).
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function MarketplacePage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Marketplace</title>
        <meta name="description" content="NIP-90 DVM agent marketplace." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-3xl text-[#f7931a]">Marketplace</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          NIP-90 DVM marketplace coming in Phase 3, Week 12.
        </p>
      </main>
    </>
  );
}
