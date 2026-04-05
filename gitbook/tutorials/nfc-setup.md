# Tutorial: Setting Up NFC Cards

This tutorial walks you through provisioning an NTAG424 DNA NFC card with your Satnam identity, writing the AES keys to your OPFS Vault, and completing your first tap verification. CMAC verification happens entirely on your device — the server never sees your card keys.

**Time:** 10–15 minutes  
**Hardware required:** NTAG424 DNA TT card (or compatible) + Android device running Chrome  
**iOS note:** iOS cannot write NFC tags via browser. Card provisioning requires Android. Once provisioned, iOS can read cards via Universal Link fallback.

---

## What You Are Building

NTAG424 DNA cards use AES-128 cryptography to generate a unique authentication code (CMAC) on every tap. This proves that the person tapping the card:
1. Has physical possession of the card
2. Knows the associated PIN
3. Is operating from a device with the AES keys in its OPFS Vault

This combination (something you have + something you know + something you are registered with) provides strong physical presence verification.

---

## Before You Start

Gather what you need:
- One NTAG424 DNA TT card (available from NXP-authorized distributors)
- An Android device with Chrome 89+ installed
- Satnam v2 installed as a PWA on that device, with vault unlocked
- Optionally: a second NTAG424 card as backup

If you do not have an NTAG424 card, the Satnam NFC features are optional — the identity, wallet, and agent functionality all work without a card.

---

## Step 1: Navigate to NFC Setup

1. Open Satnam v2 on your Android device
2. Unlock your vault (WebAuthn biometric preferred)
3. Tap the settings menu (⚙) → **NFC Cards** → **Add New Card**

Satnam will prompt you to enable NFC on your device if it is not already on.

---

## Step 2: Initial Card Scan

1. Hold the NTAG424 card to the back of your Android device (near the NFC antenna — usually top-center or center)
2. You will hear/feel a tap confirmation and see: "Card detected — Reading UID…"
3. Satnam reads the card UID (7 bytes, unique per card)
4. The card UID is displayed: `04:AB:CD:EF:01:23:45`

> **Note:** If you see "Card not recognized" — make sure NFC is enabled in Android settings and you are using Chrome (not Firefox or another browser). Web NFC API is Chrome-only on Android.

---

## Step 3: Generate and Write AES Keys

Satnam generates two AES-128 keys for this card:
- **K1:** Used for general SUN/SDM operations
- **K2:** Used specifically for CMAC verification (the key that proves physical presence)

1. Satnam displays: "Ready to provision card. This will write AES keys to the card and store them in your vault."
2. Tap **Provision Card**
3. Satnam generates K1 and K2 using `@noble/ciphers` AES-128 key generation
4. **Keep your card on the device** — Satnam writes the keys to the NTAG424 card using NFC NDEF write commands

> **This operation takes 3–5 seconds.** Do not move the card until you see "Keys written successfully."

5. Both keys are immediately encrypted and stored in your OPFS Vault at:
   - `nfc/{card_uid}.k1` — K1 encrypted under vault master key
   - `nfc/{card_uid}.k2` — K2 encrypted under vault master key

---

## Step 4: Set Your Card PIN

The PIN is a second factor required for sensitive operations triggered by a card tap.

1. Satnam prompts: "Set a PIN for this card (4–8 digits)"
2. Enter your chosen PIN
3. Confirm the PIN
4. Satnam derives a PIN verifier: `argon2id(pin, card_uid_as_salt, { m: 65536, t: 3, p: 4 })`
5. The PIN verifier hash is stored in OPFS Vault (`nfc/{card_uid}.pin_verifier`)

**Choose a PIN you will remember.** There is no PIN reset — if you forget it, you must re-provision the card with a new PIN. The old PIN verifier is cryptographically derived and cannot be reversed.

**PIN-gated operations (all require both card tap AND PIN):**
- Contact addition or removal
- Proof of Life ceremony publication
- Payment authorization above your threshold
- Group membership changes
- Agent delegation changes

---

## Step 5: Name Your Card

1. Enter a label for this card: e.g., "Main Identity Card" or "Backup Card"
2. The label is stored in OPFS with the card's UID
3. Tap **Save Card Setup**

Your card now appears in the **NFC Cards** list with a green "Active" badge.

---

## Step 6: First Tap Verification

Let's test that CMAC verification is working correctly.

1. From the NFC Cards screen, tap **Test Card**
2. Satnam shows: "Tap your card to verify…"
3. Hold the card to your device

**What happens (all client-side, no server involvement):**

1. Android Chrome reads the NDEF record — gets `piccDataHex` and `cmacHex` from the SUN URL
2. Satnam fetches K2 from OPFS Vault
3. Satnam computes expected CMAC: `cmac(aes128, K2, piccDataHex)`
4. Satnam compares with the received `cmacHex` using timing-safe comparison
5. Satnam checks the read counter is monotonically increasing (stored in OPFS, incremented on each successful verify)

6. You see: ✓ **Card verified** — "Card UID: 04:AB:CD…, Counter: 1, CMAC: Valid"

If verification fails, you will see one of:
- "CMAC mismatch — card may have been cloned or tampered with"
- "Counter too low — possible replay attack detected"
- "Key not found — check your vault is unlocked"

---

## Step 7: iOS Setup (Fallback)

If you use an iPhone, you cannot provision cards but you can read them after Android provisioning.

1. On your iPhone, open Safari and navigate to `satnam.pub`
2. Install as PWA (Add to Home Screen)
3. When your NTAG424 card is tapped on iPhone, Safari intercepts the SUN URL:
   ```
   https://satnam.pub/nfc/{card_uid}?piccDataHex=...&cmacHex=...
   ```
4. Safari opens the Satnam PWA and passes the URL parameters
5. Satnam performs the same CMAC verification flow as Android
6. You will be prompted to unlock your vault if not already unlocked

**iOS limitation:** Card provisioning (writing AES keys) requires Android. After provisioning, the OPFS Vault contents can be transferred to iOS via encrypted vault export/import.

---

## Step 8: Run a Proof of Life Ceremony

The Proof of Life ceremony creates a verifiable, timestamped record of physical card presence.

1. Navigate to **NFC Cards** → select your card → **Proof of Life**
2. Tap **Initiate Ceremony**
3. Status shows: IDLE → INITIATED
4. Hold your card to the device: INITIATED → CARD_TAPPED
5. CMAC is verified: CARD_TAPPED → PIN_VERIFIED (PIN entry prompt appears)
6. Enter your PIN: PIN_VERIFIED → SIGNED
7. Satnam constructs a `kind:30078` event:
   ```json
   {
     "kind": 30078,
     "tags": [
       ["d", "satnam:proof-of-life"],
       ["card_uid_hash", "<sha256_of_card_uid>"],
       ["guardian", "<your_pubkey>"],
       ["cmac_counter", "47"],
       ["t", "proof-of-life"]
     ],
     "content": "{\"timestamp\": 1700000000, \"ceremony_type\": \"presence\"}"
   }
   ```
8. You sign and publish: SIGNED → PUBLISHED
9. Satnam waits for relay confirmation: PUBLISHED → CONFIRMED

The Proof of Life event is now on the Nostr relay network, anchored with a Bitcoin timestamp via OpenTimestamps (if simpleproof-anchor is called).

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "NFC not available" | Enable NFC in Android Settings. Make sure you are using Chrome, not another browser. |
| "Card not detected" | Try different positions — NFC antenna is often at top-center. Remove phone case if using one. |
| "CMAC mismatch" | The card keys in your vault may not match what is on the card. Re-provision the card. |
| "Counter too low" | The card counter recorded in your vault is ahead of the card's actual counter. This can happen after vault restore. Re-tap the card twice and try again. |
| "Vault locked" | Unlock your vault before attempting card operations. |
| "Card write failed" | The card may be read-only or fully provisioned. Use a fresh NTAG424 card. |

---

## What You Accomplished

- Provisioned an NTAG424 DNA card with device-held AES keys (no server involvement)
- Stored K1 and K2 encrypted in your OPFS Vault
- Verified that CMAC verification works entirely client-side
- Set a PIN for card-triggered sensitive operations
- Ran a Proof of Life ceremony and published the result to Nostr
