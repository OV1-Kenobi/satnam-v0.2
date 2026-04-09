/**
 * @component PinEntry
 * @description PIN entry dialog with lockout display.
 *
 * Provides a mobile-optimized PIN pad for 4–8 digit PIN entry.
 * Displays attempt count and lockout countdown when locked.
 *
 * Accessibility: Full keyboard navigation, screen reader announcements.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PinEntryProps {
  /** Title displayed above the PIN pad */
  title?: string;
  /** Descriptive text */
  description?: string;
  /** Maximum PIN length (4–8) */
  maxLength?: number;
  /** Minimum PIN length (4–8) */
  minLength?: number;
  /** Number of remaining attempts (undefined = unlimited) */
  remainingAttempts?: number;
  /** Lockout remaining time in milliseconds (> 0 = locked out) */
  lockoutRemainingMs?: number;
  /** Whether in verification mode (vs setup mode) */
  mode?: 'verify' | 'setup' | 'confirm';
  /** Called with the entered PIN when submitted */
  onSubmit: (pin: string) => void | Promise<void>;
  /** Called when the user cancels */
  onCancel?: () => void;
  /** Whether submission is in progress */
  isLoading?: boolean;
  /** Error message to display */
  error?: string;
}

// ---------------------------------------------------------------------------
// Lockout countdown
// ---------------------------------------------------------------------------

function LockoutDisplay({ remainingMs }: { remainingMs: number }) {
  const [timeLeft, setTimeLeft] = useState(remainingMs);

  useEffect(() => {
    setTimeLeft(remainingMs);
    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingMs]);

  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  const formatted = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="text-center py-8 space-y-4" role="status" aria-live="polite">
      <div className="w-16 h-16 rounded-full bg-red-500/10 border-2 border-red-500/40 flex items-center justify-center mx-auto">
        <span className="text-3xl" aria-hidden="true">🔒</span>
      </div>
      <div>
        <p className="text-[#f5f5f5] font-semibold">PIN Locked</p>
        <p className="text-sm text-[#555555] mt-1">Too many incorrect attempts</p>
      </div>
      <div className="font-mono text-3xl font-bold text-red-400" aria-label={`Unlocks in ${formatted}`}>
        {formatted}
      </div>
      <p className="text-xs text-[#555555]">until PIN unlocks</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PIN dots display
// ---------------------------------------------------------------------------

function PinDots({
  length,
  maxLength,
  hasError,
}: {
  length: number;
  maxLength: number;
  hasError: boolean;
}) {
  return (
    <div
      className="flex gap-3 justify-center"
      aria-label={`${length} of ${maxLength} digits entered`}
      role="status"
    >
      {Array.from({ length: maxLength }, (_, i) => (
        <div
          key={i}
          className={`
            w-4 h-4 rounded-full transition-all duration-150
            ${i < length
              ? hasError
                ? 'bg-red-400 scale-110'
                : 'bg-[#F7931A] scale-110'
              : 'border-2 border-[#2a2a2a]'
            }
          `}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PIN pad
// ---------------------------------------------------------------------------

const PIN_PAD_KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

function PinPad({
  onDigit,
  onDelete,
  disabled,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3" role="group" aria-label="PIN pad">
      {PIN_PAD_KEYS.map((row, ri) => (
        <div key={ri} className="grid grid-cols-3 gap-3">
          {row.map((key, ci) => {
            if (key === '') return <div key={ci} />;

            const isDelete = key === '⌫';
            return (
              <button
                key={ci}
                onClick={() => isDelete ? onDelete() : onDigit(key)}
                disabled={disabled && !isDelete}
                className={`
                  h-16 rounded-xl font-bold text-xl
                  transition-all duration-100 active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]
                  ${isDelete
                    ? 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#222222]'
                    : 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] hover:bg-[#222222] hover:border-[#3a3a3a] disabled:opacity-30 disabled:cursor-not-allowed'
                  }
                `}
                aria-label={isDelete ? 'Delete last digit' : `Enter ${key}`}
              >
                {key}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PinEntry({
  title = 'Enter PIN',
  description,
  maxLength = 6,
  minLength = 4,
  remainingAttempts,
  lockoutRemainingMs = 0,
  mode = 'verify',
  onSubmit,
  onCancel,
  isLoading = false,
  error,
}: PinEntryProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [setupPhase, setSetupPhase] = useState<'enter' | 'confirm'>('enter');
  const [setupError, setSetupError] = useState('');
  const [shake, setShake] = useState(false);
  const submitRef = useRef(false);

  // Shake animation on error
  useEffect(() => {
    if (error || setupError) {
      setShake(true);
      setPin('');
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error, setupError]);

  // Keyboard input
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter') {
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [pin, setupPhase, confirmPin]);

  const handleDigit = useCallback((digit: string) => {
    if (isLoading || lockoutRemainingMs > 0) return;

    const currentPin = mode === 'setup' && setupPhase === 'confirm' ? confirmPin : pin;
    const setter = mode === 'setup' && setupPhase === 'confirm' ? setConfirmPin : setPin;

    if (currentPin.length < maxLength) {
      setter(prev => prev + digit);
    }
  }, [pin, confirmPin, mode, setupPhase, maxLength, isLoading, lockoutRemainingMs]);

  const handleDelete = useCallback(() => {
    if (mode === 'setup' && setupPhase === 'confirm') {
      setConfirmPin(prev => prev.slice(0, -1));
    } else {
      setPin(prev => prev.slice(0, -1));
    }
  }, [mode, setupPhase]);

  const handleSubmit = useCallback(async () => {
    if (submitRef.current) return;

    if (mode === 'setup') {
      if (setupPhase === 'enter') {
        if (pin.length < minLength) return;
        setSetupPhase('confirm');
        return;
      }
      // Confirm phase
      if (confirmPin.length < minLength) return;
      if (confirmPin !== pin) {
        setSetupError('PINs do not match');
        setConfirmPin('');
        return;
      }
      setSetupError('');
      submitRef.current = true;
      await onSubmit(pin);
      submitRef.current = false;
      return;
    }

    if (pin.length < minLength) return;
    submitRef.current = true;
    await onSubmit(pin);
    submitRef.current = false;
    setPin('');
  }, [pin, confirmPin, mode, setupPhase, minLength, onSubmit]);

  // Auto-submit when PIN reaches maxLength
  useEffect(() => {
    if (mode === 'setup') {
      if (setupPhase === 'enter' && pin.length === maxLength) {
        setTimeout(() => setSetupPhase('confirm'), 200);
      } else if (setupPhase === 'confirm' && confirmPin.length === maxLength) {
        setTimeout(handleSubmit, 200);
      }
    } else if (pin.length === maxLength) {
      setTimeout(handleSubmit, 200);
    }
  }, [pin, confirmPin, mode, setupPhase, maxLength]);

  // ── Locked out ─────────────────────────────────────────────────────────────

  if (lockoutRemainingMs > 0) {
    return (
      <div className="card max-w-xs mx-auto">
        {onCancel && (
          <button
            onClick={onCancel}
            className="ml-auto block text-[#555555] hover:text-[#a0a0a0] text-xl mb-2"
            aria-label="Cancel"
          >
            ×
          </button>
        )}
        <LockoutDisplay remainingMs={lockoutRemainingMs} />
        {onCancel && (
          <button
            onClick={onCancel}
            className="w-full mt-4 py-3 rounded-lg font-medium border border-[#2a2a2a] text-[#a0a0a0] hover:bg-[#1a1a1a] transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  // ── Normal PIN entry ──────────────────────────────────────────────────────

  const currentPin = mode === 'setup' && setupPhase === 'confirm' ? confirmPin : pin;
  const displayTitle = mode === 'setup'
    ? setupPhase === 'enter' ? 'Set PIN' : 'Confirm PIN'
    : title;
  const displayDesc = mode === 'setup'
    ? setupPhase === 'enter'
      ? `Choose a ${minLength}–${maxLength} digit PIN`
      : 'Enter your PIN again to confirm'
    : description;
  const errorMsg = error ?? (setupError || undefined);
  const canSubmit = currentPin.length >= minLength && !isLoading;

  return (
    <div className="card max-w-xs mx-auto space-y-6" role="dialog" aria-label={displayTitle}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
            {displayTitle}
          </h3>
          {displayDesc && (
            <p className="text-sm text-[#555555] mt-1">{displayDesc}</p>
          )}
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-[#555555] hover:text-[#a0a0a0] text-xl leading-none ml-3"
            aria-label="Cancel PIN entry"
          >
            ×
          </button>
        )}
      </div>

      {/* PIN dots */}
      <div
        className={`transition-transform duration-100 ${shake ? 'translate-x-2' : ''}`}
        style={shake ? { animation: 'shake 0.4s ease-in-out' } : {}}
      >
        <PinDots length={currentPin.length} maxLength={maxLength} hasError={!!errorMsg} />
      </div>

      {/* Error message */}
      {errorMsg && (
        <p className="text-sm text-red-400 text-center" role="alert" aria-live="polite">
          {errorMsg}
        </p>
      )}

      {/* Remaining attempts */}
      {remainingAttempts !== undefined && remainingAttempts <= 3 && !errorMsg && (
        <p className="text-xs text-[#FFD700] text-center" role="status">
          {remainingAttempts} attempt{remainingAttempts !== 1 ? 's' : ''} remaining
        </p>
      )}

      {/* PIN pad */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8" role="status" aria-live="polite">
          <div className="h-5 w-5 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" aria-hidden="true" />
          <span className="text-sm text-[#a0a0a0]">Verifying…</span>
        </div>
      ) : (
        <PinPad
          onDigit={handleDigit}
          onDelete={handleDelete}
          disabled={isLoading || currentPin.length >= maxLength}
        />
      )}

      {/* Manual submit (for partial PINs) */}
      {!isLoading && canSubmit && currentPin.length < maxLength && (
        <button
          onClick={handleSubmit}
          className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
        >
          {mode === 'setup' && setupPhase === 'enter' ? 'Continue' : 'Submit'}
        </button>
      )}
    </div>
  );
}

