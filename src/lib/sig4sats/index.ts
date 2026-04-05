/**
 * @module sig4sats
 * @description Barrel export for the Sig4Sats bond system.
 *
 * Three bond types:
 *  1. Entitlement — pay Cashu → blinded capability token for premium features
 *  2. Recovery    — guardians stake Cashu for N-of-M recovery approval
 *  3. Allowance   — guardian funds offspring allowance with blinded spending tokens
 *
 * Usage:
 * ```ts
 * import { getBondManager, createAdaptorSignature, verifyAdaptorSignature } from '@/lib/sig4sats';
 * ```
 */

// Types
export type {
  BondType,
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  GuardianBond,
  AllowanceConstraints,
  AdaptorSignature,
  ExtractedSecret,
  Sig4SatsBond,
  CreateEntitlementParams,
  CreateRecoveryParams,
  CreateAllowanceParams,
  SpendResult,
} from './types.js';

// Bond Manager
export { BondManager, getBondManager } from './bond-manager.js';

// Adaptor Signature utilities
export {
  createAdaptorSignature,
  verifyAdaptorSignature,
  extractSecret,
  generateAdaptorPoint,
  hashMessage,
} from './adaptor.js';
