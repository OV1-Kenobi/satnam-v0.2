/**
 * @component ReceivePayment
 * @description Receive payment: generate BOLT-11 invoice, display QR code, show payment status.
 *
 * Flow:
 * 1. Enter amount + optional description
 * 2. Generate invoice via NWC makeInvoice
 * 3. Display QR code + copyable invoice
 * 4. Poll for payment confirmation
 */

import React, { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReceivePaymentProps {
  onMakeInvoice?: (
    amountMsats: bigint,
    description: string,
  ) => Promise<{ bolt11: string; paymentHash: string }>;
  onCheckPayment?: (paymentHash: string) => Promise<'pending' | 'paid' | 'expired'>;
  onClose?: () => void;
}

type ReceiveStep = 'setup' | 'invoice' | 'paid' | 'expired';

// ---------------------------------------------------------------------------
// QR Code (inline SVG — no external library)
// Generates a simple text-based placeholder. Real implementation uses qrcode lib.
// ---------------------------------------------------------------------------

function QrCodeDisplay({ data }: { data: string }) {
  // In production: use 'qrcode' npm package or qrcode.react
  // This is a styled placeholder that renders the invoice in a QR-like box
  return (
    <div
      className="
        w-48 h-48 mx-auto
        bg-white rounded-xl p-3
        flex items-center justify-center
        select-none
      "
      role="img"
      aria-label="QR code for invoice"
    >
      {/* Placeholder QR pattern */}
      <div className="w-full h-full bg-white relative overflow-hidden">
        {/* Corner squares */}
        {(['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0'] as const).map((pos, i) => (
          <div
            key={i}
            className={`absolute ${pos} w-10 h-10 border-4 border-black m-1 rounded-sm`}
          />
        ))}
        {/* Center text fallback */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-black text-2xl">⚡</span>
        </div>
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-[8px] text-gray-600 font-mono truncate px-2 w-full text-center">
            {data.slice(0, 16)}…
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amount input helpers
// ---------------------------------------------------------------------------

function AmountInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const quick = [1000, 5000, 21000, 100000];

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          min={1}
          className="
            w-full px-4 py-4 pr-16 rounded-lg text-center text-3xl font-mono font-bold
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#F7931A] placeholder-[#555555]
            focus:outline-none focus:border-[#F7931A]
            transition-colors
            [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
          "
          aria-label="Amount in satoshis"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#555555] text-sm font-medium">
          sats
        </span>
      </div>

      {/* Quick amounts */}
      <div className="flex gap-2">
        {quick.map(amt => (
          <button
            key={amt}
            onClick={() => onChange(String(amt))}
            className="flex-1 py-1.5 text-xs font-medium rounded-lg border border-[#2a2a2a] text-[#a0a0a0] hover:border-[#F7931A] hover:text-[#F7931A] transition-colors"
          >
            {amt >= 1000 ? `${amt / 1000}K` : amt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReceivePayment({
  onMakeInvoice,
  onCheckPayment,
  onClose,
}: ReceivePaymentProps) {
  const [step, setStep] = useState<ReceiveStep>('setup');
  const [amountSats, setAmountSats] = useState('');
  const [description, setDescription] = useState('');
  const [invoice, setInvoice] = useState('');
  const [paymentHash, setPaymentHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Poll for payment when invoice is displayed
  useEffect(() => {
    if (step !== 'invoice' || !paymentHash || !onCheckPayment) return;

    const interval = setInterval(async () => {
      const status = await onCheckPayment(paymentHash);
      if (status === 'paid') {
        clearInterval(interval);
        setStep('paid');
      } else if (status === 'expired') {
        clearInterval(interval);
        setStep('expired');
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [step, paymentHash, onCheckPayment]);

  const handleGenerate = async () => {
    const sats = parseInt(amountSats);
    if (!sats || sats < 1) {
      setError('Enter a valid amount');
      return;
    }

    setGenerating(true);
    setError('');

    try {
      if (onMakeInvoice) {
        const result = await onMakeInvoice(
          BigInt(sats * 1000), // msats
          description || 'Satnam payment',
        );
        setInvoice(result.bolt11);
        setPaymentHash(result.paymentHash);
      } else {
        // Stub invoice for demo
        setInvoice('lnbc' + sats + 'n1' + 'p'.repeat(60));
        setPaymentHash('00'.repeat(32));
      }
      setStep('invoice');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setGenerating(false);
    }
  };

  const copyInvoice = () => {
    navigator.clipboard.writeText(invoice).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── Setup step ─────────────────────────────────────────────────────────────

  if (step === 'setup') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
            Receive
          </h3>
          {onClose && (
            <button onClick={onClose} className="text-[#555555] hover:text-[#a0a0a0] text-xl" aria-label="Close">×</button>
          )}
        </div>

        <AmountInput value={amountSats} onChange={setAmountSats} />

        <div>
          <label htmlFor="receive-description" className="block text-sm font-medium text-[#a0a0a0] mb-2">
            Description <span className="text-[#555555]">(optional)</span>
          </label>
          <input
            id="receive-description"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What's this for?"
            maxLength={128}
            className="
              w-full px-4 py-3 rounded-lg
              bg-[#1a1a1a] border border-[#2a2a2a]
              text-[#f5f5f5] placeholder-[#555555]
              focus:outline-none focus:border-[#F7931A]
              transition-colors
            "
          />
        </div>

        {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

        <button
          onClick={handleGenerate}
          disabled={generating || !amountSats}
          className="
            w-full py-3 rounded-lg font-medium
            bg-[#F7931A] text-black
            hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
              Generating…
            </span>
          ) : (
            'Generate Invoice'
          )}
        </button>
      </div>
    );
  }

  // ── Invoice step ──────────────────────────────────────────────────────────

  if (step === 'invoice') {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setStep('setup')}
            className="text-[#555555] hover:text-[#a0a0a0] text-sm transition-colors"
          >
            ← Back
          </button>
          <h3 className="font-display text-base text-[#F7931A] tracking-wider uppercase">
            Invoice
          </h3>
          {onClose && (
            <button onClick={onClose} className="text-[#555555] hover:text-[#a0a0a0] text-xl" aria-label="Close">×</button>
          )}
        </div>

        {/* Amount */}
        <div className="text-center">
          <p className="font-mono text-3xl font-bold text-[#F7931A]">
            {parseInt(amountSats).toLocaleString()}
          </p>
          <p className="text-[#555555] text-sm">sats</p>
        </div>

        {/* QR Code */}
        <QrCodeDisplay data={invoice} />

        {/* Invoice string */}
        <div>
          <button
            onClick={copyInvoice}
            className="
              w-full p-3 rounded-lg
              bg-[#1a1a1a] border border-[#2a2a2a]
              text-left font-mono text-xs text-[#555555]
              hover:border-[#F7931A] hover:text-[#a0a0a0]
              transition-colors break-all
            "
            aria-label="Copy invoice"
          >
            {invoice.slice(0, 48)}…
          </button>
          {copied && <p className="text-xs text-green-500 mt-1 text-center">Copied to clipboard!</p>}
        </div>

        {/* Status indicator */}
        <div className="flex items-center justify-center gap-2 text-sm text-[#555555]">
          <div className="h-3 w-3 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" />
          Waiting for payment…
        </div>
      </div>
    );
  }

  // ── Paid step ─────────────────────────────────────────────────────────────

  if (step === 'paid') {
    return (
      <div className="flex flex-col items-center gap-6 py-8" role="status" aria-live="polite">
        <div className="w-16 h-16 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center text-3xl">
          ✓
        </div>
        <div className="text-center">
          <h3 className="font-display text-xl text-green-500 mb-2">Payment Received!</h3>
          <p className="font-mono text-2xl font-bold text-[#f5f5f5]">
            {parseInt(amountSats).toLocaleString()} sats
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
        >
          Done
        </button>
      </div>
    );
  }

  // ── Expired step ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-6 py-8" role="alert">
      <div className="w-16 h-16 rounded-full bg-[#555555]/10 border-2 border-[#555555] flex items-center justify-center text-3xl">
        ⏰
      </div>
      <div className="text-center">
        <h3 className="font-display text-xl text-[#555555] mb-2">Invoice Expired</h3>
        <p className="text-sm text-[#555555]">The invoice was not paid in time.</p>
      </div>
      <div className="flex gap-3 w-full">
        <button
          onClick={() => { setStep('setup'); setInvoice(''); setPaymentHash(''); }}
          className="flex-1 py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
        >
          New Invoice
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
