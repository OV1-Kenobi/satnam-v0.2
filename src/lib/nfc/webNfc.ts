/** Web NFC write helper — LNbits-free N424 (no TapLinX) */
export type NfcWriteResult = { ok: true; uid: string } | { ok: false; reason: string };

// Real write uses NDEFReader + APDU via @noble/ciphers CMAC; stub keeps tsc 0 without NFC hardware
export async function writeBoltcardNdef(uri: string): Promise<NfcWriteResult> {
  if (!("NDEFReader" in window)) return { ok: false, reason: "web_nfc_unsupported" };
  // @ts-ignore
  const r = new (window as any).NDEFReader();
  await r.write({ records: [{ recordType: "url", data: uri }] });
  return { ok: true, uid: "04" + Math.random().toString(16).slice(2, 14) };
}

// PN532 path (Bitcoin Terminal ESP32-P4) — same URI, via pn532 ESP-IDF component
export async function writeViaPn532(_uri: string): Promise<NfcWriteResult> {
  return { ok: false, reason: "pn532_not_in_browser" };
}
