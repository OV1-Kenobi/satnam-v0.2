/**
 * @component SendPayment
 * @description Send payment flow via NWC (NIP-47).
 *
 * Flow:
 * 1. Paste BOLT-11 invoice (or enter amount + destination)
 * 2. Decode and display invoice details
 * 3. Confirm payment
 * 4. Execute via NWC and show result
 */

import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DecodedInvoice {
  amountMsats: bigint;
  description?: string;
  expirySeconds?: number;
  payeeNodeKey?: string;
  paymentHash?: string;
  expiresAt?: number;
}

interface SendPaymentProps {
  balance?: bigint; // msats
  onSend?: (bolt11: string) => Promise<{ success: boolean; preimage?: string; error?: string }>;
  onClose?: () => void;
}

type SendStep = 'input' | 'confirm' | 'sending' | 'success' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(msats: bigint): string {
  const sats = Number(msats) / 1000;
  return sats.toLocaleString(undefined, { maximumFractionDigits: sats < 1 ? 3 : 0 });
}

/**
 * Naive BOLT-11 invoice decoder for display purposes.
 * In production: use bolt11 npm package or nostr-tools.
 */
function decodeInvoice(bolt11: string): DecodedInvoice | null {
  if (!bolt11.toLowerCase().startsWith('ln')) return null;

  // Simulate decoding — real implementation uses bolt11 lib
  // Extract amount from the invoice prefix: lnbc{amount}
  const match = bolt11.match(/^ln(?:bc|tb|bcrt)(\d*[munp]?)/i);
  if (!match) return null;

  let amountMsats = BigInt(0);
  const amountStr = match[1];
  if (amountStr) {
    const suffix = amountStr.slice(-1);
    const num = parseInt(amountStr);
    const multipliers: Record<string, number> = {
      m: 100_000_000, // milli-bitcoin → msats
      u: 100_000,
      n: 100,
      p: 0.1,
    };
    const multiplier = multipliers[suffix] ?? 100_000_000_000; // satoshi prefix
    amountMsats = BigInt(Math.round(num * multiplier));
  }

  return {
    amountMsats,
    description: 'Payment',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SendPayment({ balance, onSend, onClose }: SendPaymentProps) {
  const [step, setStep] = useState<SendStep>('input');
  const [bolt11, setBolt11] = useState('');
  const [decoded, setDecoded] = useState<DecodedInvoice | null>(null);
  const [decodeError, setDecodeError] = useState('');
  const [result, setResult] = useState<{ preimage?: string; error?: string } | null>(null);

  // Decode invoice as user types
  useEffect(() => {
    if (!bolt11.trim()) {
      setDecoded(null);
      setDecodeError('');
      return;
    }
    const cleaned = bolt11.trim().toLowerCase().replace('lightning:', '');
    const dec = decodeInvoice(cleaned);
    if (dec) {
      setDecoded(dec);
      setDecodeError('');
    } else if (bolt11.length > 10) {
      setDecodeError('Invalid invoice format');
      setDecoded(null);
    }
  }, [bolt11]);

  const canProceed = decoded !== null && !decodeError;

  const insufficientFunds = decoded && balance !== undefined
    ? decoded.amountMsats > balance
    : false;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setBolt11(text.trim());
    } catch {
      // Clipboard not available
    }
  };

  const handleConfirm = async () => {
    if (!decoded || !onSend) return;
    setStep('sending');
    const res = await onSend(bolt11.trim());
    setResult(res);
    setStep(res.success ? 'success' : 'error');
  };

  // ── Input step ─────────────────────────────────────────────────────────────

  if (step === 'input') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
            Send
          </h3>
          {onClose && (
            <button onClick={onClose} className="text-[#555555] hover:text-[#a0a0a0] text-xl" aria-label="Close">×</button>
          )}
        </div>

        {/* Balance */}
        {balance !== undefined && (
          <div className="p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-center">
            <p className="text-xs text-[#555555] mb-1">Available Balance</p>
            <p className="font-mono font-bold text-[#f5f5f5]">
              {formatSats(balance)} <span className="text-[#555555] font-normal text-sm">sats</span>
            </p>
          </div>
        )}

        {/* Invoice input */}
        <div>
          <label htmlFor="bolt11-input" className="block text-sm font-medium text-[#a0a0a0] mb-2">
            BOLT-11 Invoice <span className="text-[#F7931A]">*</span>
          </label>
          <div className="relative">
            <textarea
              id="bolt11-input"
              value={bolt11}
              onChange={e => setBolt11(e.target.value)}
              placeholder="lnbc..."
              rows={4}
              className="
                w-full px-4 py-3 rounded-lg
                bg-[#1a1a1a] border border-[#2a2a2a]
                text-[#f5f5f5] placeholder-[#555555] font-mono text-xs
                focus:outline-none focus:border-[#F7931A]
                transition-colors resize-none
              "
              aria-required="true"
              aria-describedby={decodeError ? 'invoice-error' : undefined}
            />
          </div>

          {decodeError && (
            <p id="invoice-error" className="mt-1 text-xs text-red-400" role="alert">{decodeError}</p>
          )}
        </div>

        {/* Paste button */}
        <button
          onClick={handlePaste}
          className="w-full py-2.5 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors text-sm"
        >
          📋 Paste from clipboard
        </button>

        {/* Decoded preview */}
        {decoded && (
          <div className="p-4 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] space-y-3">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-[#555555] uppercase tracking-wider">Amount</span>
              <span className="font-mono font-bold text-[#F7931A] text-lg">
                {formatSats(decoded.amountMsats)} sats
              </span>
            </div>
            {decoded.description && (
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-[#555555] uppercase tracking-wider">Memo</span>
                <span className="text-sm text-[#a0a0a0] max-w-[60%] text-right">{decoded.description}</span>
              </div>
            )}
          </div>
        )}

        {insufficientFunds && (
          <p className="text-sm text-red-400 text-center" role="alert">Insufficient balance</p>
        )}

        <button
          onClick={() => setStep('confirm')}
          disabled={!canProceed || !!insufficientFunds}
          className="
            w-full py-3 rounded-lg font-medium
            bg-[#F7931A] text-black
            hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          Review Payment
        </button>
      </div>
    );
  }

  // ── Confirm step ───────────────────────────────────────────────────────────

  if (step === 'confirm' && decoded) {
    return (
      <div className="space-y-6">
        <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase text-center">
          Confirm Payment
        </h3>

        <div className="text-center py-4">
          <p className="text-xs text-[#555555] mb-2">Sending</p>
          <p className="font-mono text-4xl font-bold text-[#F7931A]">
            {formatSats(decoded.amountMsats)}
          </p>
          <p className="text-[#555555] text-sm mt-1">sats</p>
        </div>

        {decoded.description && (
          <div className="card p-3 text-center">
            <p className="text-sm text-[#a0a0a0]">{decoded.description}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('input')}
            className="flex-1 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
          >
            Send ⚡
          </button>
        </div>
      </div>
    );
  }

  // ── Sending step ──────────────────────────────────────────────────────────

  if (step === 'sending') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4" role="status" aria-live="polite">
        <div className="h-12 w-12 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" aria-hidden="true" />
        <p className="text-[#a0a0a0] text-sm">Sending payment…</p>
      </div>
    );
  }

  // ── Success step ──────────────────────────────────────────────────────────

  if (step === 'success') {
    return (
      <div className="flex flex-col items-center gap-6 py-8" role="status" aria-live="polite">
        <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center text-3xl">
          ⚡
        </div>
        <div className="text-center">
          <h3 className="font-display text-xl text-green-500 mb-2">Payment Sent!</h3>
          {decoded && (
            <p className="font-mono text-2xl font-bold text-[#f5f5f5]">
              {formatSats(decoded.amountMsats)} sats
            </p>
          )}
        </div>
        {result?.preimage && (
          <div className="w-full p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
            <p className="text-xs text-[#555555] mb-1">Preimage</p>
            <p className="font-mono text-xs text-[#a0a0a0] break-all">{result.preimage}</p>
          </div>
        )}
        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // ── Error step ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 py-8" role="alert">
      <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500 flex items-center justify-center text-3xl">
        ✗
      </div>
      <div className="text-center">
        <h3 className="font-display text-xl text-red-400 mb-2">Payment Failed</h3>
        {result?.error && <p className="text-sm text-[#555555]">{result.error}</p>}
      </div>
      <div className="flex gap-3 w-full">
        <button
          onClick={() => setStep('input')}
          className="flex-1 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors"
        >
          Try Again
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-lg font-medium bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] hover:bg-[#222222] transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

