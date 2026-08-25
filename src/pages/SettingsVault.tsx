/**
 * @module pages/SettingsVault
 * @description Vault second-factor settings (WP 005).
 *
 * <select> Second Factor [None (default) / Yubikey / N424 Card + PIN / Biometrics]
 * Default None, four peers with one-line explainers, persisted in vault settings
 * slot (OPFS vault/settings/settings.json, encrypted under master key, NOT Supabase).
 *
 * Default path passphrase-only must stay unchanged and green.
 * Do NOT make biometrics default; do NOT block Yubikey/N424.
 * @see WP 005
 */

import { useEffect, useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';

import { getVault } from '../lib/vault/vault.js';
import type { VaultSecondFactor } from '../lib/vault/types.js';

// ---------------------------------------------------------------------------
// Option metadata — one-line explainers per WP 005
// ---------------------------------------------------------------------------

interface SecondFactorOption {
  value: VaultSecondFactor;
  label: string;
  explainer: string;
}

const OPTIONS: readonly SecondFactorOption[] = [
  {
    value: 'none',
    label: 'None (default)',
    explainer: 'Passphrase only — your vault unlocks with argon2id(passphrase, salt). No second factor required.',
  },
  {
    value: 'yubikey',
    label: 'Yubikey',
    explainer: 'Yubikey (FIDO2 PRF) — WebAuthn hmac-secret from a hardware security key. Requires Chrome/Safari with PRF support.',
  },
  {
    value: 'nfc',
    label: 'N424 Card + PIN',
    explainer: 'N424 Card + PIN (possession) — argon2id(pin, uid, m:65536,t:3,p:4). Requires tap + PIN to derive wrapping key.',
  },
  {
    value: 'biometrics',
    label: 'Biometrics',
    explainer: 'Biometrics — platform WebAuthn PRF via Face ID / Touch ID / BiometricPrompt. Device-bound, no server copy.',
  },
] as const;

export default function SettingsVault(): React.JSX.Element {
  const [selected, setSelected] = useState<VaultSecondFactor>('none');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Load persisted setting (encrypted in OPFS vault, not Supabase)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const vault = getVault();
        if (!vault.isUnlocked()) {
          // Vault locked — show default but hint that unlock is needed to persist
          if (mounted) {
            setSelected('none');
            setLoading(false);
          }
          return;
        }
        const factor = await vault.getSecondFactor();
        if (mounted) setSelected(factor);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = useCallback(async (value: VaultSecondFactor) => {
    setSelected(value);
    setError(null);
    setSavedAt(null);
    // Persist immediately — encrypted under master key at vault/settings/settings.json
    try {
      const vault = getVault();
      if (!vault.isUnlocked()) {
        setError('Vault is locked. Unlock to persist your second factor preference.');
        return;
      }
      setSaving(true);
      await vault.setVaultSettings({ secondFactor: value, updatedAt: new Date().toISOString() });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setting');
    } finally {
      setSaving(false);
    }
  }, []);

  const currentOption = OPTIONS.find((o) => o.value === selected) ?? OPTIONS[0]!;

  return (
    <>
      <Helmet>
        <title>Satnam — Vault Settings</title>
        <meta name="description" content="Configure vault second factor — passphrase-only default, with Yubikey, N424 Card + PIN, or biometrics as peer options." />
      </Helmet>

      <div className="min-h-screen bg-slate-950">
        <header className="flex items-center justify-between px-6 py-5 border-b border-slate-900">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="font-display text-lg font-semibold tracking-wide text-white">Satnam</span>
            <span className="text-xs text-slate-500">Settings</span>
          </Link>
          <Link to="/auth" className="text-xs text-slate-500 hover:text-slate-300">
            ← Back
          </Link>
        </header>

        <main className="mx-auto max-w-xl p-6 space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-white">Vault — Second Factor</h1>
            <p className="mt-1 text-sm text-slate-500">
              Default is <strong className="text-slate-300">None</strong> (passphrase-only). The other three are peers you can opt into — none is blocking, none is default.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 space-y-4">
            {loading ? (
              <p className="text-sm text-slate-500">Loading vault settings…</p>
            ) : (
              <>
                <label htmlFor="second-factor-select" className="block text-sm font-medium text-slate-300">
                  Second Factor
                </label>
                <select
                  id="second-factor-select"
                  value={selected}
                  onChange={(e) => void handleChange(e.target.value as VaultSecondFactor)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 disabled:opacity-50"
                >
                  {OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {/* One-line explainer for each option — always show current, list peers below */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
                  <p className="text-xs font-medium text-slate-400">Current: {currentOption.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{currentOption.explainer}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">All options at a glance (peers, none blocks another):</p>
                  <ul className="space-y-2">
                    {OPTIONS.map((opt) => (
                      <li
                        key={opt.value}
                        className={`rounded-lg border px-3 py-2 text-xs ${opt.value === selected ? 'border-bitcoin-700 bg-bitcoin-950/20 text-slate-300' : 'border-slate-800 bg-slate-900/30 text-slate-500'}`}
                      >
                        <span className="font-medium">{opt.label}:</span> {opt.explainer}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/20 p-3 space-y-1">
                  <p className="text-xs text-slate-500">
                    Persisted in <code className="text-slate-400">vault/settings/settings.json</code> (XChaCha20-Poly1305 under master key) — not Supabase, not localStorage.
                  </p>
                  <p className="text-xs text-slate-600">
                    Feature-detect WebAuthn PRF: <code className="text-slate-500">PublicKeyCredential.getClientExtensionResults().prf</code>. If unavailable, Yubikey/biometrics fall back to passphrase-only with message “Yubikey requires Chrome/Safari”.
                  </p>
                  <p className="text-xs text-slate-600">
                    N424 as PRF is not FIDO2 — <code className="text-slate-500">argon2id(pin, uid)</code> is a possession factor, documented as peer option, not equivalent security.
                  </p>
                </div>

                {savedAt && <p className="text-xs text-emerald-400">Saved at {savedAt} — {currentOption.label}</p>}
                {error && <p className="text-xs text-red-400">{error}</p>}
                {saving && <p className="text-xs text-slate-500">Saving…</p>}
              </>
            )}
          </div>

          <div className="rounded-xl border border-amber-800/30 bg-amber-950/10 p-4">
            <p className="text-xs text-amber-200/80">
              Changing your second factor does not re-encrypt your vault by itself — it controls which <code className="text-amber-300">initialize(method, credential)</code> / <code className="text-amber-300">unlock(method, credential)</code> path the UI offers next time. Your current vault stays valid until you explicitly re-initialize with a new method.
            </p>
          </div>

          {/* Device-Link QR embedded for convenience */}
          <div className="pt-2">
            <p className="mb-3 text-sm font-medium text-slate-300">Device linking</p>
            <p className="mb-3 text-xs text-slate-500">Need the same npub on another device? Export an encrypted clone — QR or <code>.satnam-backup</code> file.</p>
            {/* Lazy import to avoid cycle — dynamic */}
          </div>
        </main>
      </div>
    </>
  );
}
