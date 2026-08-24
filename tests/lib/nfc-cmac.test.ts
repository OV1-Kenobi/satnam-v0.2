/**
 * CR-B — AES-128-CMAC unit tests
 * RFC 4493 test vectors + NTAG424 SUN SV2 verification + replay semantics.
 *
 * @see src/lib/nfc/cmac.ts, RFC 4493 §4, NXP AN12196
 */
import { describe, expect, it } from 'vitest';

import {
  buildSunSv2,
  cmac,
  RFC4493_VECTORS,
  sunCmac,
  verifyCmac,
  verifySunCmac,
} from '../../src/lib/nfc/cmac';

describe('CR-B AES-128-CMAC (RFC 4493)', () => {
  const fromHex = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));

  it.each(RFC4493_VECTORS.map((v, i) => [i, v] as const))(
    'passes RFC 4493 vector #%i',
    (_, { key, msg, tag }) => {
      const computed = cmac(fromHex(key), fromHex(msg));
      expect(Buffer.from(computed).toString('hex')).toBe(tag);
      expect(verifyCmac(fromHex(key), fromHex(msg), fromHex(tag))).toBe(true);
    },
  );

  it('rejects a tampered tag', () => {
    const key = new Uint8Array(16).fill(0x2b);
    const data = new Uint8Array(32).fill(0x6b);
    const good = cmac(key, data);
    const bad = new Uint8Array(good);
    bad[0]! ^= 1;
    expect(verifyCmac(key, data, bad)).toBe(false);
  });

  it('rejects a wrong key', () => {
    const keyA = new Uint8Array(16).fill(0xaa);
    const keyB = new Uint8Array(16).fill(0xbb);
    const data = new Uint8Array([1, 2, 3]);
    expect(verifyCmac(keyB, data, cmac(keyA, data))).toBe(false);
  });

  it('rejects keys that are not 16 bytes', () => {
    expect(() => cmac(new Uint8Array(15), new Uint8Array(0))).toThrow(/16-byte/);
    expect(() => cmac(new Uint8Array(32), new Uint8Array(0))).toThrow(/16-byte/);
  });
});

describe('CR-B NTAG424 SUN SV2 + CMAC', () => {
  const uidHex = '04aabbccddeeff';
  const sunKeyHex = '2b7e151628aed2a6abf7158809cf4f3c';

  it('builds SV2 per AN12196: header + UID(7) + counter(3 LE)', () => {
    const sv2 = buildSunSv2(uidHex, 0x010203);
    expect(sv2.length).toBe(16);
    expect(Array.from(sv2.slice(0, 6))).toEqual([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80]);
    expect(Array.from(sv2.slice(6, 13))).toEqual([0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    // little-endian counter
    expect(Array.from(sv2.slice(13))).toEqual([0x03, 0x02, 0x01]);
  });

  it('rejects malformed UID', () => {
    expect(() => buildSunSv2('04aa', 1)).toThrow(/7 bytes/);
  });

  it('round-trips a valid SUN CMAC', () => {
    const tag = sunCmac(sunKeyHex, uidHex, 42);
    const tagHex = Buffer.from(tag).toString('hex');
    expect(verifySunCmac(sunKeyHex, uidHex, 42, tagHex)).toBe(true);
  });

  it('fails verification when the counter differs (replay/forgery)', () => {
    const tagHex = Buffer.from(sunCmac(sunKeyHex, uidHex, 42)).toString('hex');
    // same CMAC presented for a different counter must fail
    expect(verifySunCmac(sunKeyHex, uidHex, 43, tagHex)).toBe(false);
  });

  it('fails verification with a different SUN key', () => {
    const otherKey = '00000000000000000000000000000000';
    const tagHex = Buffer.from(sunCmac(sunKeyHex, uidHex, 42)).toString('hex');
    expect(verifySunCmac(otherKey, uidHex, 42, tagHex)).toBe(false);
  });

  it('produces distinct CMACs per counter value (no cross-tap reuse)', () => {
    const t0 = Buffer.from(sunCmac(sunKeyHex, uidHex, 100)).toString('hex');
    const t1 = Buffer.from(sunCmac(sunKeyHex, uidHex, 101)).toString('hex');
    expect(t0).not.toBe(t1);
  });
});
