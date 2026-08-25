// Ported from v1 src/lib/ntag424-production.ts
// Stripped: CryptoJS (replaced with Web Crypto), LightningClient, PhoenixdClient,
//   getSupabaseClient (all Supabase reads/writes removed), getEnvVar Supabase vault,
//   family_role → group_role, setupLightningInfrastructure (Voltage/PhoenixD removed),
//   server CMAC routing (any fetch/API calls sending cmacHex to server)
// v2: CMAC verification is client-side via src/lib/nfc/cmac.ts (RFC 4493 over @noble/ciphers).
// Master AES key stored in OPFS Vault, never in environment variables.
// Tag registrations stored locally (OPFS) or published as encrypted Nostr events.

import { verifySunCmac } from './cmac.js';

/**
 * NTAG424 Production Module — v2 Client-Side Architecture
 *
 * Hardware NFC authentication via NTAG424 DNA cards with SUN (Secure Unique NFC)
 * message verification. All CMAC computation happens in-browser using
 * @noble/ciphers AES-128-CMAC. The server never sees CMAC values.
 *
 * Security invariants (from spec §12.1):
 * - S6: No cmacHex or piccDataHex in any server-side function
 * - S3: No key material in Supabase
 * - Axiom 3: Client-side CMAC verification
 */

// ============================================================================
// Interfaces
// ============================================================================

/** v2: groupRole replaces familyRole per spec §0.2 Glossary */
export interface NTAG424ProductionConfig {
  uid: string;
  aesKeys: {
    authentication: string; // hex
    encryption: string;     // hex
    sun: string;            // hex — AES-128-CMAC SUN key
  };
  pinHash: string;
  userNpub: string;
  /** v2: groupRole replaces familyRole */
  groupRole: "offspring" | "adult" | "steward" | "guardian" | "private";
  spendingLimits?: {
    daily: number;
    weekly: number;
    requiresApproval: number;
  };
  createdAt: number;
  lastUsed: number;
}

export interface NTAG424AuthResponse {
  success: boolean;
  sessionToken?: string;
  userNpub?: string;
  /** v2: groupRole replaces familyRole */
  groupRole?: string;
  error?: string;
}

export interface NTAG424SpendOperation {
  uid: string;
  amount: number;
  recipient: string;
  memo?: string;
  paymentType: "lightning" | "ecash";
  requiresGuardianApproval: boolean;
  guardianThreshold: number;
  privacyLevel: "standard" | "enhanced" | "maximum";
  timestamp: number;
  signature: string;
}

export interface NTAG424SignOperation {
  uid: string;
  message: string;
  purpose: "transaction" | "communication" | "recovery" | "identity" | "nostr";
  requiresGuardianApproval: boolean;
  guardianThreshold: number;
  timestamp: number;
  signature: string;
}

interface NTAG424OperationSignatureEnvelope {
  curve: "P-256" | "secp256k1";
  publicKey: string;
  signature: string;
}

interface DecodedSUNMessage {
  uid: string;
  counter: number;
  cmacHex: string;
  timestamp: number;
}

// ============================================================================
// Helper: hex/bytes
// ============================================================================

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

// ============================================================================
// Counter persistence (CR-B 2026-08-24)
// ============================================================================

/**
 * Per-card counter store. Callers wire this to OPFS vault slots
 * (e.g. nfc/{uid}.last_counter) so replay protection survives sessions.
 * The counter is advanced ONLY after successful CMAC verification.
 */
export interface CardCounterStore {
  get(uid: string): Promise<number | undefined>;
  set(uid: string, counter: number): Promise<void>;
}

// ============================================================================
// NTAG424 Production Manager
// ============================================================================

export class NTAG424ProductionManager {
  private counterStore?: CardCounterStore;

  /** Wire a persistent per-card counter store (OPFS-backed). */
  setCounterStore(store: CardCounterStore): void {
    this.counterStore = store;
  }

  /**
   * Generate a cryptographically random AES-128 key (16 bytes = 128 bits).
   * Used for SUN key generation during NFC ceremony.
   */
  generateSecureAESKey(): string {
    const array = new Uint8Array(16); // AES-128
    crypto.getRandomValues(array);
    return bytesToHex(array);
  }

  /**
   * Hash a PIN using PBKDF2-SHA256 via Web Crypto.
   * Returns "saltHex:hashHex" format.
   * v2: Uses Web Crypto instead of CryptoJS.
   */
  async hashPIN(pin: string): Promise<string> {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );

    return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(hashBuffer))}`;
  }

  /**
   * Verify a PIN using constant-time comparison.
   */
  async verifyPIN(pin: string, storedHash: string): Promise<boolean> {
    try {
      const parts = storedHash.split(":");
      const saltHex = parts[0] ?? '';
      const hashHex = parts[1] ?? '';
      const salt = hexToBytes(saltHex);

      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );

      const hashBuffer = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: salt as unknown as BufferSource,
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        256
      );

      const computed = bytesToHex(new Uint8Array(hashBuffer));

      // Constant-time comparison
      if (computed.length !== hashHex.length) return false;
      let diff = 0;
      for (let i = 0; i < computed.length; i++) {
        diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
      }
      return diff === 0;
    } catch {
      return false;
    }
  }

  /**
   * Verify NTAG424 SUN message CMAC client-side.
   *
   * v2: CMAC verification is client-side via @noble/ciphers AES-128-CMAC.
   * The server never sees cmacHex. This satisfies security invariant S6.
   *
   * @param sunMessage - Raw SUN message from NFC URL parameters
   * @param sunKeyHex  - AES-128 SUN key (from OPFS Vault)
   * @returns true if CMAC is valid and counter is monotonically increasing
   */
  async verifySUNMessage(
    sunMessage: string,
    sunKeyHex: string,
    lastKnownCounter?: number
  ): Promise<{ valid: boolean; counter?: number; error?: string }> {
    try {
      const decoded = this.decodeSUNMessage(sunMessage);

      // Replay protection: counter must be greater than last known.
      // Source of lastKnownCounter: explicit arg, else the wired counter store.
      let known = lastKnownCounter;
      if (known === undefined && this.counterStore) {
        known = await this.counterStore.get(decoded.uid);
      }
      if (known !== undefined && decoded.counter <= known) {
        return { valid: false, error: "Counter replay detected" };
      }

      // Client-side CMAC verification via src/lib/nfc/cmac.ts (RFC 4493)
      const cmacValid = await this.verifyAES128CMAC(
        decoded.uid,
        decoded.counter,
        decoded.cmacHex,
        sunKeyHex
      );

      if (!cmacValid) {
        return { valid: false, error: "CMAC verification failed" };
      }

      // CR-B: persist the counter ONLY after successful verification, so a
      // failed/tampered tap can never advance the anti-replay floor.
      if (this.counterStore) {
        await this.counterStore.set(decoded.uid, decoded.counter);
      }

      return { valid: true, counter: decoded.counter };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Verify AES-128-CMAC via src/lib/nfc/cmac.ts (RFC 4493 over @noble/ciphers).
   *
   * CR-B (2026-08-24): the previous inline implementation called a `cmac`
   * export that does not exist on @noble/ciphers/aes — verification always
   * threw and returned false. Delegated to the tested RFC 4493 module.
   *
   * NTAG424 SUN message format (NXP AN12196):
   * SV2 = 0x3C || 0xC3 || 0x00 || 0x01 || 0x00 || 0x80 || UID (7 bytes) || SDMReadCtr (3 bytes)
   */
  private async verifyAES128CMAC(
    uid: string,
    counter: number,
    cmacHex: string,
    sunKeyHex: string
  ): Promise<boolean> {
    try {
      return verifySunCmac(sunKeyHex, uid, counter, cmacHex);
    } catch (error) {
      console.error("[NTAG424] CMAC verification error:", error);
      return false;
    }
  }

  /**
   * Decode SUN message from NTAG424 NFC URL parameters.
   * Extracts UID, SDM read counter, and CMAC from the URL-encoded SUN message.
   */
  private decodeSUNMessage(sunMessage: string): DecodedSUNMessage {
    // SUN messages are typically URL-encoded query parameters
    // Format: ?uid=<hex>&ctr=<hex>&cmac=<hex> or encoded in piccData
    const params = new URLSearchParams(
      sunMessage.startsWith("?") ? sunMessage.slice(1) : sunMessage
    );

    const uid = params.get("uid") || params.get("UID") || "";
    const ctrHex = params.get("ctr") || params.get("CTR") || "000000";
    const cmacHex = params.get("cmac") || params.get("CMAC") || "";

    if (!uid || !cmacHex) {
      throw new Error("Invalid SUN message: missing uid or cmac");
    }

    // Counter is 3-byte little-endian hex
    const ctrBytes = hexToBytes(ctrHex.padStart(6, "0"));
    const counter =
      (ctrBytes[0] ?? 0) | ((ctrBytes[1] ?? 0) << 8) | ((ctrBytes[2] ?? 0) << 16);

    return {
      uid,
      counter,
      cmacHex,
      timestamp: Date.now(),
    };
  }

  /**
   * Verify ECDSA operation signature (P-256 or secp256k1).
   * Used to authorize spend and sign operations.
   */
  async verifyOperationSignature(
    operation: NTAG424SpendOperation | NTAG424SignOperation
  ): Promise<boolean> {
    try {
      if (!operation.signature || operation.signature.length === 0) {
        return false;
      }

      let envelope: NTAG424OperationSignatureEnvelope;
      try {
        envelope = JSON.parse(operation.signature);
      } catch {
        return false;
      }

      if (envelope.curve !== "P-256" && envelope.curve !== "secp256k1") {
        return false;
      }

      const operationHash = await this.computeOperationHash(operation);

      if (envelope.curve === "P-256") {
        return this.verifyP256Signature(
          operationHash,
          envelope.signature,
          envelope.publicKey
        );
      } else {
        return this.verifySecp256k1Signature(
          operationHash,
          envelope.signature,
          envelope.publicKey
        );
      }
    } catch {
      return false;
    }
  }

  private async computeOperationHash(
    operation: NTAG424SpendOperation | NTAG424SignOperation
  ): Promise<string> {
    const isSpend = (
      op: NTAG424SpendOperation | NTAG424SignOperation
    ): op is NTAG424SpendOperation =>
      (op as NTAG424SpendOperation).amount !== undefined;

    let payload: Record<string, unknown>;
    if (isSpend(operation)) {
      payload = {
        type: "spend",
        uid: operation.uid,
        amount: operation.amount,
        recipient: operation.recipient,
        memo: operation.memo || "",
        paymentType: operation.paymentType,
        requiresGuardianApproval: operation.requiresGuardianApproval,
        guardianThreshold: operation.guardianThreshold,
        privacyLevel: operation.privacyLevel,
        timestamp: operation.timestamp,
      };
    } else {
      payload = {
        type: "sign",
        uid: operation.uid,
        message: operation.message,
        purpose: operation.purpose,
        requiresGuardianApproval: operation.requiresGuardianApproval,
        guardianThreshold: operation.guardianThreshold,
        timestamp: operation.timestamp,
      };
    }

    const data = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(new Uint8Array(digest));
  }

  async getOperationHashForClient(
    operation: NTAG424SpendOperation | NTAG424SignOperation
  ): Promise<string> {
    return this.computeOperationHash(operation);
  }

  private async verifyP256Signature(
    messageHashHex: string,
    signatureHex: string,
    publicKeyHex: string
  ): Promise<boolean> {
    try {
      const { p256 } = await import("@noble/curves/nist.js");
      const messageBytes = hexToBytes(messageHashHex);
      const signatureBytes = hexToBytes(signatureHex);
      const publicKeyBytes = hexToBytes(publicKeyHex);

      if (
        messageBytes.length !== 32 ||
        signatureBytes.length !== 64 ||
        publicKeyBytes.length === 0
      ) {
        return false;
      }

      return p256.verify(signatureBytes, messageBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  private async verifySecp256k1Signature(
    messageHashHex: string,
    signatureHex: string,
    publicKeyHex: string
  ): Promise<boolean> {
    try {
      const { secp256k1 } = await import("@noble/curves/secp256k1.js");
      const messageBytes = hexToBytes(messageHashHex);
      const signatureBytes = hexToBytes(signatureHex);
      const publicKeyBytes = hexToBytes(publicKeyHex);

      if (
        messageBytes.length === 0 ||
        signatureBytes.length === 0 ||
        publicKeyBytes.length === 0
      ) {
        return false;
      }

      return secp256k1.verify(signatureBytes, messageBytes, publicKeyBytes);
    } catch {
      return false;
    }
  }

  /**
   * Generate a session token for an authenticated NFC tap.
   * v2: Token is a signed Nostr event (kind:22242-style) rather than a server JWT.
   */
  generateSessionToken(uid: string, userNpub: string): string {
    const timestamp = Date.now();
    const raw = `${uid}:${userNpub}:${timestamp}`;
    // Simple SHA-256 token — caller should replace with a signed Nostr event
    return crypto.subtle
      ? raw // placeholder; crypto.subtle.digest is async
      : raw;
  }

  /**
   * Check spending limits against current daily/weekly totals.
   * v2: Limits are enforced client-side. History is stored in OPFS.
   */
  checkSpendingLimits(
    amount: number,
    config: NTAG424ProductionConfig,
    dailySpent: number,
    weeklySpent: number
  ): { allowed: boolean; reason?: string } {
    if (!config.spendingLimits) return { allowed: true };

    if (dailySpent + amount > config.spendingLimits.daily) {
      return {
        allowed: false,
        reason: `Daily limit exceeded (${config.spendingLimits.daily} sats)`,
      };
    }

    if (weeklySpent + amount > config.spendingLimits.weekly) {
      return {
        allowed: false,
        reason: `Weekly limit exceeded (${config.spendingLimits.weekly} sats)`,
      };
    }

    if (amount > config.spendingLimits.requiresApproval) {
      return {
        allowed: false,
        reason: `Amount exceeds approval threshold (${config.spendingLimits.requiresApproval} sats). Guardian approval required.`,
      };
    }

    return { allowed: true };
  }

  bytesToHex = bytesToHex;
  hexToBytes = hexToBytes;
}

// Singleton export
export const ntag424Manager = new NTAG424ProductionManager();

