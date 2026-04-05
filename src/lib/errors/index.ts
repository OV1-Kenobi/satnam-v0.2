/**
 * @module lib/errors
 * @description Centralized error hierarchy for Satnam v2.
 *
 * All thrown errors in the application extend SatnamError. This ensures:
 * - Consistent error shape throughout the codebase
 * - Typed error codes for programmatic error handling
 * - No unstructured errors reaching the UI (S11 invariant: no key material in logs)
 * - Recoverable vs. fatal error distinction for UI error boundaries
 *
 * Error reporting uses console-only output (no Sentry — S3 invariant).
 */

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base class for all Satnam application errors.
 *
 * @example
 * ```ts
 * throw new VaultLockedError('Vault must be unlocked before signing');
 * ```
 */
export class SatnamError extends Error {
  /**
   * Machine-readable error code for programmatic handling.
   * Format: SCREAMING_SNAKE_CASE, e.g. 'VAULT_LOCKED', 'NETWORK_TIMEOUT'
   */
  public readonly code: string;

  /**
   * Whether the error is recoverable without restarting the application.
   * - true: user can retry or take corrective action (e.g. unlock vault)
   * - false: fatal error requiring app reload or re-initialization
   */
  public readonly recoverable: boolean;

  /**
   * Optional structured context for debugging (never include key material).
   * S11 invariant: no nsec, key, secret, share, or proof values here.
   */
  public readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    code: string,
    recoverable: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.recoverable = recoverable;
    this.context = context ? Object.freeze({ ...context }) : undefined;

    // Maintain proper prototype chain in TypeScript ES5 targets
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ============================================================================
// Vault Errors
// ============================================================================

/**
 * Thrown when an operation requires an unlocked OPFS Vault but the vault
 * is currently locked or uninitialized.
 *
 * Recoverable: true — user can unlock the vault and retry.
 */
export class VaultLockedError extends SatnamError {
  constructor(
    message: string = 'Vault is locked. Please unlock your vault to continue.',
    context?: Record<string, unknown>
  ) {
    super(message, 'VAULT_LOCKED', true, context);
  }
}

/**
 * Thrown when vault initialization fails (e.g. OPFS unavailable, passphrase
 * derivation failure, corrupt vault data).
 *
 * Recoverable: depends on the underlying cause.
 */
export class VaultInitError extends SatnamError {
  constructor(
    message: string = 'Failed to initialize vault.',
    recoverable: boolean = false,
    context?: Record<string, unknown>
  ) {
    super(message, 'VAULT_INIT_FAILED', recoverable, context);
  }
}

/**
 * Thrown when vault decryption fails (wrong passphrase, corrupt data).
 *
 * Recoverable: true — user can try again with the correct passphrase.
 */
export class VaultDecryptError extends SatnamError {
  constructor(
    message: string = 'Vault decryption failed. Check your passphrase and try again.',
    context?: Record<string, unknown>
  ) {
    super(message, 'VAULT_DECRYPT_FAILED', true, context);
  }
}

// ============================================================================
// Network Errors
// ============================================================================

/**
 * Thrown when a network operation fails (relay connection, API call, etc.)
 *
 * Recoverable: true — user can retry when connectivity is restored.
 */
export class NetworkError extends SatnamError {
  constructor(
    message: string = 'Network request failed. Check your connection and try again.',
    context?: Record<string, unknown>
  ) {
    super(message, 'NETWORK_ERROR', true, context);
  }
}

/**
 * Thrown when a relay connection fails or is rejected.
 */
export class RelayError extends SatnamError {
  constructor(
    message: string = 'Relay connection failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'RELAY_ERROR', true, context);
  }
}

/**
 * Thrown when an API request to a Netlify function fails.
 */
export class ApiError extends SatnamError {
  /** HTTP status code from the API response. */
  public readonly statusCode: number;

  constructor(
    message: string,
    statusCode: number,
    context?: Record<string, unknown>
  ) {
    const recoverable = statusCode < 500 || statusCode === 429;
    super(message, `API_ERROR_${statusCode}`, recoverable, context);
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Authentication Errors
// ============================================================================

/**
 * Thrown when NIP-98 authentication fails or a required auth action cannot
 * be completed (e.g. no NIP-07 extension, failed signature).
 *
 * Recoverable: true — user can connect extension or re-authenticate.
 */
export class AuthError extends SatnamError {
  constructor(
    message: string = 'Authentication failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'AUTH_ERROR', true, context);
  }
}

/**
 * Thrown when a NIP-07 browser extension (nos2x, Alby, etc.) is not available.
 *
 * Recoverable: true — user can install an extension.
 */
export class Nip07NotAvailableError extends SatnamError {
  constructor(
    message: string = 'No NIP-07 browser extension found. Install nos2x or Alby to continue.',
    context?: Record<string, unknown>
  ) {
    super(message, 'NIP07_NOT_AVAILABLE', true, context);
  }
}

// ============================================================================
// NWC (Nostr Wallet Connect) Errors
// ============================================================================

/**
 * Thrown when a Nostr Wallet Connect operation fails.
 *
 * Recoverable: usually true — wallet may be offline or connection expired.
 */
export class NwcError extends SatnamError {
  constructor(
    message: string = 'Wallet connection error.',
    recoverable: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message, 'NWC_ERROR', recoverable, context);
  }
}

/**
 * Thrown when an NWC payment fails.
 */
export class NwcPaymentError extends SatnamError {
  constructor(
    message: string = 'Payment failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'NWC_PAYMENT_FAILED', true, context);
  }
}

/**
 * Thrown when NWC wallet has insufficient balance.
 */
export class NwcInsufficientFundsError extends SatnamError {
  constructor(
    message: string = 'Insufficient wallet balance.',
    context?: Record<string, unknown>
  ) {
    super(message, 'NWC_INSUFFICIENT_FUNDS', true, context);
  }
}

// ============================================================================
// FROST / Bifrost Errors
// ============================================================================

/**
 * Thrown when a FROST threshold signing operation fails.
 *
 * Recoverable: depends on the cause (quorum loss vs. transient failure).
 */
export class FrostError extends SatnamError {
  constructor(
    message: string = 'FROST signing error.',
    recoverable: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message, 'FROST_ERROR', recoverable, context);
  }
}

/**
 * Thrown when FROST quorum cannot be reached (insufficient signers).
 *
 * Recoverable: true — more group members need to come online.
 */
export class FrostQuorumError extends SatnamError {
  constructor(
    message: string = 'FROST signing quorum not reached. More group members must be online.',
    context?: Record<string, unknown>
  ) {
    super(message, 'FROST_QUORUM_NOT_REACHED', true, context);
  }
}

/**
 * Thrown when a FROST DKG (Distributed Key Generation) ceremony fails.
 */
export class FrostDkgError extends SatnamError {
  constructor(
    message: string = 'FROST key generation ceremony failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'FROST_DKG_FAILED', false, context);
  }
}

// ============================================================================
// NIP-05 / Identity Errors
// ============================================================================

/**
 * Thrown when username registration fails.
 */
export class RegistrationError extends SatnamError {
  constructor(
    message: string = 'Identity registration failed.',
    context?: Record<string, unknown>
  ) {
    super(message, 'REGISTRATION_FAILED', true, context);
  }
}

// ============================================================================
// Global Error Handler
// ============================================================================

/**
 * Convert any unknown thrown value into a SatnamError.
 *
 * Use this in catch blocks to ensure all errors are typed before handling.
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (err) {
 *   const satnamErr = handleError(err);
 *   reportError(satnamErr);
 *   showErrorToUser(satnamErr.message);
 * }
 * ```
 */
export function handleError(error: unknown): SatnamError {
  if (error instanceof SatnamError) {
    return error;
  }

  if (error instanceof Error) {
    // Network/fetch errors
    if (
      error.name === 'TypeError' &&
      (error.message.includes('fetch') || error.message.includes('network'))
    ) {
      return new NetworkError(error.message);
    }

    // Wrap generic errors
    return new SatnamError(
      error.message || 'An unexpected error occurred.',
      'UNKNOWN_ERROR',
      true
    );
  }

  if (typeof error === 'string') {
    return new SatnamError(error, 'UNKNOWN_ERROR', true);
  }

  return new SatnamError(
    'An unexpected error occurred.',
    'UNKNOWN_ERROR',
    true
  );
}

// ============================================================================
// Error Reporting (console-only — no Sentry per S3 invariant)
// ============================================================================

/**
 * Report an error to the console.
 *
 * S3 invariant: No @sentry/* package. All error reporting is console-only.
 * S11 invariant: The context object must not contain key material.
 *
 * In production, this could be extended to push to a privacy-respecting
 * analytics endpoint, but only with explicit user opt-in.
 *
 * @param error - The SatnamError to report
 */
export function reportError(error: SatnamError): void {
  const report = {
    name: error.name,
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    // S11 invariant: context is logged only in development
    ...(import.meta.env?.DEV && error.context ? { context: error.context } : {}),
    timestamp: new Date().toISOString(),
  };

  if (error.recoverable) {
    console.warn('[Satnam error]', report);
  } else {
    console.error('[Satnam fatal error]', report);
  }
}

// ============================================================================
// Type Guards
// ============================================================================

/** Type guard: is this a SatnamError? */
export function isSatnamError(error: unknown): error is SatnamError {
  return error instanceof SatnamError;
}

/** Type guard: is this a VaultLockedError? */
export function isVaultLockedError(error: unknown): error is VaultLockedError {
  return error instanceof VaultLockedError;
}

/** Type guard: is this a NetworkError? */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/** Type guard: is this an AuthError? */
export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/** Type guard: is this an NwcError? */
export function isNwcError(error: unknown): error is NwcError {
  return error instanceof NwcError;
}

/** Type guard: is this a FrostError? */
export function isFrostError(error: unknown): error is FrostError {
  return error instanceof FrostError;
}
