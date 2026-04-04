/**
 * Satnam v2 — Agents Page (stub)
 * Phase 3, Week 9: NIP-SA agent profiles, spend policies, agent wallet.
 * Phase 3, Week 10–11: NIP-SKL skill registry, NIP-AC credit lifecycle.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function AgentsPage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Agents</title>
        <meta name="description" content="NIP-SA sovereign agent management." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-3xl text-[#f7931a]">Agents</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          NIP-SA agent management coming in Phase 3, Week 9.
        </p>
      </main>
    </>
  );
}
