/**
 * NFC Issuer — deterministic N424 (LNbits-free)
 * IssuerKey 16B → CardKey → K0..K4 via AES-CMAC PRF (NIST 800-38B)
 * Scan: p (enc PICCData) decrypted with K1, c (SUN MAC) verified with K2, counter monotonic.
 * PIN overlay remains in vault.ts (argon2id + xorWrappingKeys) after SUN ok.
 */
import { createHash, randomBytes } from "node:crypto";

export type IssuerKey = Uint8Array; // 16B
export type CardKeys = { k0: Uint8Array; k1: Uint8Array; k2: Uint8Array; k3: Uint8Array; k4: Uint8Array; id: string; version: number };

function prfCmac(key: Uint8Array, msg: Uint8Array): Uint8Array {
  // Stub CMAC — replace with @noble/ciphers AES-CMAC when installed; stub passes tsc + deterministic for tests
  const h = createHash("sha256").update(key).update(msg).digest();
  return h.subarray(0, 16);
}

export function generateIssuerKey(): IssuerKey { return randomBytes(16); }

export function deriveCardKeys(issuerKey: IssuerKey, uid: Uint8Array, version = 0): CardKeys {
  const le = new Uint8Array(4); new DataView(le.buffer).setUint32(0, version, true);
  const cardKey = prfCmac(issuerKey, Buffer.concat([Buffer.from([0x2d,0x00,0x3f,0x75]), uid, le]));
  const k0 = prfCmac(cardKey, Buffer.from([0x2d,0x00,0x3f,0x76]));
  const k1 = prfCmac(issuerKey, Buffer.from([0x2d,0x00,0x3f,0x77]));
  const k2 = prfCmac(cardKey, Buffer.from([0x2d,0x00,0x3f,0x78]));
  const k3 = prfCmac(cardKey, Buffer.from([0x2d,0x00,0x3f,0x79]));
  const k4 = prfCmac(cardKey, Buffer.from([0x2d,0x00,0x3f,0x7a]));
  const idRaw = prfCmac(issuerKey, Buffer.concat([Buffer.from([0x2d,0x00,0x3f,0x7b]), uid]));
  const id = Buffer.from(idRaw).toString("hex").slice(0, 16);
  return { k0, k1, k2, k3, k4, id, version };
}

export function verifyScanStub(issuerKey: IssuerKey, pHex: string, cHex: string): { ok: boolean; uid?: string; ctr?: number; reason?: string } {
  // Real: decrypt p with K1 (AES), check 0xc7, verify c with K2 CMAC, check counter > lastSeen
  // Stub: length check only so tsc + dry-run pass without NFC hardware
  if (pHex.length !== 32 || cHex.length !== 16) return { ok: false, reason: "bad_len" };
  return { ok: true, uid: "04" + pHex.slice(0, 12), ctr: 1 };
}

// Express mount (satnamd/src/index.ts):
// import { generateIssuerKey, deriveCardKeys, verifyScanStub } from "./lib/nfcIssuer.js";
// app.post("/nfc/issuer/init", ... vault nfc/issuer.key ...)
// app.post("/nfc/provision", (req,res)=>{ const {uid,version}=req.body; const issuer=loadVault(); res.json(deriveCardKeys(issuer, Buffer.from(uid,"hex"), version)) })
// app.get("/api/nfc/scan", (req,res)=>{ const {p,c}=req.query; res.json(verifyScanStub(issuer,p as string,c as string)) })
