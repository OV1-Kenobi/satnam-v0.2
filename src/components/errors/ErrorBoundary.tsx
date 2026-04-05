/**
 * @module components/errors/ErrorBoundary
 * @description React Error Boundary with dark-themed graceful fallback UI.
 *
 * Catches rendering errors thrown by child components and displays a
 * user-friendly fallback instead of a blank screen. All errors are
 * routed through the SatnamError hierarchy before display.
 *
 * Usage:
 * ```tsx
 * <ErrorBoundary>
 *   <SomeComponent />
 * </ErrorBoundary>
 *
 * // With custom fallback:
 * <ErrorBoundary fallback={<MyCustomFallback />}>
 *   <SomeComponent />
 * </ErrorBoundary>
 * ```
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { handleError, reportError, SatnamError, type VaultLockedError } from '../../lib/errors';

// ============================================================================
// Types
// ============================================================================

interface ErrorBoundaryProps {
  /** Child components to wrap. */
  children: ReactNode;
  /** Custom fallback UI. If not provided, uses the default dark fallback. */
  fallback?: ReactNode;
  /**
   * Optional callback invoked when an error is caught.
   * Use for custom error tracking or side effects.
   */
  onError?: (error: SatnamError, errorInfo: ErrorInfo) => void;
  /** Label for the "Try Again" button. Defaults to "Try Again". */
  resetLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: SatnamError | null;
  errorInfo: ErrorInfo | null;
}

// ============================================================================
// Error Boundary Component
// ============================================================================

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    const satnamError = handleError(error);
    return {
      hasError: true,
      error: satnamError,
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const satnamError = handleError(error);
    // S3 invariant: no Sentry — console only
    reportError(satnamError);

    this.setState({ errorInfo });
    this.props.onError?.(satnamError, errorInfo);
  }

  handleReset(): void {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // If a custom fallback was provided, render it
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default dark-themed fallback
      return (
        <DefaultErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
          resetLabel={this.props.resetLabel}
        />
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Default Fallback UI
// ============================================================================

interface DefaultErrorFallbackProps {
  error: SatnamError | null;
  onReset: () => void;
  resetLabel?: string;
}

function DefaultErrorFallback({
  error,
  onReset,
  resetLabel = 'Try Again',
}: DefaultErrorFallbackProps): React.JSX.Element {
  const isFatal = error ? !error.recoverable : false;
  const code = error?.code ?? 'UNKNOWN_ERROR';
  const message = error?.message ?? 'An unexpected error occurred.';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-screen flex-col items-center justify-center bg-slate-950 p-8 text-center"
    >
      {/* Icon */}
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-red-800/50 bg-red-950/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-8 w-8 text-red-400"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>

      {/* Heading */}
      <h1 className="mb-2 font-display text-2xl font-semibold tracking-wide text-white">
        {isFatal ? 'Something Went Wrong' : 'Temporary Error'}
      </h1>

      {/* Error code badge */}
      <div className="mb-4 inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1">
        <code className="font-mono text-xs text-slate-400">{code}</code>
      </div>

      {/* Message */}
      <p className="mb-8 max-w-sm text-sm leading-relaxed text-slate-400">
        {message}
      </p>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row">
        {!isFatal && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg bg-bitcoin-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-bitcoin-600 focus:outline-none focus:ring-2 focus:ring-bitcoin-400 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            {resetLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Reload Page
        </button>
      </div>

      {/* Development details */}
      {import.meta.env.DEV && error?.context && (
        <details className="mt-8 max-w-lg text-left">
          <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-500">
            Debug context (dev only)
          </summary>
          <pre className="mt-2 overflow-auto rounded-lg border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400">
            {JSON.stringify(error.context, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ============================================================================
// Specialized Boundaries
// ============================================================================

/**
 * Error boundary specifically for vault-related operations.
 * Shows a vault-unlock prompt when catching VaultLockedError.
 */
interface VaultErrorBoundaryProps {
  children: ReactNode;
  onUnlockVault?: () => void;
}

export function VaultErrorBoundary({
  children,
  onUnlockVault,
}: VaultErrorBoundaryProps): React.JSX.Element {
  return (
    <ErrorBoundary
      onError={(error) => {
        if (error.code === 'VAULT_LOCKED' && onUnlockVault) {
          onUnlockVault();
        }
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Lightweight inline error display (not a full-page fallback).
 * Use for scoped error states within a section of the UI.
 */
interface InlineErrorProps {
  error: SatnamError | Error | string | null;
  className?: string;
  onRetry?: () => void;
}

export function InlineError({
  error,
  className = '',
  onRetry,
}: InlineErrorProps): React.JSX.Element | null {
  if (!error) return null;

  const message =
    typeof error === 'string'
      ? error
      : error instanceof SatnamError
      ? error.message
      : error.message || 'An error occurred.';

  const code =
    error instanceof SatnamError ? error.code : undefined;

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border border-red-800/40 bg-red-950/20 p-4 ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-300">{message}</p>
        {code && (
          <p className="mt-0.5 font-mono text-xs text-red-500/70">{code}</p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex-shrink-0 rounded px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-900/30 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default ErrorBoundary;
