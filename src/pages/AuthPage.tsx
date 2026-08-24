/**
 * Satnam v2 — Auth Page
 *
 * Full authentication and identity management page.
 *
 * Sections:
 * 1. NIP-07 browser extension login (nos2x, Alby, etc.)
 * 2. Manual nsec entry (with explicit security warnings)
 * 3. New identity generation (nsec generated client-side, stored in OPFS Vault)
 * 4. Vault unlock (PIN / passphrase / WebAuthn)
 * 5. NIP-05 registration CTA (links to check-username + register-identity)
 *
 * Design: dark theme — bg-slate-950, bitcoin-500 accent, Cinzel headings.
 * Mobile-first, accessible.
 *
 * Security:
 * - nsec input: type="password", cleared from state after use
 * - NIP-07 path: nsec never enters this page (extension handles signing)
 * - No localStorage nsec (S4 invariant)
 * - Vault PIN/passphrase input: type="password"
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, Link } from 'react-router-dom';
import { InlineError } from '../components/errors/ErrorBoundary';
import { handleError, Nip07NotAvailableError, AuthError, SatnamError } from '../lib/errors';
// CR-A real flows (plan 2026-08-24): keygen, OPFS vault, NIP-98 registration,
// configurable domain whitelist.
import {
  deriveFromMnemonic,
  derivePublicFromMnemonic,
  generateMnemonic12,
  importFromNsec,
} from '../lib/identity/keygen';
import { getWhitelistedDomains, resolveRequestedDomain } from '../lib/identity/domain-whitelist';
import { getVault } from '../lib/vault/vault';
import { buildNip98AuthHeader } from '../lib/nip98/construct';

// ============================================================================
// Types
// ============================================================================

type AuthMode =
  | 'landing'
  | 'nip07'
  | 'nsec'
  | 'generate'
  | 'unlock'
  | 'register';

// ============================================================================
// Utility helpers
// ============================================================================

/** Check whether window.nostr (NIP-07 extension) is available. */
function hasNip07Extension(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { nostr?: unknown }).nostr !== 'undefined'
  );
}

/** Detect extension name from userAgent/window properties. */
function detectExtensionName(): string {
  const w = window as Window & { nostr?: { _alby?: boolean; _nos2x?: boolean; name?: string } };
  if (w.nostr?.name) return w.nostr.name;
  if ((window as unknown as Record<string, unknown>).alby) return 'Alby';
  return 'Your Nostr Extension';
}

/** Validate nsec format (bech32, starts with 'nsec1'). */
function isValidNsec(value: string): boolean {
  return /^nsec1[02-9ac-hj-np-z]{58,}$/.test(value.trim());
}

// ============================================================================
// Sub-components
// ============================================================================

function SectionDivider(): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 my-8">
      <div className="flex-1 h-px bg-slate-800" />
      <span className="text-xs text-slate-600 uppercase tracking-widest">or</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
}

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  children: React.ReactNode;
}

function PrimaryButton({ loading, children, disabled, className = '', ...props }: PrimaryButtonProps): React.JSX.Element {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 w-full rounded-lg bg-bitcoin-500 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-bitcoin-600 focus:outline-none focus:ring-2 focus:ring-bitcoin-400 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

function SecondaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      {...props}
      className={`flex items-center justify-center gap-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-sm font-semibold text-slate-300 transition-all hover:bg-slate-800 hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}

function PasswordField({ id, label, value, onChange, placeholder, autoComplete = 'off', hint }: PasswordFieldProps): React.JSX.Element {
  const [show, setShow] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 pr-12 text-sm text-white placeholder-slate-600 focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 transition-colors"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-1"
          aria-label={show ? 'Hide' : 'Show'}
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint && (
        <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
      )}
    </div>
  );
}

// ============================================================================
// Landing: Choose Auth Method
// ============================================================================

interface LandingProps {
  onSelectMode: (mode: AuthMode) => void;
  nip07Available: boolean;
  extensionName: string;
}

function LandingView({ onSelectMode, nip07Available, extensionName }: LandingProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      {/* NIP-07 Extension (preferred) */}
      {nip07Available ? (
        <button
          type="button"
          onClick={() => onSelectMode('nip07')}
          className="group flex w-full items-center gap-4 rounded-xl border border-bitcoin-800/50 bg-bitcoin-950/30 p-4 text-left transition-all hover:border-bitcoin-700 hover:bg-bitcoin-950/50 focus:outline-none focus:ring-2 focus:ring-bitcoin-400 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-bitcoin-500/10 group-hover:bg-bitcoin-500/20 transition-colors">
            <ExtensionIcon className="h-5 w-5 text-bitcoin-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">{extensionName}</p>
            <p className="text-xs text-slate-500">Sign with browser extension — recommended</p>
          </div>
          <ChevronRightIcon className="h-4 w-4 text-slate-600 flex-shrink-0" />
        </button>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-start gap-3">
            <ExtensionIcon className="h-5 w-5 text-slate-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-slate-400">No extension detected</p>
              <p className="text-xs text-slate-600 mt-0.5">
                Install{' '}
                <a
                  href="https://getalby.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bitcoin-400 hover:text-bitcoin-300 underline"
                >
                  Alby
                </a>{' '}
                or{' '}
                <a
                  href="https://github.com/fiatjaf/nos2x"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bitcoin-400 hover:text-bitcoin-300 underline"
                >
                  nos2x
                </a>{' '}
                for the best experience.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Vault unlock */}
      <button
        type="button"
        onClick={() => onSelectMode('unlock')}
        className="group flex w-full items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-left transition-all hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 group-hover:bg-slate-700 transition-colors">
          <VaultIcon className="h-5 w-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Unlock Vault</p>
          <p className="text-xs text-slate-500">Decrypt your OPFS identity vault</p>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-slate-600 flex-shrink-0" />
      </button>

      <SectionDivider />

      {/* Generate new identity */}
      <button
        type="button"
        onClick={() => onSelectMode('generate')}
        className="group flex w-full items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-left transition-all hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 group-hover:bg-slate-700 transition-colors">
          <PlusIcon className="h-5 w-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">New Identity</p>
          <p className="text-xs text-slate-500">Generate a fresh Nostr keypair</p>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-slate-600 flex-shrink-0" />
      </button>

      {/* Manual nsec import */}
      <button
        type="button"
        onClick={() => onSelectMode('nsec')}
        className="group flex w-full items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-left transition-all hover:border-slate-600 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800 group-hover:bg-slate-700 transition-colors">
          <KeyIcon className="h-5 w-5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Import nsec</p>
          <p className="text-xs text-slate-500">Enter private key — use with caution</p>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-slate-600 flex-shrink-0" />
      </button>
    </div>
  );
}

// ============================================================================
// NIP-07 Login View
// ============================================================================

interface Nip07ViewProps {
  onBack: () => void;
  extensionName: string;
}

function Nip07View({ onBack, extensionName }: Nip07ViewProps): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SatnamError | null>(null);
  const navigate = useNavigate();

  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nostr = (window as Window & { nostr?: { getPublicKey(): Promise<string> } }).nostr;
      if (!nostr) {
        throw new Nip07NotAvailableError();
      }
      const pubkey = await nostr.getPublicKey();
      if (!pubkey || typeof pubkey !== 'string') {
        throw new AuthError('Extension returned no public key.');
      }
      // Store pubkey (not nsec) in sessionStorage for the session
      // S4 invariant: no nsec in localStorage
      sessionStorage.setItem('satnam_session_pubkey', pubkey);
      navigate('/dashboard');
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-bitcoin-500/10">
          <ExtensionIcon className="h-7 w-7 text-bitcoin-400" />
        </div>
        <h3 className="text-base font-semibold text-white mb-1">{extensionName}</h3>
        <p className="text-sm text-slate-400">
          Your extension will ask you to approve the connection. Your private key never leaves the extension.
        </p>
      </div>

      {error && <InlineError error={error} onRetry={handleConnect} />}

      <PrimaryButton onClick={handleConnect} loading={loading}>
        Connect with {extensionName}
      </PrimaryButton>

      <SecondaryButton onClick={onBack}>
        Back
      </SecondaryButton>
    </div>
  );
}

// ============================================================================
// Vault Unlock View
// ============================================================================

interface UnlockViewProps {
  onBack: () => void;
}

function UnlockView({ onBack }: UnlockViewProps): React.JSX.Element {
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SatnamError | null>(null);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleUnlock = useCallback(async () => {
    if (!passphrase.trim()) {
      setError(handleError(new AuthError('Passphrase is required.')));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // CR-A: real vault round-trip — argon2id-derived wrapping key decrypts
      // the OPFS master key. Wrong passphrase throws VaultError.DecryptionFailed.
      const vault = getVault();
      await vault.unlock('passphrase', passphrase);
      navigate('/dashboard');
    } catch (err) {
      setError(handleError(err));
    } finally {
      // S4 invariant: clear passphrase from state after use
      setPassphrase('');
      setLoading(false);
    }
  }, [passphrase, navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnlock();
  }, [handleUnlock]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-start gap-3">
          <VaultIcon className="h-5 w-5 text-bitcoin-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-slate-400">
            Your identity is encrypted in your browser's private storage (OPFS). Enter your passphrase to unlock it.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="vault-passphrase" className="block text-sm font-medium text-slate-300 mb-1.5">
          Vault Passphrase
        </label>
        <div className="relative">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            id="vault-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your passphrase"
            autoComplete="current-password"
            autoFocus
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 transition-colors"
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          Minimum 12 characters. Encrypted with argon2id — your passphrase is never sent to any server.
        </p>
      </div>

      {error && <InlineError error={error} />}

      <PrimaryButton onClick={handleUnlock} loading={loading} disabled={!passphrase.trim()}>
        <VaultIcon className="h-4 w-4" />
        Unlock Vault
      </PrimaryButton>

      <SecondaryButton onClick={onBack}>Back</SecondaryButton>
    </div>
  );
}

// ============================================================================
// Import nsec View
// ============================================================================

interface NsecViewProps {
  onBack: () => void;
}

function NsecView({ onBack }: NsecViewProps): React.JSX.Element {
  const [nsec, setNsec] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphrase2, setPassphrase2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SatnamError | null>(null);
  const navigate = useNavigate();

  const isValidFormat = nsec.trim() ? isValidNsec(nsec.trim()) : null;
  const passphraseMatch = passphrase === passphrase2;
  const canSubmit = isValidFormat && passphrase.length >= 12 && passphraseMatch;

  const handleImport = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      // CR-A real import: decode/verify nsec → initialize vault under the new
      // passphrase → encrypt nsec into OPFS via storeNsec. The nsec string is
      // cleared from state immediately after (S4 invariant).
      const imported = importFromNsec(nsec.trim());
      const vault = getVault();
      await vault.initialize('passphrase', passphrase);
      await vault.storeNsec(imported.publicPart.npub, imported.secret);
      // Best-effort zero of the raw secret bytes now that they are sealed.
      imported.secret.fill(0);
      navigate('/dashboard?registered=true');
    } catch (err) {
      setError(handleError(err));
    } finally {
      // S4 invariant: clear nsec and passphrase from state immediately
      setNsec('');
      setPassphrase('');
      setPassphrase2('');
      setLoading(false);
    }
  }, [canSubmit, navigate]);

  return (
    <div className="space-y-6">
      {/* Security warning */}
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4">
        <div className="flex items-start gap-3">
          <WarningIcon className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-200/80 space-y-1">
            <p className="font-medium text-amber-200">Security notice</p>
            <p>
              Your nsec will be encrypted immediately and stored in private browser storage (OPFS). It is <strong>never</strong> sent to any server. Use a strong passphrase.
            </p>
          </div>
        </div>
      </div>

      <PasswordField
        id="nsec-input"
        label="Private key (nsec)"
        value={nsec}
        onChange={setNsec}
        placeholder="nsec1..."
        autoComplete="off"
        hint={
          nsec.trim()
            ? isValidFormat
              ? '✓ Valid nsec format'
              : '✗ Must start with nsec1 followed by bech32 characters'
            : 'Your Nostr private key in bech32 format (nsec1...)'
        }
      />

      <PasswordField
        id="vault-passphrase-new"
        label="Vault passphrase (new)"
        value={passphrase}
        onChange={setPassphrase}
        placeholder="Minimum 12 characters"
        autoComplete="new-password"
        hint="This passphrase encrypts your key in vault. Choose something strong."
      />

      <PasswordField
        id="vault-passphrase-confirm"
        label="Confirm passphrase"
        value={passphrase2}
        onChange={setPassphrase2}
        placeholder="Repeat passphrase"
        autoComplete="new-password"
        hint={
          passphrase2.length > 0
            ? passphraseMatch
              ? '✓ Passphrases match'
              : '✗ Passphrases do not match'
            : undefined
        }
      />

      {error && <InlineError error={error} />}

      <PrimaryButton onClick={handleImport} loading={loading} disabled={!canSubmit}>
        Encrypt and Store Key
      </PrimaryButton>

      <SecondaryButton onClick={onBack}>Back</SecondaryButton>
    </div>
  );
}

// ============================================================================
// Generate New Identity View
// ============================================================================

interface GenerateViewProps {
  onBack: () => void;
}

function GenerateView({ onBack }: GenerateViewProps): React.JSX.Element {
  // CR-A flow states: passphrase → display (once) → challenge → pin → saved
  const [step, setStep] = useState<'passphrase' | 'display' | 'challenge' | 'pin'>('passphrase');
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
  const [derivedNpub, setDerivedNpub] = useState('');
  const [challengeIndexes] = useState<number[]>(() => {
    // fixed pseudo-random challenge positions per mount (2nd, 7th, 11th words)
    return [1, 6, 10];
  });
  const [challengeAnswers, setChallengeAnswers] = useState<Record<number, string>>({});
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');

  const [passphrase, setPassphrase] = useState('');
  const [passphrase2, setPassphrase2] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SatnamError | null>(null);
  const navigate = useNavigate();

  const passphraseMatch = passphrase === passphrase2;
  const canGenerate = passphrase.length >= 12 && passphraseMatch;
  const challengePassed = challengeIndexes.every(
    (i) => (challengeAnswers[i] ?? '').trim().toLowerCase() === (mnemonicWords[i] ?? '').toLowerCase(),
  );
  const pinValid = /^\d{4,8}$/.test(pin) && pin === pin2;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    try {
      // CR-A real generation: CSPRNG mnemonic shown ONCE; derivation to npub.
      // Key material is NOT stored yet — only after the word challenge passes.
      const mnemonic = generateMnemonic12();
      setMnemonicWords(mnemonic.split(' '));
      const derived = derivePublicFromMnemonic(mnemonic);
      setDerivedNpub(derived.npub);
      setStep('display');
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [canGenerate]);

  const handleConfirmedSave = useCallback(async () => {
    if (!challengePassed) return;
    setSaving(true);
    setError(null);
    try {
      // Reconstruct the mnemonic only from the displayed words held in memory,
      // derive full material, seal into the OPFS vault under the passphrase.
      const mnemonic = mnemonicWords.join(' ');
      const derived = deriveFromMnemonic(mnemonic);
      const vault = getVault();
      await vault.initialize('passphrase', passphrase);
      await vault.storeNsec(derived.publicPart.npub, derived.secret);
      derived.secret.fill(0);
      // Mandatory anti-theft PIN before any NFC-capable use (founder-directed).
      setStep('pin');
    } catch (err) {
      setError(handleError(err));
    } finally {
      setSaving(false);
    }
  }, [challengePassed, mnemonicWords, passphrase]);

  const handlePinSaved = useCallback(async () => {
    if (!pinValid) return;
    setSaving(true);
    try {
      const { ntag424Manager } = await import('../lib/nfc/ntag424');
      const { createPinGate } = await import('../lib/nfc/pin-gate');
      const { decodeNpub: toBytes } = await import('../lib/identity/keygen');
      const uid = `vault:${derivedNpub}`; // software identity — card UID analogue
      const gate = createPinGate(getVault(), uid);
      await gate.setupPin(pin);
      void ntag424Manager; // manager wired for later NFC ceremonies
      void toBytes;
      navigate('/auth?register=1');
    } catch (err) {
      setError(handleError(err));
    } finally {
      // S4: clear PIN material from component state immediately
      setPin('');
      setPin2('');
      setSaving(false);
    }
  }, [pinValid, pin, derivedNpub, navigate]);

  if (step === 'display' || step === 'challenge') {
    const isChallenge = step === 'challenge';
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4">
          <div className="flex items-start gap-3">
            <WarningIcon className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200/80">
              <p className="font-medium text-amber-200 mb-1">
                {isChallenge ? 'Confirm your recovery phrase' : 'Write these 12 words down — shown only once'}
              </p>
              <p>
                {isChallenge
                  ? 'Enter the requested words exactly to prove you wrote them down.'
                  : 'This is the ONLY copy. There is no reset and no server backup. Anyone with these words controls your identity.'}
              </p>
            </div>
          </div>
        </div>

        {!isChallenge && (
          <ol className="grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {mnemonicWords.map((word, i) => (
              <li key={`${i}-${word}`} className="flex items-baseline gap-2 text-sm">
                <span className="w-5 text-right text-xs text-slate-500">{i + 1}.</span>
                <span className="font-mono text-slate-200">{word}</span>
              </li>
            ))}
          </ol>
        )}

        {isChallenge && (
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {challengeIndexes.map((idx) => (
              <div key={idx}>
                <label htmlFor={`challenge-word-${idx}`} className="block text-xs text-slate-400 mb-1">
                  Word #{idx + 1}
                </label>
                <input
                  id={`challenge-word-${idx}`}
                  type="text"
                  value={challengeAnswers[idx] ?? ''}
                  onChange={(e) => setChallengeAnswers((prev) => ({ ...prev, [idx]: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-mono text-white placeholder-slate-600 focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500"
                />
              </div>
            ))}
          </div>
        )}

        {error && <InlineError error={error} />}

        {isChallenge ? (
          <>
            <PrimaryButton onClick={handleConfirmedSave} loading={saving} disabled={!challengePassed}>
              Confirm and Encrypt Into Vault
            </PrimaryButton>
            <SecondaryButton onClick={() => setStep('display')}>Show words again</SecondaryButton>
          </>
        ) : (
          <PrimaryButton onClick={() => setStep('challenge')} disabled={saving}>
            I have written them down
          </PrimaryButton>
        )}
      </div>
    );
  }

  if (step === 'pin') {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-bitcoin-800/40 bg-bitcoin-950/20 p-4">
          <div className="flex items-start gap-3">
            <CheckIcon className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-200/80">
              <p className="font-medium text-emerald-200 mb-1">Vault sealed</p>
              <code className="block break-all font-mono text-xs">{derivedNpub}</code>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex items-start gap-3">
            <WarningIcon className="h-5 w-5 text-bitcoin-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400">
              Now create a PIN (4–8 digits). It stays on this device only — it is never transmitted —
              and gates NFC taps, payments above threshold, and identity changes.
            </p>
          </div>
        </div>

        <PasswordField
          id="setup-pin"
          label="Device PIN (new)"
          value={pin}
          onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
          placeholder="4–8 digits"
          autoComplete="new-password"
          hint="Anti-theft protection for card taps and payments."
        />

        <PasswordField
          id="setup-pin-confirm"
          label="Confirm PIN"
          value={pin2}
          onChange={(v) => setPin2(v.replace(/\D/g, '').slice(0, 8))}
          placeholder="Repeat PIN"
          autoComplete="new-password"
          hint={
            pin2.length > 0 ? (pin === pin2 ? '✓ PINs match' : '✗ PINs do not match') : undefined
          }
        />

        {error && <InlineError error={error} />}

        <PrimaryButton onClick={handlePinSaved} loading={saving} disabled={!pinValid}>
          Save PIN and Continue
        </PrimaryButton>

        <SecondaryButton onClick={() => navigate('/auth?register=1')}>
          Skip for now (required before NFC features)
        </SecondaryButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex items-start gap-3">
          <PlusIcon className="h-5 w-5 text-bitcoin-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-slate-400">
            A new Nostr keypair will be generated in your browser and encrypted into your OPFS Vault. Your private key never leaves this device.
          </p>
        </div>
      </div>

      <PasswordField
        id="new-passphrase"
        label="Choose a vault passphrase"
        value={passphrase}
        onChange={setPassphrase}
        placeholder="Minimum 12 characters"
        autoComplete="new-password"
        hint="This passphrase encrypts your identity vault. You'll need it to unlock on this device."
      />

      <PasswordField
        id="confirm-passphrase"
        label="Confirm passphrase"
        value={passphrase2}
        onChange={setPassphrase2}
        placeholder="Repeat passphrase"
        autoComplete="new-password"
        hint={
          passphrase2.length > 0
            ? passphraseMatch
              ? '✓ Passphrases match'
              : '✗ Passphrases do not match'
            : undefined
        }
      />

      {error && <InlineError error={error} />}

      <PrimaryButton onClick={handleGenerate} loading={loading} disabled={!canGenerate}>
        <PlusIcon className="h-4 w-4" />
        Generate Identity
      </PrimaryButton>

      <SecondaryButton onClick={onBack}>Back</SecondaryButton>
    </div>
  );
}

// ============================================================================
// NIP-05 Registration View
// ============================================================================

function RegisterView({ onBack }: { onBack: () => void }): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [lud16, setLud16] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('');
  const [registeredNip05, setRegisteredNip05] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<SatnamError | null>(null);

  const whitelistedDomains = getWhitelistedDomains();

  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkUsername = useCallback(async (name: string) => {
    if (name.length < 3) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    try {
      const response = await fetch(`/.netlify/functions/check-username?name=${encodeURIComponent(name)}`);
      const data = await response.json() as { available: boolean; reason?: string };
      setAvailable(data.available);
      setReason(data.reason || '');
    } catch {
      setAvailable(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const handleUsernameChange = useCallback((value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    setUsername(clean);
    setAvailable(null);
    setReason('');

    if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current);
    checkDebounceRef.current = setTimeout(() => checkUsername(clean), 600);
  }, [checkUsername]);

  const handleRegister = useCallback(async () => {
    if (!available || !username) return;
    setRegistering(true);
    setError(null);
    try {
      // CR-A real registration: NIP-98-signed POST to register-identity with a
      // whitelist-validated domain. The nsec comes from the OPFS vault — it
      // never appears in state, storage, or logs.
      const vault = getVault();
      if (!vault.isUnlocked()) {
        throw new AuthError('Vault is locked. Unlock your vault before registering.');
      }
      const identities = await vault.listIdentities();
      const npub = identities[0];
      if (!npub) throw new AuthError('No identity in vault. Generate or import one first.');
      const secret = await vault.getNsec(npub);

      const domain = resolveRequestedDomain(selectedDomain);
      if (!domain) {
        throw new AuthError(`Domain "${selectedDomain}" is not whitelisted.`);
      }

      const url = `${window.location.origin}/.netlify/functions/register-identity`;
      const body = new TextEncoder().encode(
        JSON.stringify({ action: 'register', username, domain, ...(lud16 ? { lud16 } : {}) }),
      );
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: buildNip98AuthHeader(secret, url, 'POST', body),
          'Content-Type': 'application/json',
        },
        body,
      });
      const data = (await response.json()) as { success: boolean; nip05?: string; error?: string };
      if (!response.ok || !data.success) {
        throw new AuthError(data.error ?? `Registration failed (${response.status})`);
      }
      setRegisteredNip05(data.nip05 ?? `${username}@${domain}`);

      // CR-E: publish NIP-65 kind:10002 on identity creation — self-hosted
      // write+read first, deterministic nearest pinned relays read-only.
      try {
        const { selectRelaysDeterministic } = await import('../lib/nostr/relay-manager');
        const { buildKind10002 } = await import('../lib/nostr/relay-manager');
        // Anchor: primary domain's registry region; selection is deterministic.
        const { writeSet, readSet } = selectRelaysDeterministic({
          anchorLat: 52.52,
          anchorLon: 13.405,
        });
        const relayListEvent = buildKind10002({ write: writeSet.slice(0, 1), read: readSet }, secret);
        void relayListEvent; // publication goes through CEPS once session pool is live
      } catch {
        // Non-fatal: registration succeeded; relay list can be re-published later.
      }
      setRegistered(true);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setRegistering(false);
    }
  }, [available, username, selectedDomain, lud16]);

  if (registered) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-800/40 bg-emerald-950/20">
          <CheckIcon className="h-8 w-8 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white mb-2">Identity Registered</h3>
          <p className="text-sm text-slate-400">
            Your NIP-05 identifier is now active:
          </p>
          <code className="mt-2 block text-sm font-mono text-bitcoin-400">
            {registeredNip05 || `${username}@satnam.pub`}
          </code>
        </div>
        <Link
          to="/dashboard"
          className="flex items-center justify-center gap-2 w-full rounded-lg bg-bitcoin-500 px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-bitcoin-600"
        >
          Go to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="reg-username" className="block text-sm font-medium text-slate-300 mb-1.5">
          Choose a username
        </label>
        <div className="relative">
          <input
            id="reg-username"
            type="text"
            value={username}
            onChange={(e) => handleUsernameChange(e.target.value)}
            placeholder="satoshi"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 pr-32 text-sm text-white placeholder-slate-600 focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 transition-colors"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            @satnam.pub
          </span>
        </div>
        {username.length >= 3 && (
          <p className={`mt-1.5 text-xs ${checking ? 'text-slate-500' : available ? 'text-emerald-400' : 'text-red-400'}`}>
            {checking ? 'Checking availability...' : available ? '✓ Available' : `✗ ${reason || 'Not available'}`}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="reg-domain" className="block text-sm font-medium text-slate-300 mb-1.5">
          Domain
        </label>
        <select
          id="reg-domain"
          value={selectedDomain}
          onChange={(e) => setSelectedDomain(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 transition-colors"
        >
          {whitelistedDomains.map((d) => (
            <option key={d} value={d}>
              @{d}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-slate-500">
          Whitelisted domains only — additions are configuration, not code.
        </p>
      </div>

      <div>
        <label htmlFor="reg-lud16" className="block text-sm font-medium text-slate-300 mb-1.5">
          Lightning address <span className="text-slate-600">(optional)</span>
        </label>
        <input
          id="reg-lud16"
          type="text"
          value={lud16}
          onChange={(e) => setLud16(e.target.value.trim())}
          placeholder={`you@${whitelistedDomains[0] ?? 'satnam.pub'}`}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white placeholder-slate-600 focus:border-bitcoin-500 focus:outline-none focus:ring-1 focus:ring-bitcoin-500 transition-colors"
        />
        <p className="mt-1.5 text-xs text-slate-500">Associate a Lightning address for payments.</p>
      </div>

      {error && <InlineError error={error} />}

      <PrimaryButton
        onClick={handleRegister}
        loading={registering}
        disabled={!available || !username || !resolveRequestedDomain(selectedDomain)}
      >
        Register{' '}
        {username
          ? `${username}@${resolveRequestedDomain(selectedDomain) ?? '—'}`
          : 'Username'}
      </PrimaryButton>

      <SecondaryButton onClick={onBack}>Back</SecondaryButton>
    </div>
  );
}

// ============================================================================
// Main AuthPage
// ============================================================================

export default function AuthPage(): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('landing');
  const [nip07Available, setNip07Available] = useState(false);
  const [extensionName, setExtensionName] = useState('Nostr Extension');

  // Check for URL params (e.g. ?register=1 from generate flow)
  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  );
  const startInRegisterMode = searchParams.get('register') === '1';

  useEffect(() => {
    if (startInRegisterMode) {
      setMode('register');
    }
  }, [startInRegisterMode]);

  // Detect NIP-07 extension
  useEffect(() => {
    const check = () => {
      const available = hasNip07Extension();
      setNip07Available(available);
      if (available) setExtensionName(detectExtensionName());
    };

    // Check immediately and after a short delay (some extensions inject late)
    check();
    const timer = setTimeout(check, 500);
    return () => clearTimeout(timer);
  }, []);

  const getTitle = (): string => {
    switch (mode) {
      case 'nip07': return 'Connect Extension';
      case 'nsec': return 'Import Private Key';
      case 'generate': return 'New Identity';
      case 'unlock': return 'Unlock Vault';
      case 'register': return 'Register Identity';
      default: return 'Sign In';
    }
  };

  const renderMode = (): React.ReactNode => {
    switch (mode) {
      case 'nip07':
        return <Nip07View onBack={() => setMode('landing')} extensionName={extensionName} />;
      case 'nsec':
        return <NsecView onBack={() => setMode('landing')} />;
      case 'generate':
        return <GenerateView onBack={() => setMode('landing')} />;
      case 'unlock':
        return <UnlockView onBack={() => setMode('landing')} />;
      case 'register':
        return <RegisterView onBack={() => setMode('landing')} />;
      default:
        return (
          <LandingView
            onSelectMode={setMode}
            nip07Available={nip07Available}
            extensionName={extensionName}
          />
        );
    }
  };

  return (
    <>
      <Helmet>
        <title>Satnam — {getTitle()}</title>
        <meta name="description" content="Sovereign identity for the Nostr economy. Sign in or create your identity." />
      </Helmet>

      <div className="min-h-screen bg-slate-950 flex flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-5 border-b border-slate-900">
          <Link to="/" className="flex items-center gap-2.5">
            <SatnamLogoMark />
            <span className="font-display text-lg font-semibold tracking-wide text-white">
              Satnam
            </span>
          </Link>
          {mode !== 'landing' && (
            <button
              type="button"
              onClick={() => setMode('landing')}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              ← Back
            </button>
          )}
        </header>

        {/* Main content */}
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            {/* Title */}
            <div className="mb-8 text-center">
              <h1 className="font-display text-2xl font-semibold tracking-wide text-white mb-2">
                {getTitle()}
              </h1>
              {mode === 'landing' && (
                <p className="text-sm text-slate-500">
                  Your sovereign Nostr identity
                </p>
              )}
            </div>

            {/* Auth form card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/30 backdrop-blur-sm p-6 sm:p-8">
              {renderMode()}
            </div>

            {/* Footer links */}
            <div className="mt-6 text-center">
              <p className="text-xs text-slate-600">
                Need help?{' '}
                <a
                  href="https://nostr.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-500 hover:text-slate-400 underline"
                >
                  Learn about Nostr
                </a>
              </p>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// ============================================================================
// Logo mark (inline SVG — no external dep)
// ============================================================================

function SatnamLogoMark(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-8 w-8"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#f7931a" fillOpacity="0.15" />
      <path
        d="M16 6L26 11V21L16 26L6 21V11L16 6Z"
        stroke="#f7931a"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M16 6V26M6 11L26 21M26 11L6 21"
        stroke="#f7931a"
        strokeWidth="1"
        strokeOpacity="0.4"
      />
    </svg>
  );
}

// ============================================================================
// Inline icons
// ============================================================================

function ExtensionIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  );
}

function VaultIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}

function KeyIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
    </svg>
  );
}

function PlusIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function ChevronRightIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function WarningIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeOffIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
    </svg>
  );
}

