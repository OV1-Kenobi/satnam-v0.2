/**
 * Satnam v2 — Application Shell
 * Spec: SATNAM-V2-SPEC-001 § 13 (Phase 1)
 *
 * Root component that wires together:
 *   - React Router (lazy-loaded page routes)
 *   - HelmetProvider (PWA meta tags per-route)
 *   - VaultProvider (OPFS vault context — unlocked/locked state)
 *
 * Routes map to the six top-level product areas:
 *   /            → Dashboard / home (identity summary)
 *   /auth        → Identity creation, import, migration from v1
 *   /groups      → FROST group management (Phase 2)
 *   /wallet      → NWC wallet + Cashu (Phase 2)
 *   /agents      → NIP-SA agent management (Phase 3)
 *   /marketplace → NIP-90 DVM marketplace (Phase 3)
 */

import React, { Suspense, lazy } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

import { VaultProvider, useVault } from './hooks/useVault';

// ── Lazy-loaded route components ──────────────────────────────────────────────
//
// Each page is a separate code-split chunk. Vite automatically splits on
// dynamic imports. Pages are stub placeholders until Phase 1 implementation.

const HomePage           = lazy(() => import('./pages/HomePage'));
const AuthPage           = lazy(() => import('./pages/AuthPage'));
const GroupsPage         = lazy(() => import('./pages/GroupsPage'));
const WalletPage         = lazy(() => import('./pages/WalletPage'));
const AgentsPage         = lazy(() => import('./pages/AgentsPage'));
const MarketplacePage    = lazy(() => import('./pages/MarketplacePage'));
const CircleOfTrustPage  = lazy(() => import('./pages/CircleOfTrustPage'));
const NotFoundPage       = lazy(() => import('./pages/NotFoundPage'));

// ── Loading fallback ──────────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="flex min-h-screen items-center justify-center bg-[#0a0a0a]"
    >
      <div className="flex flex-col items-center gap-4">
        {/* Animated Bitcoin-orange ring */}
        <div
          className="h-10 w-10 rounded-full border-2 border-[#2a2a2a] border-t-[#f7931a] animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm text-[#555555] font-mono">Loading…</p>
      </div>
    </div>
  );
}

// ── Protected route wrapper ───────────────────────────────────────────────────
//
// Routes inside <ProtectedLayout> require the vault to be unlocked.
// If locked, the user is redirected to /auth for unlock/creation.
//
// Phase 1: Vault unlock lives at /auth. Once vault is unlocked the user
// is redirected to their originally requested route.

function ProtectedLayout() {
  const { isUnlocked } = useVault();

  if (!isUnlocked) {
    return <Navigate to="/auth" replace />;
  }

  return <Outlet />;
}

// ── Router ────────────────────────────────────────────────────────────────────

function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* ── Public routes ─────────────────────────────────────────── */}
          {/* /auth is always accessible — vault creation / unlock / migration */}
          <Route path="/auth" element={<AuthPage />} />

          {/* ── Protected routes ──────────────────────────────────────── */}
          {/* All require an unlocked OPFS vault */}
          <Route element={<ProtectedLayout />}>
            <Route path="/"            element={<HomePage />} />
            <Route path="/circle"      element={<CircleOfTrustPage />} />
            <Route path="/groups"      element={<GroupsPage />} />
            <Route path="/wallet"      element={<WalletPage />} />
            <Route path="/agents"      element={<AgentsPage />} />
            <Route path="/marketplace" element={<MarketplacePage />} />
          </Route>

          {/* ── 404 ───────────────────────────────────────────────────── */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

/**
 * App is the composition root. Provider order matters:
 *
 *   HelmetProvider   → manages <head> per-route (outermost, context-free)
 *   └─ VaultProvider → OPFS vault state (required by all protected routes)
 *      └─ AppRouter  → React Router with lazy routes
 *
 * No other global providers are added here until needed. Each feature
 * (NWC, FROST, relay pool) owns its own context scoped to the routes
 * that use it.
 */
export function App() {
  return (
    <HelmetProvider>
      <VaultProvider>
        <AppRouter />
      </VaultProvider>
    </HelmetProvider>
  );
}

export default App;
