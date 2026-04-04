/**
 * Satnam v2 — Application Entry Point
 * Spec: SATNAM-V2-SPEC-001 § 13 (Phase 1, Week 1)
 *
 * React 18 createRoot with StrictMode.
 *
 * Strict Mode enables:
 *   - Double-invocation of component render functions and hooks in development
 *     to surface side-effects that rely on execution order or singleton state.
 *   - Deprecated API warnings.
 *   - Concurrent mode compatibility checks.
 *
 * It has NO effect in production builds.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles/index.css';

// ── Mount ─────────────────────────────────────────────────────────────────────

const rootElement = document.getElementById('root');

if (!rootElement) {
  // This should never happen given our index.html template, but fail loudly
  // rather than silently if someone removes the root div.
  throw new Error(
    '[Satnam] Fatal: <div id="root"> not found in document. ' +
    'Check index.html — the mount point is required.'
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
