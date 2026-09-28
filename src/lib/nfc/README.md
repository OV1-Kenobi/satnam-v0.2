# NFC — LNbits-free N424

Web NFC `NDEFReader.write({recordType:"url", data: uri})` for `lnurlw://bridge.satnam.pub/api/nfc/scan?p=...&c=...`
PN532 path matches Bitcoin Terminal `JC4880P443` firmware — same NDEF.

PIN overlay: after SUN verify (`p/c` + counter), existing `vault.ts` `pin-gate.ts` argon2id + `xorWrappingKeys` gates NIP-46 bunker sign. PIN never leaves device.
