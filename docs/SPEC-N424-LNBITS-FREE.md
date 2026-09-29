# N424 LNbits-free — Deterministic Issuer + SUN verify

Goal: program NTAG424 DNA as physical MFA for Nostr signing (UID + CMAC + PIN) without LNbits Boltcard extension.

## Keys (per boltcard DETERMINISTIC.md + BTCPay NTag424)

- IssuerKey: 16B AES-128, stored in OPFS Vault `nfc/issuer.key` (never DB). One per Satnam registrar.
- PRF = AES-CMAC (NIST 800-38B). Derive per card/version:

```
CardKey = PRF(IssuerKey, 0x2d003f75 || UID[7] || Version[4 LE])
K0 = PRF(CardKey, 0x2d003f76)  # AppMaster — only key that can change keys
K1 = PRF(IssuerKey, 0x2d003f77) # enc PICCData (p=) — constant per issuer
K2 = PRF(CardKey, 0x2d003f78)  # auth SUN MAC (c=)
K3 = PRF(CardKey, 0x2d003f79)
K4 = PRF(CardKey, 0x2d003f7a)
ID = PRF(IssuerKey, 0x2d003f7b || UID)  # lookup key, no DB required for keys
```

Version: 4B LE, bump on re-provision same UID. State: Configured vs Reset.

## NDEF

URI: `lnurlw://bridge.satnam.pub/api/nfc/scan?p=<32 hex>&c=<16 hex>` (or `https://bridge.satnam.pub/nfc/scan` if LNURLw domain = bridge)
- p = AES-128-CTR decrypt with K1 → PICCData: `c7 || UID[7] || CTR[4 LE] || pad`
- c = SUN MAC = CMAC(K2, UID||CTR||...) truncated per AN12196 SDM.

Provision writes:
- AuthenticateEV2First(K0_Default 00..00), GetCardUID
- CardKey/ K0..K4 derive as above, SetupBoltcard(uri, K_default, K_derive)
- ChangeFileSettings SDM enabled, offsets p: 41, c: 76 etc. per CARD_MANUAL

## Endpoints (satnamd, no LNbits)

- POST /nfc/issuer/init (guardian) → generate IssuerKey → Vault
- POST /nfc/provision { uid, version? } → returns { keys: {k0..k4}, uri, id, version } + writes via client Web NFC/PN532
- GET /api/nfc/scan?p=...&c=... → decrypt p with K1, verify c with K2, check c7, counter monotonic, return { uid, ctr, id, ok }

PIN overlay (existing vault.ts): after SUN ok, require PIN → argon2id → xorWrappingKeys → NIP-46 bunker sign. PIN never leaves device.

## Client write

- Web NFC: `NDEFReader.write({records:[{recordType:"url", data: uri}]})` after AuthenticateEV2/SetupBoltcard via `nfc-pcsc` or `pn532` lib (same as lawalletio/card-installer JS CMAC, no TapLinX).
- Alternative: PN532 on ESP32 Terminal (bitpos.app pattern) — `pn532` ESP-IDF component reads UID then writes via APDU.

No LNbits API, no Boltcard extension, no per-card DB — only IssuerKey + UID+Version deterministic.
