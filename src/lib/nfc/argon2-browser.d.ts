declare module 'argon2-browser' {
  interface Argon2HashResult {
    hash: Uint8Array;
    encoded: string;
  }
  interface Argon2HashOptions {
    pass: string;
    salt: string;
    time: number;
    mem: number;
    parallelism: number;
    hashLen: number;
    type: number;
  }
  const ArgonType: { Argon2id: number };
  function hash(opts: Argon2HashOptions): Promise<Argon2HashResult>;
  const _default: { hash: typeof hash; ArgonType: typeof ArgonType };
  export = _default;
}
