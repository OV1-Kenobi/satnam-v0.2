/**
 * @module payments
 * @description Payments subsystem barrel export for Satnam v2.
 *
 * Exports the payment scheduler, cascade engine, and atomic swap engine,
 * along with all shared payment types.
 *
 * @example
 * ```typescript
 * import {
 *   PaymentScheduler,
 *   CascadeEngine,
 *   AtomicSwapEngine,
 * } from '@/lib/payments';
 * ```
 */

export { PaymentScheduler } from './scheduler.js';
export { CascadeEngine } from './cascade.js';
export { AtomicSwapEngine } from './atomic-swap.js';

export type {
  // Rail and schedule types
  PaymentRail,
  PaymentScheduleType,
  RecurrenceInterval,

  // Scheduled payments
  PaymentCondition,
  PaymentSchedule,
  PaymentExecution,
  ScheduledPayment,
  ScheduledPaymentSerialized,

  // Cascades
  CascadeNode,
  CascadeNodeResult,
  PaymentCascade,
  CascadeExecution,
  CascadeNodeSerialized,
  PaymentCascadeSerialized,

  // Atomic swaps
  SwapType,
  AtomicSwapRequest,
  AtomicSwapQuote,
  AtomicSwapResult,
  SwapStep,
} from './types.js';

export {
  serializeScheduledPayment,
  deserializeScheduledPayment,
  serializeCascadeNode,
  deserializeCascadeNode,
} from './types.js';
