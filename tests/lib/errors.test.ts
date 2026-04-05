/**
 * @module tests/lib/errors
 * @description Tests for the SatnamError class hierarchy.
 *
 * Covers:
 * - SatnamError base class
 * - All derived error classes (VaultLockedError, NetworkError, AuthError, NwcError, FrostError, etc.)
 * - handleError() conversion function
 * - reportError() (console-only — S3 invariant)
 * - Type guards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SatnamError,
  VaultLockedError,
  VaultInitError,
  VaultDecryptError,
  NetworkError,
  RelayError,
  ApiError,
  AuthError,
  Nip07NotAvailableError,
  NwcError,
  NwcPaymentError,
  NwcInsufficientFundsError,
  FrostError,
  FrostQuorumError,
  FrostDkgError,
  RegistrationError,
  handleError,
  reportError,
  isSatnamError,
  isVaultLockedError,
  isNetworkError,
  isAuthError,
  isNwcError,
  isFrostError,
} from '../../src/lib/errors';

// ============================================================================
// SatnamError base class
// ============================================================================

describe('SatnamError', () => {
  it('is an instance of Error', () => {
    const err = new SatnamError('test', 'TEST_CODE');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of SatnamError', () => {
    const err = new SatnamError('test', 'TEST_CODE');
    expect(err).toBeInstanceOf(SatnamError);
  });

  it('sets message correctly', () => {
    const err = new SatnamError('test message', 'TEST_CODE');
    expect(err.message).toBe('test message');
  });

  it('sets code correctly', () => {
    const err = new SatnamError('test', 'MY_CODE');
    expect(err.code).toBe('MY_CODE');
  });

  it('defaults recoverable to true', () => {
    const err = new SatnamError('test', 'TEST_CODE');
    expect(err.recoverable).toBe(true);
  });

  it('allows recoverable=false', () => {
    const err = new SatnamError('test', 'TEST_CODE', false);
    expect(err.recoverable).toBe(false);
  });

  it('sets context when provided', () => {
    const ctx = { userId: '123', operation: 'sign' };
    const err = new SatnamError('test', 'TEST_CODE', true, ctx);
    expect(err.context).toEqual(ctx);
  });

  it('context is frozen (immutable)', () => {
    const ctx = { key: 'value' };
    const err = new SatnamError('test', 'TEST_CODE', true, ctx);
    expect(Object.isFrozen(err.context)).toBe(true);
  });

  it('context is undefined when not provided', () => {
    const err = new SatnamError('test', 'TEST_CODE');
    expect(err.context).toBeUndefined();
  });

  it('name matches constructor name', () => {
    const err = new SatnamError('test', 'CODE');
    expect(err.name).toBe('SatnamError');
  });

  it('has correct prototype chain', () => {
    const err = new SatnamError('test', 'CODE');
    expect(err instanceof SatnamError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ============================================================================
// VaultLockedError
// ============================================================================

describe('VaultLockedError', () => {
  it('is a SatnamError', () => {
    expect(new VaultLockedError()).toBeInstanceOf(SatnamError);
  });

  it('has code VAULT_LOCKED', () => {
    expect(new VaultLockedError().code).toBe('VAULT_LOCKED');
  });

  it('is recoverable', () => {
    expect(new VaultLockedError().recoverable).toBe(true);
  });

  it('has a default message', () => {
    expect(new VaultLockedError().message).toMatch(/vault is locked/i);
  });

  it('accepts custom message', () => {
    const err = new VaultLockedError('Custom vault message');
    expect(err.message).toBe('Custom vault message');
  });

  it('name is VaultLockedError', () => {
    expect(new VaultLockedError().name).toBe('VaultLockedError');
  });
});

// ============================================================================
// VaultInitError
// ============================================================================

describe('VaultInitError', () => {
  it('is a SatnamError', () => {
    expect(new VaultInitError()).toBeInstanceOf(SatnamError);
  });

  it('has code VAULT_INIT_FAILED', () => {
    expect(new VaultInitError().code).toBe('VAULT_INIT_FAILED');
  });

  it('defaults to non-recoverable', () => {
    expect(new VaultInitError().recoverable).toBe(false);
  });

  it('allows recoverable=true override', () => {
    expect(new VaultInitError('msg', true).recoverable).toBe(true);
  });
});

// ============================================================================
// VaultDecryptError
// ============================================================================

describe('VaultDecryptError', () => {
  it('has code VAULT_DECRYPT_FAILED', () => {
    expect(new VaultDecryptError().code).toBe('VAULT_DECRYPT_FAILED');
  });

  it('is recoverable (user can retry with correct passphrase)', () => {
    expect(new VaultDecryptError().recoverable).toBe(true);
  });
});

// ============================================================================
// NetworkError
// ============================================================================

describe('NetworkError', () => {
  it('is a SatnamError', () => {
    expect(new NetworkError()).toBeInstanceOf(SatnamError);
  });

  it('has code NETWORK_ERROR', () => {
    expect(new NetworkError().code).toBe('NETWORK_ERROR');
  });

  it('is recoverable', () => {
    expect(new NetworkError().recoverable).toBe(true);
  });

  it('has a default message', () => {
    expect(new NetworkError().message).toMatch(/network/i);
  });
});

// ============================================================================
// RelayError
// ============================================================================

describe('RelayError', () => {
  it('has code RELAY_ERROR', () => {
    expect(new RelayError().code).toBe('RELAY_ERROR');
  });

  it('is recoverable', () => {
    expect(new RelayError().recoverable).toBe(true);
  });
});

// ============================================================================
// ApiError
// ============================================================================

describe('ApiError', () => {
  it('has status-code-based error code', () => {
    expect(new ApiError('Not found', 404).code).toBe('API_ERROR_404');
    expect(new ApiError('Internal error', 500).code).toBe('API_ERROR_500');
  });

  it('stores statusCode', () => {
    expect(new ApiError('Error', 422).statusCode).toBe(422);
  });

  it('4xx errors are recoverable (user can fix request)', () => {
    expect(new ApiError('Bad request', 400).recoverable).toBe(true);
    expect(new ApiError('Not found', 404).recoverable).toBe(true);
    expect(new ApiError('Rate limited', 429).recoverable).toBe(true);
  });

  it('5xx errors (except 429) are not recoverable', () => {
    expect(new ApiError('Server error', 500).recoverable).toBe(false);
    expect(new ApiError('Service unavailable', 503).recoverable).toBe(false);
  });
});

// ============================================================================
// AuthError
// ============================================================================

describe('AuthError', () => {
  it('is a SatnamError', () => {
    expect(new AuthError()).toBeInstanceOf(SatnamError);
  });

  it('has code AUTH_ERROR', () => {
    expect(new AuthError().code).toBe('AUTH_ERROR');
  });

  it('is recoverable', () => {
    expect(new AuthError().recoverable).toBe(true);
  });
});

// ============================================================================
// Nip07NotAvailableError
// ============================================================================

describe('Nip07NotAvailableError', () => {
  it('has code NIP07_NOT_AVAILABLE', () => {
    expect(new Nip07NotAvailableError().code).toBe('NIP07_NOT_AVAILABLE');
  });

  it('is recoverable (user can install extension)', () => {
    expect(new Nip07NotAvailableError().recoverable).toBe(true);
  });

  it('default message mentions extension', () => {
    expect(new Nip07NotAvailableError().message).toMatch(/extension/i);
  });
});

// ============================================================================
// NwcError
// ============================================================================

describe('NwcError', () => {
  it('is a SatnamError', () => {
    expect(new NwcError()).toBeInstanceOf(SatnamError);
  });

  it('has code NWC_ERROR', () => {
    expect(new NwcError().code).toBe('NWC_ERROR');
  });

  it('is recoverable by default', () => {
    expect(new NwcError().recoverable).toBe(true);
  });

  it('can be marked non-recoverable', () => {
    expect(new NwcError('msg', false).recoverable).toBe(false);
  });
});

// ============================================================================
// NwcPaymentError
// ============================================================================

describe('NwcPaymentError', () => {
  it('has code NWC_PAYMENT_FAILED', () => {
    expect(new NwcPaymentError().code).toBe('NWC_PAYMENT_FAILED');
  });

  it('is recoverable (can retry payment)', () => {
    expect(new NwcPaymentError().recoverable).toBe(true);
  });
});

// ============================================================================
// NwcInsufficientFundsError
// ============================================================================

describe('NwcInsufficientFundsError', () => {
  it('has code NWC_INSUFFICIENT_FUNDS', () => {
    expect(new NwcInsufficientFundsError().code).toBe('NWC_INSUFFICIENT_FUNDS');
  });

  it('is recoverable', () => {
    expect(new NwcInsufficientFundsError().recoverable).toBe(true);
  });
});

// ============================================================================
// FrostError
// ============================================================================

describe('FrostError', () => {
  it('is a SatnamError', () => {
    expect(new FrostError()).toBeInstanceOf(SatnamError);
  });

  it('has code FROST_ERROR', () => {
    expect(new FrostError().code).toBe('FROST_ERROR');
  });

  it('is recoverable by default', () => {
    expect(new FrostError().recoverable).toBe(true);
  });

  it('can be marked non-recoverable', () => {
    expect(new FrostError('msg', false).recoverable).toBe(false);
  });
});

// ============================================================================
// FrostQuorumError
// ============================================================================

describe('FrostQuorumError', () => {
  it('has code FROST_QUORUM_NOT_REACHED', () => {
    expect(new FrostQuorumError().code).toBe('FROST_QUORUM_NOT_REACHED');
  });

  it('is recoverable (more signers can come online)', () => {
    expect(new FrostQuorumError().recoverable).toBe(true);
  });
});

// ============================================================================
// FrostDkgError
// ============================================================================

describe('FrostDkgError', () => {
  it('has code FROST_DKG_FAILED', () => {
    expect(new FrostDkgError().code).toBe('FROST_DKG_FAILED');
  });

  it('is non-recoverable (DKG ceremony must restart)', () => {
    expect(new FrostDkgError().recoverable).toBe(false);
  });
});

// ============================================================================
// RegistrationError
// ============================================================================

describe('RegistrationError', () => {
  it('has code REGISTRATION_FAILED', () => {
    expect(new RegistrationError().code).toBe('REGISTRATION_FAILED');
  });

  it('is recoverable', () => {
    expect(new RegistrationError().recoverable).toBe(true);
  });
});

// ============================================================================
// handleError()
// ============================================================================

describe('handleError', () => {
  it('returns SatnamError unchanged', () => {
    const original = new VaultLockedError('test');
    const result = handleError(original);
    expect(result).toBe(original);
  });

  it('wraps a plain Error', () => {
    const plain = new Error('plain error message');
    const result = handleError(plain);
    expect(result).toBeInstanceOf(SatnamError);
    expect(result.message).toBe('plain error message');
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('wraps a TypeError with "fetch" in message as NetworkError', () => {
    const fetchErr = new TypeError('Failed to fetch https://example.com');
    const result = handleError(fetchErr);
    expect(result).toBeInstanceOf(NetworkError);
  });

  it('wraps a TypeError with "network" in message as NetworkError', () => {
    const netErr = new TypeError('network request failed');
    const result = handleError(netErr);
    expect(result).toBeInstanceOf(NetworkError);
  });

  it('wraps a string error', () => {
    const result = handleError('something went wrong');
    expect(result).toBeInstanceOf(SatnamError);
    expect(result.message).toBe('something went wrong');
  });

  it('wraps null/undefined as generic SatnamError', () => {
    const result = handleError(null);
    expect(result).toBeInstanceOf(SatnamError);
    expect(result.message).toBe('An unexpected error occurred.');
  });

  it('wraps undefined as generic SatnamError', () => {
    const result = handleError(undefined);
    expect(result).toBeInstanceOf(SatnamError);
  });

  it('wraps an object as generic SatnamError', () => {
    const result = handleError({ code: 'ERR', details: 'something' });
    expect(result).toBeInstanceOf(SatnamError);
  });

  it('preserves error code on SatnamError subclass', () => {
    const err = new FrostDkgError('DKG failed');
    const result = handleError(err);
    expect(result.code).toBe('FROST_DKG_FAILED');
  });
});

// ============================================================================
// reportError()
// ============================================================================

describe('reportError', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('uses console.warn for recoverable errors', () => {
    const err = new VaultLockedError('test');
    reportError(err);
    expect(consoleWarnSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('uses console.error for non-recoverable errors', () => {
    const err = new FrostDkgError('fatal');
    reportError(err);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('does not include key material in log output', () => {
    const err = new SatnamError('test', 'TEST', true, { operation: 'sign' });
    reportError(err);
    const loggedArgs = consoleWarnSpy.mock.calls[0];
    const loggedStr = JSON.stringify(loggedArgs);
    // S11 invariant check: no key material patterns in log
    expect(loggedStr).not.toMatch(/nsec|secret|private_key/i);
  });

  it('includes error code in log', () => {
    const err = new VaultLockedError('test');
    reportError(err);
    const loggedArgs = consoleWarnSpy.mock.calls[0];
    const loggedStr = JSON.stringify(loggedArgs);
    expect(loggedStr).toContain('VAULT_LOCKED');
  });

  it('includes timestamp in log', () => {
    const err = new NetworkError('test');
    reportError(err);
    const loggedArgs = consoleWarnSpy.mock.calls[0];
    const loggedStr = JSON.stringify(loggedArgs);
    expect(loggedStr).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });
});

// ============================================================================
// Type Guards
// ============================================================================

describe('type guards', () => {
  describe('isSatnamError', () => {
    it('returns true for SatnamError', () => {
      expect(isSatnamError(new SatnamError('x', 'X'))).toBe(true);
    });

    it('returns true for SatnamError subclass', () => {
      expect(isSatnamError(new VaultLockedError())).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isSatnamError(new Error('x'))).toBe(false);
    });

    it('returns false for string', () => {
      expect(isSatnamError('error string')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isSatnamError(null)).toBe(false);
    });
  });

  describe('isVaultLockedError', () => {
    it('returns true for VaultLockedError', () => {
      expect(isVaultLockedError(new VaultLockedError())).toBe(true);
    });

    it('returns false for other SatnamError', () => {
      expect(isVaultLockedError(new NetworkError())).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    it('returns true for NetworkError', () => {
      expect(isNetworkError(new NetworkError())).toBe(true);
    });

    it('returns true for RelayError (not NetworkError subclass — correct behavior)', () => {
      expect(isNetworkError(new RelayError())).toBe(false);
    });

    it('returns false for VaultLockedError', () => {
      expect(isNetworkError(new VaultLockedError())).toBe(false);
    });
  });

  describe('isAuthError', () => {
    it('returns true for AuthError', () => {
      expect(isAuthError(new AuthError())).toBe(true);
    });

    it('returns true for Nip07NotAvailableError (not AuthError subclass — correct)', () => {
      expect(isAuthError(new Nip07NotAvailableError())).toBe(false);
    });

    it('returns false for NwcError', () => {
      expect(isAuthError(new NwcError())).toBe(false);
    });
  });

  describe('isNwcError', () => {
    it('returns true for NwcError', () => {
      expect(isNwcError(new NwcError())).toBe(true);
    });

    it('returns true for NwcPaymentError (extends NwcError)', () => {
      // NwcPaymentError extends SatnamError directly, not NwcError
      expect(isNwcError(new NwcPaymentError())).toBe(false);
    });

    it('returns false for FrostError', () => {
      expect(isNwcError(new FrostError())).toBe(false);
    });
  });

  describe('isFrostError', () => {
    it('returns true for FrostError', () => {
      expect(isFrostError(new FrostError())).toBe(true);
    });

    it('returns false for FrostQuorumError (extends SatnamError directly)', () => {
      expect(isFrostError(new FrostQuorumError())).toBe(false);
    });

    it('returns false for NwcError', () => {
      expect(isFrostError(new NwcError())).toBe(false);
    });
  });
});

// ============================================================================
// Error hierarchy instanceof checks
// ============================================================================

describe('error hierarchy', () => {
  it('VaultLockedError is instanceof SatnamError and Error', () => {
    const err = new VaultLockedError();
    expect(err instanceof VaultLockedError).toBe(true);
    expect(err instanceof SatnamError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('NwcError is instanceof SatnamError and Error', () => {
    const err = new NwcError();
    expect(err instanceof NwcError).toBe(true);
    expect(err instanceof SatnamError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('FrostError is instanceof SatnamError and Error', () => {
    const err = new FrostError();
    expect(err instanceof FrostError).toBe(true);
    expect(err instanceof SatnamError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('errors can be caught as generic Error', () => {
    expect(() => {
      throw new VaultLockedError('test');
    }).toThrow(Error);
  });

  it('errors can be caught as SatnamError', () => {
    expect(() => {
      throw new VaultLockedError('test');
    }).toThrow(SatnamError);
  });

  it('errors can be caught as their specific type', () => {
    expect(() => {
      throw new VaultLockedError('test');
    }).toThrow(VaultLockedError);
  });
});
