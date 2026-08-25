/**
 * AES-128-CMAC per RFC 4493 over @noble/ciphers
 * Zero new deps — uses existing @noble/ciphers aes block primitive.
 * Replaces nonexistent-export `cmac` call in ntag424.ts.
 *
 * @see RFC 4493, NTAG424 AN12196 SV2 = 0x3C||0xC3||0x00||0x01||0x00||0x80||UID(7)||SDMReadCtr(3)
 */

import { unsafe } from "@noble/ciphers/aes.js";

const BLOCK = 16;
const RB = 0x87;

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16)!;
  return out;
}
function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function xorBlock(a: Uint8Array, b: Uint8Array): Uint8Array {
  const r = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) r[i] = (a[i]! ^ b[i]!) & 0xff;
  return r;
}

function leftShiftOne(src: Uint8Array): { shifted: Uint8Array; carry: number } {
  const out = new Uint8Array(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    const newCarry = (src[i]! & 0x80) ? 1 : 0;
    out[i] = ((src[i]! << 1) | carry) & 0xff;
    carry = newCarry;
  }
  return { shifted: out, carry };
}

function generateSubkeys(encryptBlock: (b: Uint8Array) => Uint8Array): [Uint8Array, Uint8Array] {
  // L = AES-128(K, 0^128)
  const L = encryptBlock(new Uint8Array(BLOCK));
  const { shifted: k1a, carry: c1 } = leftShiftOne(L);
  const K1 = c1 ? (() => { k1a[BLOCK - 1]! ^= RB; return k1a; })() : k1a;
  const { shifted: k2a, carry: c2 } = leftShiftOne(K1);
  const K2 = c2 ? (() => { k2a[BLOCK - 1]! ^= RB; return k2a; })() : k2a;
  return [K1, K2];
}

/**
 * Compute AES-128-CMAC tag (16 bytes) per RFC 4493.
 * @param key 16-byte AES-128 key
 * @param data arbitrary length
 */
export function cmac(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (key.length !== 16) throw new Error("AES-128-CMAC requires 16-byte key");
  // Raw single-block AES via @noble/ciphers low-level (audited) path:
  // expand key once in little-endian form, encryptBlock() is stateless per call —
  // unlike ecb(), which refuses repeated encrypt() on the same instance.
  const xk = unsafe.expandKeyLE(key);
  const encryptBlock = (block: Uint8Array): Uint8Array => unsafe.encryptBlock(xk, block);
  const [K1, K2] = generateSubkeys(encryptBlock);

  const n = Math.max(1, Math.ceil(data.length / BLOCK));
  const lastComplete = data.length !== 0 && data.length % BLOCK === 0;

  let X: Uint8Array = new Uint8Array(BLOCK); // X0 = 0
  for (let i = 0; i < n - 1; i++) {
    const block = data.slice(i * BLOCK, (i + 1) * BLOCK);
    X = Uint8Array.from(encryptBlock(xorBlock(X, block)));
  }
  // last block
  const lastOffset = (n - 1) * BLOCK;
  let lastBlock: Uint8Array;
  if (lastComplete) {
    const block = data.slice(lastOffset, lastOffset + BLOCK);
    lastBlock = xorBlock(block, K1);
  } else {
    const remaining = data.slice(lastOffset);
    const padded = new Uint8Array(BLOCK);
    padded.set(remaining);
    padded[remaining.length] = 0x80;
    lastBlock = xorBlock(padded, K2);
  }
  X = Uint8Array.from(encryptBlock(xorBlock(X, lastBlock)));
  return X;
}

export function verifyCmac(key: Uint8Array, data: Uint8Array, expected: Uint8Array): boolean {
  const tag = cmac(key, data);
  if (tag.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < tag.length; i++) diff |= tag[i]! ^ expected[i]!;
  return diff === 0;
}

/** NTAG424 SUN SV2 builder: 0x3C C3 00 01 00 80 || UID(7) || CTR(3 LE) */
export function buildSunSv2(uidHex: string, counter: number): Uint8Array {
  const uid = hexToBytes(uidHex);
  if (uid.length !== 7) throw new Error("UID must be 7 bytes hex");
  const ctr = new Uint8Array(3);
  ctr[0] = counter & 0xff;
  ctr[1] = (counter >> 8) & 0xff;
  ctr[2] = (counter >> 16) & 0xff;
  return new Uint8Array([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80, ...uid, ...ctr]);
}

/** Compute SUN CMAC: CMAC(Ksun, SV2) */
export function sunCmac(sunKeyHex: string, uidHex: string, counter: number): Uint8Array {
  const key = hexToBytes(sunKeyHex);
  const sv2 = buildSunSv2(uidHex, counter);
  return cmac(key, sv2);
}

export function verifySunCmac(sunKeyHex: string, uidHex: string, counter: number, cmacHex: string): boolean {
  const expected = hexToBytes(cmacHex);
  const key = hexToBytes(sunKeyHex);
  const sv2 = buildSunSv2(uidHex, counter);
  return verifyCmac(key, sv2, expected);
}

// RFC 4493 vectors for tests (pure, no I/O)
export const RFC4493_VECTORS: ReadonlyArray<{ key: string; msg: string; tag: string }> = [
  { key: "2b7e151628aed2a6abf7158809cf4f3c", msg: "", tag: "bb1d6929e95937287fa37d129b756746" },
  { key: "2b7e151628aed2a6abf7158809cf4f3c", msg: "6bc1bee22e409f96e93d7e117393172a", tag: "070a16b46b4d4144f79bdd9dd04a287c" },
  {
    key: "2b7e151628aed2a6abf7158809cf4f3c",
    msg: "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411",
    tag: "dfa66747de9ae63030ca32611497c827",
  },
  {
    key: "2b7e151628aed2a6abf7158809cf4f3c",
    // RFC 4493 Example 4: 64-byte message
    msg: "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710",
    tag: "51f0bebf7e3b9d92fc49741779363cfe",
  },
];

// helpers for tests
export const _test = { hexToBytes, bytesToHex, generateSubkeys };
