/**
 * @module nip98
 * @description NIP-98 HTTP Authentication barrel export.
 *
 * NIP-98 replaces all JWT-based authentication in Satnam v2. Every
 * authenticated request to a Netlify function includes a kind:27235 auth
 * event in the `Authorization: Nostr <base64>` header.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/98.md
 * @see SPECIFICATION.md §3 — Auth System
 *
 * @example
 * ```ts
 * // Server-side verification (Netlify function):
 * import { verifyNip98 } from '@lib/nip98';
 *
 * const outcome = verifyNip98(req.headers.authorization, url, 'POST', bodyBytes);
 * if (!outcome.authenticated) return { statusCode: 401, body: outcome.reason };
 * const { pubkey } = outcome;
 *
 * // Client-side construction:
 * import { buildNip98AuthHeader } from '@lib/nip98';
 *
 * const authHeader = buildNip98AuthHeader(myNsec, targetUrl, 'POST', bodyBytes);
 * ```
 */

export { verifyNip98 } from './verify.js';
export type { AuthResult, AuthError, AuthOutcome, Nip98Event } from './verify.js';

export {
  constructNip98Event,
  buildNip98AuthHeader,
  getHexPubkey,
  computePayloadHash,
} from './construct.js';
