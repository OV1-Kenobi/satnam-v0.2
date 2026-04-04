/**
 * Satnam v2 — Auth Page (stub)
 * Phase 1, Week 2: Vault creation, unlock, WebAuthn, passphrase.
 * Phase 1, Week 4: v1 → v2 migration ceremony.
 */

import React from 'react';
import { Helmet } from 'react-helmet-async';

export default function AuthPage() {
  return (
    <>
      <Helmet>
        <title>Satnam — Unlock Vault</title>
        <meta name="description" content="Unlock your sovereign identity vault." />
      </Helmet>
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
        <h1 className="heading-display text-3xl text-[#f7931a]">Vault</h1>
        <p className="text-[#a0a0a0] text-center max-w-sm">
          OPFS Vault unlock UI coming in Phase 1, Week 2.
        </p>
      </main>
    </>
  );
}
