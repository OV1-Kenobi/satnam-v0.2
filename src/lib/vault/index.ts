/**
 * @module vault
 * @description OPFS Vault barrel export.
 *
 * The OPFS Vault is the sole permitted storage location for all secret key
 * material in Satnam v2: nsec keys, FROST shares, NWC URIs, NFC AES keys,
 * NIP-46 pairing state, agent credentials, and Cashu proofs.
 *
 * @see SPECIFICATION.md §2 — OPFS Vault
 *
 * @example
 * ```ts
 * import { Vault, getVault, VaultError } from '@lib/vault';
 *
 * const vault = getVault();
 * await vault.initialize('passphrase', 'correct-horse-battery-staple-x');
 * await vault.storeNsec('npub1...', secretKeyBytes);
 * const nsec = await vault.getNsec('npub1...');
 * vault.lock();
 * ```
 */

export { Vault, getVault, hashUrl, deriveNfcWrappingKey, xorWrappingKeys } from './vault.js';
export {
  VaultError,
  DEFAULT_VAULT_CONFIG,
  DEFAULT_VAULT_SETTINGS,
} from './types.js';
export type {
  VaultOps,
  VaultConfig,
  VaultDirectory,
  VaultMethod,
  VaultSecondFactor,
  VaultSettings,
  Nip46PairingState,
  EncryptedLlmKeys,
  CashuProof,
  WrappingKeyMeta,
} from './types.js';
