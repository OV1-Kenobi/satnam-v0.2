/**
 * Satnam v2 — Home Page (stub)
 * Phase 1, Week 4: Identity dashboard (kind:0 profile, relay list, NIP-05 status)
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function HomePage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Identity</title>
        <meta name="description" content="Your sovereign Nostr identity dashboard." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-4xl text-[#f7931a]">Satnam</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          Phase 1 in progress. Identity dashboard coming in Week 4.
        </p>
      </main>
    </>
  );
}
