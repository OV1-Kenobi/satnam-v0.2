# OPFS Vault

**Module path:** `src/lib/vault/`
**Type definitions:** `src/lib/vault/types.ts`
**Import alias:** `@lib/vault`

---

## What Is the OPFS Vault?

The OPFS Vault is the root of all key custody in Satnam v2. Every secret material — nsec keys, FROST shares, NWC URIs, NFC AES keys, NIP-46 pairing state, agent credentials, and Cashu proofs — lives here and **nowhere else**.

It wraps the browser's [Origin Private File System (OPFS)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) with a layered encryption scheme:

1. A **random 256-bit master key** is generated once during vault initialization.
2. The master key is encrypted under a **wrapping key** (derived from WebAuthn PRF or argon2id passphrase) and stored in OPFS.
3. All vault entries are encrypted under the master key using **XChaCha20-Poly1305** (`@noble/ciphers`).

The server never sees key material. The vault auto-locks after a configurable idle timeout by zeroing the master key from the JavaScript heap.

### Security Invariants

| # | Invariant |
|---|---|
| S1 | Key material is stored only in OPFS — not localStorage, sessionStorage, IndexedDB (as primary storage), cookies, URL params, or Supabase. |
| S2 | No key material is transmitted to any server. |
| S3 | Vault auto-locks after idle timeout (default 15 min, configurable 5–60 min). Lock zeroes master key from JS heap. |
| S4 | Vault backup is encrypted under the master key. Restoring without the wrapping key is computationally infeasible. |
| S5 | Vault errors are typed enums with no data payloads — key material never appears in error logs. |

---

## Vault Directory Structure

```
OPFS root (navigator.storage.getDirectory())
└── satnam/vault/
    ├── master.key             ← AES-256-GCM encrypted master key
    ├── wrapping.meta          ← WrappingKeyMeta (method, argon2 params, credential ID)
    ├── identities/
    │   └── {npub}.nsec        ← XChaCha20-Poly1305 encrypted nsec (32 bytes raw)
    ├── frost/
    │   ├── {groupNpub}.bfprofile  ← Encrypted FROSTR v2 group profile
    │   └── {groupNpub}.bfshare    ← Encrypted individual FROST share (SENSITIVE)
    ├── nwc/
    │   └── {connectionId}.uri     ← Encrypted NWC URI string
    ├── nfc/
    │   ├── {cardUid}.k1           ← Encrypted NTAG424 AES-128 SUN key
    │   └── {cardUid}.k2           ← Encrypted NTAG424 AES-128 secondary key
    ├── nip46/
    │   └── {sessionId}.pairing    ← Encrypted NIP-46 ephemeral keypair + secret
    ├── agents/
    │   ├── {agentNpub}.nsec       ← Encrypted agent nsec
    │   └── {agentNpub}.llm_keys   ← Encrypted LLM provider API keys
    └── cashu/
        └── {mintUrlHash}.proofs   ← Encrypted Cashu proof array (JSON → encrypted)
```

---

## Type Definitions

### `VaultConfig`

```typescript
interface VaultConfig {
  /**
   * Idle timeout before auto-lock (ms).
   * Range: [300_000, 3_600_000] (5–60 min). Default: 900_000 (15 min).
   */
  idleTimeoutMs: number;

  /** OPFS root path. Default: 'satnam/vault' */
  vaultRoot: string;
}

const DEFAULT_VAULT_CONFIG: VaultConfig = {
  idleTimeoutMs: 900_000,
  vaultRoot: 'satnam/vault',
};
```

### `VaultError`

Typed error discriminant — no data payloads.

```typescript
enum VaultError {
  VaultLocked      = 'VaultLocked',       // Operation attempted while locked
  IdentityNotFound = 'IdentityNotFound',  // Requested npub/key not in vault
  DecryptionFailed = 'DecryptionFailed',  // Wrong key or corrupt data
  StorageFull      = 'StorageFull',       // OPFS quota exhausted
}
```

### `WrappingKeyMeta`

Metadata describing how the wrapping key is derived. Stored in OPFS as plaintext (not secret).

```typescript
interface WrappingKeyMeta {
  method: 'passphrase' | 'webauthn';
  /** base64-encoded salt (passphrase) or credential ID (webauthn) */
  credential: string;
  /** argon2id params — present for 'passphrase' method only */
  argon2Params?: { m: number; t: number; p: number; keyLen: number };
  createdAt: string; // ISO 8601
}
```

### `Nip46PairingState`

```typescript
interface Nip46PairingState {
  ephemeralPubkey: string;      // Hex-encoded ephemeral pubkey
  ephemeralSecretKey: Uint8Array; // 32-byte raw secret
  remotePubkey: string;         // Remote NIP-46 signer pubkey
  connectUri?: string;          // Nostr Connect URI
  establishedAt: string;        // ISO 8601
  expiresAt?: string;           // ISO 8601 TTL
  relays: string[];
}
```

### `EncryptedLlmKeys`

```typescript
interface EncryptedLlmKeys {
  openaiKey?: string;
  anthropicKey?: string;
  openrouterKey?: string;
  groqKey?: string;
  additionalKeys: Record<string, string>;
}
```

---

## API Reference

All methods are on the `VaultOps` interface. The concrete implementation is instantiated by the `useVault` hook.

### Lifecycle

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `initialize` | `method: 'webauthn' \| 'passphrase'`, `credential: Uint8Array \| string` | `Promise<void>` | Initialize vault, generate master key, create OPFS structure |
| `unlock` | `method`, `credential` | `Promise<void>` | Decrypt master key into JS heap. Throws `DecryptionFailed` on wrong credential |
| `lock` | — | `void` | Zero master key from JS heap. All subsequent ops throw `VaultLocked` |
| `isUnlocked` | — | `boolean` | Returns `true` if master key is in memory |

### Identity (nsec)

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeNsec` | `npub: string`, `nsec: Uint8Array` | `Promise<void>` | Encrypt and store a 32-byte nsec for the given npub |
| `getNsec` | `npub: string` | `Promise<Uint8Array>` | Decrypt and return the nsec. Throws `IdentityNotFound` |
| `deleteNsec` | `npub: string` | `Promise<void>` | Remove the nsec file. No-op if not found |
| `listIdentities` | — | `Promise<string[]>` | Return all stored npub values |

### FROST Shares

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeBfprofile` | `groupNpub: string`, `profile: Uint8Array` | `Promise<void>` | Store encrypted FROSTR v2 group profile |
| `getBfprofile` | `groupNpub: string` | `Promise<Uint8Array>` | Retrieve group profile |
| `storeBfshare` | `groupNpub: string`, `share: Uint8Array` | `Promise<void>` | Store encrypted individual FROST share |
| `getBfshare` | `groupNpub: string` | `Promise<Uint8Array>` | Retrieve FROST share |

### NWC URIs

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeNwcUri` | `connectionId: string`, `uri: string` | `Promise<void>` | Store encrypted `nostr+walletconnect://` URI |
| `getNwcUri` | `connectionId: string` | `Promise<string>` | Decrypt and return NWC URI |
| `deleteNwcUri` | `connectionId: string` | `Promise<void>` | Remove NWC URI |

### NFC Keys

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeNfcKey` | `cardUid: string`, `keySlot: 'k1' \| 'k2'`, `key: Uint8Array` | `Promise<void>` | Store 16-byte AES-128 key for NTAG424 card |
| `getNfcKey` | `cardUid: string`, `keySlot: 'k1' \| 'k2'` | `Promise<Uint8Array>` | Retrieve NFC key |

### NIP-46 Pairing

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeNip46Pairing` | `sessionId: string`, `pairing: Nip46PairingState` | `Promise<void>` | Store encrypted pairing session |
| `getNip46Pairing` | `sessionId: string` | `Promise<Nip46PairingState>` | Retrieve pairing session |
| `deleteNip46Pairing` | `sessionId: string` | `Promise<void>` | Remove pairing session |

### Agent Credentials

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeAgentNsec` | `agentNpub: string`, `nsec: Uint8Array` | `Promise<void>` | Store agent nsec |
| `getAgentNsec` | `agentNpub: string` | `Promise<Uint8Array>` | Retrieve agent nsec |
| `storeAgentLlmKeys` | `agentNpub: string`, `keys: EncryptedLlmKeys` | `Promise<void>` | Store LLM provider API keys |
| `getAgentLlmKeys` | `agentNpub: string` | `Promise<EncryptedLlmKeys>` | Retrieve LLM keys |

### Cashu Proofs

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `storeCashuProofs` | `mintUrlHash: string`, `proofs: CashuProof[]` | `Promise<void>` | Serialize and encrypt Cashu proof array |
| `getCashuProofs` | `mintUrlHash: string` | `Promise<CashuProof[]>` | Decrypt and deserialize proof array |

### Backup

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `exportEncryptedBackup` | — | `Promise<Uint8Array>` | Full vault export encrypted under master key |
| `importEncryptedBackup` | `data: Uint8Array`, `wrappingKey: Uint8Array` | `Promise<void>` | Restore from backup. Requires original wrapping key |

---

## Wrapping Key Derivation

### Option A — WebAuthn PRF (Preferred)

WebAuthn Pseudo-Random Function extension provides a device-bound, user-verified 32-byte key. The key is re-derived on each unlock via a biometric or hardware credential — it is never stored.

```typescript
// During vault initialization:
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Satnam', id: 'satnam.pub' },
    user: { id: new Uint8Array(16), name: 'principal', displayName: 'Principal' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { userVerification: 'required' },
    extensions: {
      prf: { eval: { first: salt } },  // salt = random 32 bytes stored in OPFS
    },
  },
});

// PRF output IS the wrapping key — 32 bytes, device-bound
const wrappingKey = credential.getClientExtensionResults().prf.results.first;

// On every subsequent unlock:
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rpId: 'satnam.pub',
    extensions: { prf: { eval: { first: salt } } },
  },
});
const wrappingKey = assertion.getClientExtensionResults().prf.results.first;
```

### Option B — Passphrase (argon2id fallback)

Used when the browser does not support the WebAuthn PRF extension.

```
argon2id(
  passphrase = user-entered string (≥12 characters),
  salt       = 32 bytes stored in OPFS as vault/passphrase.salt,
  m          = 65536 (64 MB RAM),
  t          = 3 iterations,
  p          = 4 parallelism
) → 32-byte wrapping key
```

In both cases the wrapping key encrypts the master key via **AES-256-GCM**. The master key then encrypts all entries via **XChaCha20-Poly1305**.

---

## Device Binding

OPFS is origin-scoped — the vault is accessible only from `https://satnam.pub`. Data stored in OPFS cannot be read by any other origin, browser profile, or server.

WebAuthn credentials are additionally bound to:
- The specific device (platform authenticator) or hardware key (FIDO2 roaming authenticator).
- The `rpId` (`satnam.pub`) — cross-origin impersonation cannot trigger the PRF.

This means a vault backup without the original device (or the passphrase) is computationally infeasible to decrypt.

---

## Quick Start

```typescript
import { useVault } from '@hooks/useVault';

function OnboardingFlow() {
  const vault = useVault();

  // Step 1 — initialize vault on first run
  async function handleSetupPassphrase(passphrase: string) {
    await vault.initialize('passphrase', passphrase);
    console.log('Vault initialized');
  }

  // Step 2 — store a newly generated nsec
  async function storeIdentity(npub: string, nsec: Uint8Array) {
    if (!vault.isUnlocked()) throw new Error('Vault locked');
    await vault.storeNsec(npub, nsec);
  }

  // Step 3 — retrieve nsec for signing
  async function signWithVault(npub: string) {
    const nsec = await vault.getNsec(npub);
    // use nsec for signing, then zero it
    nsec.fill(0);
  }

  // Step 4 — lock on navigate away
  function handleLock() {
    vault.lock();
  }
}
```

### Handling Vault Errors

```typescript
import { VaultError } from '@lib/vault/types';

try {
  const nsec = await vault.getNsec(npub);
} catch (err: unknown) {
  if (err instanceof Error) {
    switch (err.message) {
      case VaultError.VaultLocked:
        // Prompt user to unlock
        break;
      case VaultError.IdentityNotFound:
        // Identity not yet stored — redirect to onboarding
        break;
      case VaultError.DecryptionFailed:
        // Corrupt data or wrong credential
        break;
    }
  }
}
```

---

## Related

- [useVault hook](../hooks/use-vault.md)
- [FROST library](./frost.md) — reads `bfshare`/`bfprofile` from vault
- [NWC library](./nwc.md) — reads NWC URIs from vault
- [Cashu library](./cashu.md) — reads/writes Cashu proofs from vault
