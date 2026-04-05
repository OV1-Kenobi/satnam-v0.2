# Getting Started

Welcome to Satnam. This guide walks you through installing the app, creating your sovereign identity, and completing the first-time setup. The whole process takes about 5 minutes.

---

## System Requirements

| Requirement | Details |
|---|---|
| Browser | Any modern browser: Chrome 90+, Firefox 90+, Safari 16+, Edge 90+ |
| NFC features | Android device with Chrome (Web NFC API). iOS uses Universal Link fallback — full NFC writing requires Android. |
| Storage | OPFS must be available. All modern browsers support this. |
| Internet | Required for relay communication and NIP-05 registration. Works offline for local operations after initial setup. |

> **Tip:** For the best experience — especially for NFC ceremonies and PWA installation — use Chrome on Android.

---

## Installing the PWA

Satnam is a Progressive Web App. There is no app store. You install it directly from the browser.

### On Android (Chrome)

1. Visit [satnam.pub](https://satnam.pub) in Chrome.
2. Chrome will show an **"Add to Home screen"** banner at the bottom of the screen, or you can tap the three-dot menu and select **Install app**.
3. Tap **Install**. The Satnam icon appears on your home screen.
4. Open Satnam from the home screen. It launches in standalone mode (no browser chrome).

### On Desktop (Chrome / Edge)

1. Visit [satnam.pub](https://satnam.pub).
2. In the address bar, look for the install icon (a small monitor with a down arrow) or go to **Menu → Install Satnam**.
3. Click **Install**. Satnam opens as a standalone desktop app.

### On iOS (Safari)

1. Visit [satnam.pub](https://satnam.pub) in Safari.
2. Tap the **Share** button (the square with an upward arrow) at the bottom of the screen.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.

> **Note:** NFC card *writing* is not supported on iOS. You can use existing NTAG424 cards for Proof of Life ceremonies via the Universal Link fallback, but provisioning new cards requires an Android device.

---

## Three Onboarding Paths

When you first open Satnam, you land on the Auth page. There are three ways to establish your identity.

```
┌─────────────────────────────────────────────────────────┐
│                    Choose Identity Method                │
│                                                         │
│  [NIP-07 Extension]  [Import nsec]  [Create New]        │
└─────────────────────────────────────────────────────────┘
```

### Path 1: NIP-07 Browser Extension (Recommended for Desktop)

If you already have a Nostr identity managed by a browser extension (Alby, nos2x, Flamingo), this is the simplest path.

1. Install a NIP-07 extension:
   - [Alby](https://getalby.com) — Chrome/Firefox
   - [nos2x](https://github.com/fiatjaf/nos2x) — Chrome
   - [Flamingo](https://www.flamingo.social) — Firefox
2. Open Satnam and select **NIP-07 Extension**.
3. Your extension will prompt for permission to share your public key.
4. Grant permission. Satnam reads your `npub` and uses your extension for all signing operations.
5. Your nsec remains in the extension — Satnam never sees it.

> **Note:** With NIP-07, Satnam delegates all signing to your extension. The OPFS Vault is still used for NWC URIs, NFC keys, and Cashu proofs, but your identity key material stays in the extension.

### Path 2: Import Existing nsec

If you have an existing Nostr private key and want to import it into Satnam's OPFS Vault:

1. Select **Import nsec** on the Auth page.
2. Paste your nsec (beginning with `nsec1...`) into the secure entry field.
3. Satnam verifies the key format and displays your `npub` for confirmation.
4. Set up your vault protection method (see [First-Time Vault Setup](#first-time-vault-setup) below).
5. Your nsec is encrypted and stored in the OPFS Vault. The plaintext is cleared from memory.

> **Warning:** Never paste your nsec into untrusted applications. Verify you are on `satnam.pub` (not a lookalike domain) before entering key material.

### Path 3: Create a New Identity

If you are new to Nostr or want a fresh keypair for Satnam:

1. Select **Create New Identity** on the Auth page.
2. Satnam generates a new Nostr keypair in browser memory using `@noble/curves`.
3. Your new `npub` is displayed. **Copy it now** — this is your public identity.
4. Set up your vault protection method (see [First-Time Vault Setup](#first-time-vault-setup) below).
5. The nsec is encrypted and stored in OPFS.

> **Tip:** After creating your identity, register a NIP-05 name (like `yourname@satnam.pub`) so others can find you easily. See [Registering a NIP-05 Name](#registering-a-nip-05-name).

---

## First-Time Vault Setup

After authenticating, Satnam initializes your OPFS Vault. The vault protects all your sensitive material — choose your protection method carefully.

### Option A: WebAuthn (Passkey) — Recommended

WebAuthn uses your device's hardware security (biometrics, PIN, or security key) to protect the vault. This is the most secure option.

1. Satnam prompts: **"Set up biometric vault protection?"**
2. Follow your device's authentication prompt (fingerprint, Face ID, Windows Hello, etc.).
3. Your WebAuthn credential is registered. Satnam stores only the credential ID (a public identifier) — the actual cryptographic material never leaves your device's secure enclave.
4. From now on, opening the vault unlocks with a biometric prompt — no passphrase needed.

### Option B: Passphrase

If your browser or device does not support WebAuthn PRF, you will be prompted for a passphrase.

1. Enter a strong passphrase — minimum 12 characters. Use a passphrase, not a password: three or four random words work well.
2. Satnam derives the vault wrapping key using argon2id (m=65536, t=3, p=4). This is computationally intensive by design — it takes ~1 second.
3. A random salt is stored in OPFS alongside the encrypted vault master key.

> **Warning:** There is no password reset. If you forget your passphrase and have no vault backup, you cannot recover your key material. Write your passphrase down and store it securely offline.

### Vault Auto-Lock

The vault locks automatically after 15 minutes of inactivity (configurable between 5 and 60 minutes in Settings). On lock, the master key is zeroed from memory. You will be prompted to re-authenticate on the next operation.

---

## Registering a NIP-05 Name

A NIP-05 name (`yourname@satnam.pub`) gives you a human-readable Nostr identity that others can search for and verify. Registration is optional but recommended.

1. After vault setup, Satnam prompts: **"Register your NIP-05 name?"**
2. Enter your desired username. Satnam checks availability in real time via the `check-username` function.
3. If available, tap **Register**.
4. Satnam constructs a registration request and signs it with your nsec via NIP-98.
5. The `register-identity` Netlify function writes your `username → npub` mapping to Supabase and creates your Lightning Address (`username@satnam.pub`).
6. Within a few seconds, your identity is verifiable at `https://satnam.pub/.well-known/nostr.json?name=yourname`.

> **Note:** NIP-05 names on `satnam.pub` are on a first-come, first-served basis. Usernames are 3–32 characters, alphanumeric and hyphens only.

---

## Next Steps

- [Connect a Lightning Wallet](./connecting-wallet.md) — Link your self-custody wallet via NWC
- [Create or Join a Group](../groups/README.md) — Set up a Guardian role and invite members
- [Create an Agent](../agents/creating-an-agent.md) — Deploy your first autonomous AI agent
- [Explore the Marketplace](../marketplace/README.md) — Browse NIP-90 DVM providers
