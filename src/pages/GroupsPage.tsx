/**
 * Satnam v2 — Groups Page (stub)
 * Phase 2, Week 5–6: FROST DKG ceremony, NIP-26 delegation graph.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function GroupsPage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Groups</title>
        <meta name="description" content="FROST threshold group key management." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-3xl text-[#f7931a]">Groups</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          FROST group management coming in Phase 2, Week 5.
        </p>
      </main>
    </>
  );
}
