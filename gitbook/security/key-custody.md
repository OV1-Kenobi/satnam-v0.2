# Key Custody Model

This document defines where every piece of sensitive material lives in Satnam v2, how it is encrypted, and what happens in loss or recovery scenarios. The core principle: **key material lives only on the user's device, never on any server**.

---

## What Is Stored Where

| Material | Location | Encryption | Server Visibility |
|---|---|---|---|
| User nsec | OPFS Vault: `identities/{npub}.nsec` | XChaCha20-Poly1305 under vault master key | Never |
| User identity metadata | OPFS Vault: `identities/{npub}.meta` | XChaCha20-Poly1305 | Never |
| FROST group profile (bfprofile) | OPFS Vault: `frost/{group_npub}.bfprofile` | XChaCha20-Poly1305 | Published as kind:39200 (safe — no secret material) |
| FROST group share (bfshare) | OPFS Vault: `frost/{group_npub}.bfshare` | XChaCha20-Poly1305 | Never |
| NWC connection URI | OPFS Vault: `nwc/{connectionId}.uri` | XChaCha20-Poly1305 | Never |
| NFC AES-128 key (K1) | OPFS Vault: `nfc/{card_uid}.k1` | XChaCha20-Poly1305 | Never |
| NFC AES-128 key (K2/SUN) | OPFS Vault: `nfc/{card_uid}.k2` | XChaCha20-Poly1305 | Never |
| NIP-46 pairing state | OPFS Vault: `nip46/{session_id}.pairing` | XChaCha20-Poly1305 | Never |
| Agent nsec (local runners) | OPFS Vault: `agents/{agent_npub}.nsec` | XChaCha20-Poly1305 | Never |
| Agent LLM API keys | OPFS Vault: `agents/{agent_npub}.llm_keys` | XChaCha20-Poly1305 | Never |
| Cashu proofs | OPFS Vault: `cashu/{mint_url_hash}.proofs` | XChaCha20-Poly1305 | Never |
| Vault master key | OPFS Vault: `vault/master.key` | AES-256-GCM under wrapping key | Never |
| WebAuthn credential ID | OPFS Vault: `vault/webauthn.cred` | Not encrypted (public credential identifier) | Never |
| Passphrase salt | OPFS Vault: `vault/passphrase.salt` | Not encrypted (public salt) | Never |
| NIP-05 username → pubkey | Supabase: `nip05_identifiers` | Not encrypted (public data) | Yes — public |
| Lightning address routing | Supabase: `lightning_addresses` | Not encrypted (public data) | Yes — public |

**v1 locations that are eliminated in v2:**

| v1 Material | v1 Location | v2 Action |
|---|---|---|
| `encrypted_nsec` | Supabase `user_identities` | Migrated to OPFS Vault during ceremony; column dropped |
| `user_salt` | Supabase `user_identities` | Migrated, then column dropped |
| Shamir shares | Supabase `secret_shares` | Table dropped — replaced by FROST |
| Group nsec | Supabase `family_federations` | FROST DKG ceremony; no full nsec exists anywhere |
| NIP-46 pairing | `localStorage` | Migrated to OPFS Vault on first v2 load |

---

## OPFS Vault Encryption Details

### Structure

```
Origin Private File System (navigator.storage.getDirectory())
└── satnam/
    └── vault/
        ├── master.key          ← AES-256-GCM encrypted under wrapping key
        ├── webauthn.cred       ← WebAuthn credential ID (public, not encrypted)
        ├── passphrase.salt     ← argon2id salt (public, not secret)
        ├── identities/         ← XChaCha20-Poly1305 encrypted files
        ├── frost/              ← XChaCha20-Poly1305 encrypted files
        ├── nwc/                ← XChaCha20-Poly1305 encrypted files
        ├── nfc/                ← XChaCha20-Poly1305 encrypted files
        ├── nip46/              ← XChaCha20-Poly1305 encrypted files
        ├── agents/             ← XChaCha20-Poly1305 encrypted files
        └── cashu/              ← XChaCha20-Poly1305 encrypted files
```

### Encryption Layers

**Layer 1 — Wrapping Key** (device-bound):

The wrapping key is never stored. It is derived on demand using one of two methods:

- **WebAuthn (preferred):** The browser's WebAuthn PRF extension derives 32 bytes from a hardware authenticator (fingerprint sensor, security key). The PRF output is deterministic per credential — the same input always produces the same output, enabling vault re-unlock without any stored secret.
- **Passphrase (fallback):** `argon2id(passphrase, salt, { m: 65536, t: 3, p: 4 })` → 32 bytes. The salt is stored in `vault/passphrase.salt`. argon2id parameters are stored alongside the salt for forward compatibility.

**Layer 2 — Master Key** (per-vault):

- A random 256-bit key generated once during vault initialization
- Encrypted under the wrapping key using AES-256-GCM
- Stored in `vault/master.key`
- Loaded into JavaScript heap only while the vault is unlocked
- **Zeroed from heap on vault lock** (tab close, explicit lock, idle timeout)

**Layer 3 — File Encryption** (per-file):

- All files under `vault/identities/`, `vault/frost/`, etc. are encrypted under the master key
- Encryption: XChaCha20-Poly1305 via `@noble/ciphers`
- Each file uses a unique random nonce (prepended to the ciphertext)
- Authenticated encryption — tampering with ciphertext is detected

### Why XChaCha20-Poly1305 for Files?

XChaCha20-Poly1305 is used for file encryption (rather than AES-GCM) because:
1. The 192-bit nonce (vs 96-bit for AES-GCM) makes random nonce collision practically impossible, even for large numbers of files
2. ChaCha20 has no timing side-channels (no hardware-specific fast paths that could leak information)
3. Implemented by `@noble/ciphers` — a dependency already required for AES-128-CMAC

---

## Device Binding Mechanism

**WebAuthn (preferred):**
The wrapping key is bound to a specific hardware authenticator (Touch ID, Windows Hello, FIDO2 key). The vault cannot be unlocked on a different device without the original authenticator. The credential ID (`vault/webauthn.cred`) is just an identifier — it cannot be used to unlock the vault without the physical authenticator.

**Passphrase (fallback):**
Device binding is weaker — the passphrase could theoretically be used on any device if the attacker also obtains the `vault/passphrase.salt` from OPFS. However, the attacker needs both the passphrase and the encrypted vault contents, which means they need access to the device's OPFS origin.

---

## Backup Strategies

### Option 1 — Encrypted Vault Export

```typescript
// Full vault export (encrypted under master key)
const backupBlob = await vault.exportEncryptedBackup();

// Restore (requires original wrapping key — WebAuthn or passphrase)
await vault.importEncryptedBackup(backupBlob, wrappingKey);
```

The export is a single encrypted blob containing all vault contents. It requires the original wrapping key to restore. Store in a secure location (local encrypted drive, hardware security device, print as QR codes for paper backup).

### Option 2 — FROST Share Backup (kind:10000)

Each participant's FROST share is backed up as a `kind:10000` Nostr event encrypted to themselves:

```json
{
  "kind": 10000,
  "tags": [
    ["d", "frost-backup-<group_npub>"],
    ["p", "<participant_pubkey>"]
  ],
  "content": "<nip44_encrypted_bfshare>"
}
```

This backup is published to multiple relays and is recoverable from any relay that stores it. It requires only the participant's nsec to decrypt — no special backup infrastructure.

### Option 3 — nsec Paper Backup

The user can export their nsec as a BIP-39 mnemonic or hex string for paper backup. This is a last-resort recovery mechanism. Store in a physical safe or safety deposit box. Do not photograph or store digitally.

---

## Recovery Paths

### Scenario A: New Device (Old Device Still Available)

1. Old device: Export encrypted vault (`vault.exportEncryptedBackup()`)
2. Transfer backup to new device (USB, AirDrop, etc.)
3. New device: Install Satnam PWA
4. New device: Import encrypted backup
5. New device: Unlock with WebAuthn (re-register authenticator) or passphrase

### Scenario B: New Device (Old Device Lost — WebAuthn Vault)

Without the physical authenticator, a WebAuthn-protected vault **cannot be unlocked**. Recovery options:

1. **FROST share recovery:** If you are a member of a group, recover your FROST share from the encrypted `kind:10000` Nostr event (requires your nsec as a paper/mnemonic backup)
2. **nsec paper backup:** Import your nsec directly into a new vault on the new device; recreate other vault contents (NWC URIs, NFC keys) manually
3. **Group recovery ceremony:** Guardian initiates a share rotation ceremony; the departing participant's share is invalidated and a new one is issued to the new device

### Scenario C: New Device (Old Device Lost — Passphrase Vault)

1. Obtain the encrypted vault backup file (if you made one)
2. Install Satnam PWA on new device
3. Import backup with original passphrase
4. If no backup file: use nsec paper backup to initialize a fresh vault; recreate other secrets manually

### Scenario D: Forgotten Passphrase

**There is no server-side password reset.** This is by design (security invariant S1 — no key material in database). Options:

1. If you have a vault backup file: the backup is unusable without the passphrase
2. If you have your nsec (paper backup or mnemonic): initialize a fresh vault with a new passphrase; group FROST shares must be reissued via Guardian ceremony
3. If you have neither: the identity is unrecoverable. Create a new identity and notify contacts.

---

## What Happens If You Lose Your Device

**Immediate actions:**
1. Notify your Group Guardian — they can initiate a FROST share rotation, invalidating your old share
2. If the device had an unlocked vault at time of loss: assume your individual nsec is at risk; publish a `kind:0` profile update from a backup device to signal account compromise
3. Revoke any NIP-26 delegations you issued from the compromised device
4. If NFC cards were registered: the NFC AES keys are now at risk. Re-provision those cards with new keys.

**FROST group security:**
Losing a single device does not compromise group signing capability — the attacker still needs to compromise the threshold count. A 2-of-3 group with one lost device still requires one more share. The Guardian should initiate share rotation promptly.

**Lightning and Cashu funds:**
- Lightning funds are in your NWC-connected wallet — the wallet is not at risk (NWC URI is in OPFS)
- Cashu proofs in the vault: if the vault is encrypted and the attacker cannot unlock it, proofs are safe. If the vault was unlocked at time of loss, consider the Cashu proofs compromised and check with your mint for proof status.
