/**
 * @module nip90/marketplace
 * @description NIP-90 DVM Marketplace — full job lifecycle client.
 *
 * Integrates:
 * - {@link DvmSubscriptionManager} for relay subscriptions
 * - NWC ({@link NwcConnectionManager}) for Lightning payment
 * - CEPS for event publishing
 *
 * Provider discovery via kind:31990. Job lifecycle: submit → subscribe →
 * pay (BOLT-11 via NWC) → feedback (kind:7000).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 * @see SPECIFICATION.md §8.1 — NIP-90 DVM Marketplace (Autopilot)
 */

import { finalizeEvent, nip19 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";

import type { DvmJobRequest, DvmJobResult, DvmProvider, DvmFeedbackStatus, PaymentInfo } from "./types.js";
import { constructJobRequest, constructJobFeedback } from "./construct.js";
import { subscribeToJobResults, fetchProviders, waitForJobResult } from "./subscribe.js";
import type { NwcConnectionManager, PaymentResult } from "../nwc/connection-manager.js";
import type { CepsClient } from "../ceps/ceps-client.js";

// Re-export PaymentResult for consumers of this module
export type { PaymentResult };

// ---------------------------------------------------------------------------
// Stand-alone discoverProviders function
// ---------------------------------------------------------------------------

/**
 * Discover DVM providers that support a specific job kind.
 *
 * Queries kind:31990 events with `#k` tag matching the target job kind across
 * all provided relay URLs. Collects providers until EOSE, then returns.
 *
 * @param params.jobKind   - NIP-90 job kind to find providers for (5000-5999)
 * @param params.relayUrls - Relay WebSocket URLs to query
 * @param params.timeoutMs - Max wait time in ms (default: 10 000)
 * @returns Array of discovered DvmProvider objects
 *
 * @example
 * ```ts
 * const providers = await discoverProviders({
 *   jobKind: 5100,
 *   relayUrls: ['wss://pylon.openagents.com'],
 * });
 * ```
 */
export async function discoverProviders(params: {
  jobKind: number;
  relayUrls: string[];
  timeoutMs?: number;
}): Promise<DvmProvider[]> {
  return fetchProviders(params.jobKind, params.relayUrls, params.timeoutMs ?? 10_000);
}

// ---------------------------------------------------------------------------
// ActiveJob — tracks an in-flight job
// ---------------------------------------------------------------------------

/**
 * A job that has been submitted and is awaiting or receiving results.
 */
export interface ActiveJob {
  /** Nostr event ID of the submitted job request. */
  requestEventId: string;
  /** The original job request. */
  request: DvmJobRequest;
  /** Unix timestamp when the job was submitted. */
  submittedAt: number;
  /** Result, if already received. */
  result?: DvmJobResult;
  /** Payment result, if already paid. */
  paymentResult?: PaymentResult;
}

// ---------------------------------------------------------------------------
// DvmMarketplace
// ---------------------------------------------------------------------------

/**
 * Full DVM marketplace client integrating relay subscriptions, NWC payments,
 * and CEPS event publishing.
 *
 * @example
 * ```ts
 * const marketplace = new DvmMarketplace(cepsClient, nwcManager, subManager);
 *
 * // Full lifecycle
 * const { requestId, result, paymentResult } = await marketplace.executeJob({
 *   request: { kind: 5100, input: [...], params: [], bid_msats: 5000n },
 *   signerNsec: nsec,
 *   autoPayBelow: 10_000n,
 * });
 * ```
 */
export class DvmMarketplace {
  /** In-flight jobs keyed by request event ID. */
  private readonly activeJobs: Map<string, ActiveJob> = new Map();

  /** Default relay URLs for provider discovery and result subscription. */
  private readonly defaultRelayUrls: string[];

  constructor(
    private readonly ceps: CepsClient,
    private readonly nwc: NwcConnectionManager,
    defaultRelayUrls?: string[]
  ) {
    this.defaultRelayUrls = defaultRelayUrls ?? [
      "wss://pylon.openagents.com",
      "wss://relay.damus.io",
      "wss://nos.lol",
    ];
  }

  // -------------------------------------------------------------------------
  // Provider discovery
  // -------------------------------------------------------------------------

  /**
   * Discover providers that support a given job kind.
   *
   * @param jobKind  - NIP-90 job kind (5000-5999)
   * @param relayUrls - Optional relay overrides
   * @returns Array of DvmProvider objects
   */
  async discoverProviders(jobKind: number, relayUrls?: string[]): Promise<DvmProvider[]> {
    return fetchProviders(jobKind, relayUrls ?? this.defaultRelayUrls);
  }

  // -------------------------------------------------------------------------
  // Job submission
  // -------------------------------------------------------------------------

  /**
   * Sign and publish a NIP-90 job request event.
   *
   * The job is tracked internally and can be retrieved via {@link getActiveJobs}.
   *
   * @param request    - DVM job request parameters
   * @param signerNsec - Hex nsec used to sign the request event
   * @returns The published request event ID
   * @throws {Error} if signing or publishing fails
   */
  async submitJob(request: DvmJobRequest, signerNsec: string): Promise<string> {
    const unsigned = constructJobRequest(request);

    // Sign the event using the caller's nsec
    let secretKeyBytes: Uint8Array;
    try {
      secretKeyBytes = hexToBytes(this._decodeNsec(signerNsec));
    } catch {
      throw new Error("submitJob: invalid signerNsec — must be hex-encoded or bech32 nsec");
    }

    const signed = finalizeEvent(unsigned as any, secretKeyBytes) as any;

    // Publish via CEPS to default relays and any relay hints in the request
    const relayUrls = [
      ...this.defaultRelayUrls,
      ...(request.relays ?? []),
    ];
    const eventId = await this.ceps.publishEvent(signed, relayUrls);

    // Track as active job
    this.activeJobs.set(eventId, {
      requestEventId: eventId,
      request,
      submittedAt: Math.floor(Date.now() / 1000),
    });

    return eventId;
  }

  // -------------------------------------------------------------------------
  // Result subscription
  // -------------------------------------------------------------------------

  /**
   * Subscribe to job results for a submitted request.
   *
   * Subscribes to kind:{requestKind + 1000} events with the `#e` tag matching
   * the request event ID. Also handles kind:7000 feedback (status updates).
   *
   * @param requestEventId - Hex event ID of the submitted job request
   * @param callback       - Called for each result or status update received
   * @returns Unsubscribe function — call to clean up relay connections
   */
  subscribeToResults(
    requestEventId: string,
    callback: (result: DvmJobResult) => void
  ): () => void {
    const job = this.activeJobs.get(requestEventId);
    const requestKind = job?.request.kind ?? 5000;

    const relayUrls = [
      ...this.defaultRelayUrls,
      ...(job?.request.relays ?? []),
    ];

    const unsub = subscribeToJobResults(
      requestEventId,
      requestKind,
      relayUrls,
      (result) => {
        // Update tracked job state
        if (job && result.tags.some((t) => t[0] === "e" && t[1] === requestEventId)) {
          job.result = result;
        }
        callback(result);
      }
    );

    return unsub;
  }

  // -------------------------------------------------------------------------
  // Payment
  // -------------------------------------------------------------------------

  /**
   * Pay for a job result using NWC.
   *
   * Extracts the BOLT-11 invoice from the result's `amount` tag and pays it
   * via the NWC connection manager. Only supports BOLT-11 (not Cashu tokens).
   *
   * @param result - The DvmJobResult containing payment information
   * @returns PaymentResult with preimage and fee information
   * @throws {Error} if no invoice is present or the payment fails
   */
  async payForResult(result: DvmJobResult): Promise<PaymentResult> {
    const payment = result.payment;

    if (!payment) {
      throw new Error(
        `payForResult: job result ${result.id} has no payment info (missing amount tag)`
      );
    }

    const invoice = this._extractInvoice(payment);

    const paymentResult = await this.nwc.payInvoice(invoice);

    // Update tracked job state
    const job = this.activeJobs.get(result.requestEventId);
    if (job) {
      job.paymentResult = paymentResult;
    }

    return paymentResult;
  }

  // -------------------------------------------------------------------------
  // Feedback
  // -------------------------------------------------------------------------

  /**
   * Publish a kind:7000 feedback event after receiving a job result.
   *
   * Feedback signals to the provider whether the result was satisfactory and
   * includes payment confirmation when status is "success".
   *
   * @param params.requestEventId - Hex event ID of the original job request
   * @param params.resultEventId  - Hex event ID of the job result
   * @param params.providerPubkey - Hex pubkey of the provider
   * @param params.status         - Feedback status code
   * @param params.amountMsats    - Optional payment amount in millisatoshis
   * @param params.comment        - Optional human-readable feedback
   * @param params.signerNsec     - Hex nsec used to sign the feedback event
   * @returns The published feedback event ID
   */
  async submitFeedback(params: {
    requestEventId: string;
    resultEventId: string;
    providerPubkey: string;
    status: DvmFeedbackStatus;
    amountMsats?: bigint;
    comment?: string;
    signerNsec: string;
  }): Promise<string> {
    const {
      requestEventId,
      resultEventId,
      providerPubkey,
      status,
      amountMsats,
      comment,
      signerNsec,
    } = params;

    const unsigned = constructJobFeedback(
      requestEventId,
      resultEventId,
      providerPubkey,
      status,
      amountMsats
    );

    // Add optional comment to content
    if (comment) {
      unsigned.content = comment;
    }

    let secretKeyBytes: Uint8Array;
    try {
      secretKeyBytes = hexToBytes(this._decodeNsec(signerNsec));
    } catch {
      throw new Error("submitFeedback: invalid signerNsec");
    }

    const signed = finalizeEvent(unsigned as any, secretKeyBytes) as any;
    const eventId = await this.ceps.publishEvent(signed, this.defaultRelayUrls);
    return eventId;
  }

  // -------------------------------------------------------------------------
  // Full job lifecycle
  // -------------------------------------------------------------------------

  /**
   * Execute a complete NIP-90 job lifecycle:
   * 1. Submit the job request
   * 2. Wait for the first result
   * 3. Auto-pay the invoice if `autoPayBelow` is set and amount qualifies
   * 4. Publish kind:7000 feedback
   *
   * @param params.request      - DVM job request
   * @param params.signerNsec   - Hex nsec for signing events
   * @param params.autoPayBelow - Auto-pay if invoice amount ≤ this (msats)
   * @param params.timeout      - Max wait time for result in ms (default: 60 000)
   * @returns Object with requestId, result, optional paymentResult and feedbackId
   * @throws {Error} if the job times out or a critical step fails
   */
  async executeJob(params: {
    request: DvmJobRequest;
    signerNsec: string;
    autoPayBelow?: bigint;
    timeout?: number;
  }): Promise<{
    requestId: string;
    result: DvmJobResult;
    paymentResult?: PaymentResult;
    feedbackId?: string;
  }> {
    const { request, signerNsec, autoPayBelow, timeout = 60_000 } = params;

    // Step 1: Submit the job
    const requestId = await this.submitJob(request, signerNsec);

    // Step 2: Wait for the first result
    const relayUrls = [
      ...this.defaultRelayUrls,
      ...(request.relays ?? []),
    ];

    const result = await waitForJobResult(requestId, request.kind, relayUrls, timeout);

    let paymentResult: PaymentResult | undefined;
    let feedbackId: string | undefined;

    // Step 3: Auto-pay if conditions are met
    if (result.payment && autoPayBelow !== undefined) {
      const amountMsats = result.payment.amountMsats;
      if (amountMsats <= autoPayBelow && result.payment.invoice) {
        try {
          paymentResult = await this.payForResult(result);
        } catch (payErr) {
          console.warn(
            `[marketplace] Auto-pay failed for job ${requestId}: ${
              payErr instanceof Error ? payErr.message : String(payErr)
            }`
          );
        }
      }
    }

    // Step 4: Publish feedback
    try {
      feedbackId = await this.submitFeedback({
        requestEventId: requestId,
        resultEventId: result.id,
        providerPubkey: result.providerPubkey,
        status: paymentResult ? "success" : "partial",
        amountMsats: paymentResult ? result.payment?.amountMsats : undefined,
        signerNsec,
      });
    } catch (fbErr) {
      console.warn(
        `[marketplace] Feedback publish failed for job ${requestId}: ${
          fbErr instanceof Error ? fbErr.message : String(fbErr)
        }`
      );
    }

    return { requestId, result, paymentResult, feedbackId };
  }

  // -------------------------------------------------------------------------
  // Active job tracking
  // -------------------------------------------------------------------------

  /**
   * Return all in-flight jobs for a given consumer pubkey.
   *
   * Currently returns jobs tracked since the marketplace instance was created.
   * Future: query relay for kind:5xxx events from the pubkey.
   *
   * @param _pubkey - Consumer pubkey (currently unused — returns all tracked jobs)
   * @returns Array of ActiveJob objects
   */
  async getActiveJobs(_pubkey: string): Promise<ActiveJob[]> {
    return Array.from(this.activeJobs.values()).filter((job) => !job.result);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Decode an nsec to raw hex bytes.
   * Handles both raw 64-char hex and bech32 "nsec1..." encoding.
   *
   * @internal
   */
  private _decodeNsec(nsec: string): string {
    if (/^[0-9a-f]{64}$/i.test(nsec)) {
      return nsec;
    }
    // Attempt bech32 decode (nsec1...)
    try {
      const decoded = nip19.decode(nsec);
      if (decoded.type === "nsec") {
        const bytes = decoded.data as Uint8Array;
        return Array.from(bytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
    } catch {
      // Fall through — will throw at hexToBytes in caller
    }
    return nsec;
  }

  /**
   * Extract a payable invoice from PaymentInfo.
   * Throws if no BOLT-11 invoice is available (Cashu not supported).
   *
   * @internal
   */
  private _extractInvoice(payment: PaymentInfo): string {
    if (payment.isCashu) {
      throw new Error(
        "payForResult: Cashu token payments are not supported. Only BOLT-11 invoices can be paid via NWC."
      );
    }

    if (!payment.invoice) {
      throw new Error(
        "payForResult: provider result has an amount tag but no BOLT-11 invoice. " +
          "This provider may require a separate payment step."
      );
    }

    return payment.invoice;
  }
}

// Re-export constructJobFeedback so callers of this module don't need two imports
export { constructJobFeedback } from "./construct.js";


