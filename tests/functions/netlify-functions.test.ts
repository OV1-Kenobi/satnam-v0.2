/**
 * @module tests/functions/netlify-functions
 * @description Integration tests for all 6 new Netlify functions.
 *
 * Tests cover:
 * - check-username (function #3) — public, no auth
 * - register-identity (function #4) — NIP-98 auth required
 * - nwc-proxy (function #5) — NIP-98 auth required
 * - simpleproof-anchor (function #6) — NIP-98 auth required
 * - issuer-registry GET (function #7) — public
 * - issuer-registry POST (function #7) — NIP-98 auth required
 * - unified-comms (function #8) — NIP-98 auth required
 *
 * Uses Vitest. Supabase and relay calls are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HandlerEvent } from '@netlify/functions';

// ============================================================================
// Mocks
// ============================================================================

// Mock @supabase/supabase-js
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gt: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        range: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
      })),
      insert: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
    rpc: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

// Mock NIP-98 verification
vi.mock('../../src/lib/nip98/verify', () => ({
  verifyNip98: vi.fn(),
}));

import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Global cleanup — prevent mock call counts from leaking between describes
// ============================================================================

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Test Helpers
// ============================================================================

/** Build a minimal HandlerEvent for testing. */
function makeEvent(
  overrides: Partial<HandlerEvent> = {}
): HandlerEvent {
  return {
    httpMethod: 'GET',
    path: '/.netlify/functions/test',
    queryStringParameters: null,
    headers: {
      host: 'satnam.pub',
      origin: 'https://satnam.pub',
    },
    body: null,
    isBase64Encoded: false,
    rawUrl: 'https://satnam.pub/.netlify/functions/test',
    rawQuery: '',
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    ...overrides,
  };
}

/** Mock a successful NIP-98 auth result. */
function mockAuthSuccess(pubkey: string = 'a'.repeat(64)) {
  vi.mocked(verifyNip98).mockReturnValue({
    authenticated: true,
    pubkey,
  });
}

/** Mock a failed NIP-98 auth result. */
function mockAuthFailure(reason: 'missing_header' | 'expired' | 'invalid_signature' = 'missing_header') {
  vi.mocked(verifyNip98).mockReturnValue({
    authenticated: false,
    reason,
  });
}

// ============================================================================
// check-username Tests (Function #3)
// ============================================================================

describe('check-username', () => {
  let handler: typeof import('../../netlify/functions/check-username').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/check-username'));
  });

  it('returns 405 for non-GET methods', async () => {
    const result = await handler(makeEvent({ httpMethod: 'POST' }), {} as any);
    expect(result?.statusCode).toBe(405);
  });

  it('returns 200 with available: false for missing name param', async () => {
    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: null }),
      {} as any
    );
    // Empty name fails validation
    expect(result?.statusCode).toBe(200);
    const body = JSON.parse(result?.body || '{}');
    expect(body.available).toBe(false);
    expect(typeof body.reason).toBe('string');
  });

  it('returns available: false for too-short username', async () => {
    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: { name: 'ab' } }),
      {} as any
    );
    const body = JSON.parse(result?.body || '{}');
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/3 characters/);
  });

  it('returns available: false for reserved username', async () => {
    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: { name: 'admin' } }),
      {} as any
    );
    const body = JSON.parse(result?.body || '{}');
    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/reserved/i);
  });

  it('normalizes username to lowercase before validation', async () => {
    // Source lowercases input before validation — 'UPPERCASE' becomes 'uppercase' which is valid
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    } as never);

    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: { name: 'UPPERCASE' } }),
      {} as never
    );
    const body = JSON.parse(result?.body || '{}');
    // After lowercasing, 'uppercase' is a valid username and DB returns null = available
    expect(body.available).toBe(true);
  });

  it('returns available: false for username with invalid chars', async () => {
    // Symbols are rejected even after lowercasing
    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: { name: 'bad@name!' } }),
      {} as never
    );
    const body = JSON.parse(result?.body || '{}');
    expect(body.available).toBe(false);
  });

  it('returns available: true when username is free (mocked DB)', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    } as any);

    const result = await handler(
      makeEvent({ httpMethod: 'GET', queryStringParameters: { name: 'satoshi123' } }),
      {} as any
    );
    const body = JSON.parse(result?.body || '{}');
    expect(body.available).toBe(true);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const result = await handler(makeEvent({ httpMethod: 'OPTIONS' }), {} as any);
    expect(result?.statusCode).toBe(204);
  });

  it('includes public-endpoint auth comment (S10 invariant)', async () => {
    // Verify the source file declares no authentication required for S10 invariant
    const fs = await import('fs');
    const src = fs.readFileSync(
      'netlify/functions/check-username.ts',
      'utf-8'
    );
    expect(src).toContain('no authentication required');
  });
});

// ============================================================================
// register-identity Tests (Function #4)
// ============================================================================

describe('register-identity', () => {
  let handler: typeof import('../../netlify/functions/register-identity').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/register-identity'));
  });

  it('returns 401 when NIP-98 auth is missing', async () => {
    mockAuthFailure('missing_header');
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ username: 'testuser' }),
        headers: { host: 'satnam.pub' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(401);
    expect(verifyNip98).toHaveBeenCalledOnce();
  });

  it('returns 401 when NIP-98 auth has invalid signature', async () => {
    mockAuthFailure('invalid_signature');
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ username: 'testuser' }),
        headers: {
          host: 'satnam.pub',
          authorization: 'Nostr invalidbase64',
        },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(401);
  });

  it('returns 400 for missing username', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({}),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    const body = JSON.parse(result?.body || '{}');
    expect(body.error).toMatch(/username/i);
  });

  it('returns 400 for invalid lud16 format', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ username: 'validuser123', lud16: 'not-valid' }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    const body = JSON.parse(result?.body || '{}');
    expect(body.error).toMatch(/lightning/i);
  });

  it('calls verifyNip98 before any database logic (S10 invariant)', async () => {
    mockAuthFailure('expired');
    const { createClient } = await import('@supabase/supabase-js');
    const mockFrom = vi.fn();
    vi.mocked(createClient).mockReturnValue({ from: mockFrom } as any);

    await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ username: 'testuser' }),
        headers: { host: 'satnam.pub', authorization: 'Nostr expired' },
      }),
      {} as any
    );

    // Auth must be called, but DB (from) must NOT be called since auth failed
    expect(verifyNip98).toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 405 for non-POST methods', async () => {
    const result = await handler(makeEvent({ httpMethod: 'GET' }), {} as any);
    expect(result?.statusCode).toBe(405);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const result = await handler(makeEvent({ httpMethod: 'OPTIONS' }), {} as any);
    expect(result?.statusCode).toBe(204);
  });
});

// ============================================================================
// nwc-proxy Tests (Function #5)
// ============================================================================

describe('nwc-proxy', () => {
  let handler: typeof import('../../netlify/functions/nwc-proxy').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/nwc-proxy'));
  });

  it('returns 401 without auth', async () => {
    mockAuthFailure('missing_header');
    const result = await handler(
      makeEvent({ httpMethod: 'POST', body: JSON.stringify({}) }),
      {} as any
    );
    expect(result?.statusCode).toBe(401);
    expect(verifyNip98).toHaveBeenCalledOnce();
  });

  it('returns 400 for missing encrypted_payload', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ relay_url: 'wss://relay.getalby.com' }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/encrypted_payload/);
  });

  it('returns 400 for disallowed relay URL', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          encrypted_payload: JSON.stringify({ id: 'a'.repeat(64), sig: 'b'.repeat(128), pubkey: 'c'.repeat(64), kind: 23194, created_at: 1, tags: [], content: 'enc' }),
          relay_url: 'wss://evil.attacker.com',
        }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/allowed/i);
  });

  it('returns 400 for non-wss relay URL', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          encrypted_payload: '{}',
          relay_url: 'http://relay.getalby.com',
        }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
  });

  it('calls verifyNip98 before relay forwarding (S10 invariant)', async () => {
    mockAuthFailure('missing_header');
    await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ encrypted_payload: '{}', relay_url: 'wss://relay.getalby.com' }),
      }),
      {} as any
    );
    expect(verifyNip98).toHaveBeenCalled();
  });
});

// ============================================================================
// simpleproof-anchor Tests (Function #6)
// ============================================================================

describe('simpleproof-anchor', () => {
  let handler: typeof import('../../netlify/functions/simpleproof-anchor').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/simpleproof-anchor'));
  });

  it('returns 401 without auth', async () => {
    mockAuthFailure('missing_header');
    const result = await handler(
      makeEvent({ httpMethod: 'POST', body: JSON.stringify({}) }),
      {} as any
    );
    expect(result?.statusCode).toBe(401);
    expect(verifyNip98).toHaveBeenCalledOnce();
  });

  it('returns 400 for missing event_ids', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({}),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/event_ids/i);
  });

  it('returns 400 for invalid event ID format (not 64 hex chars)', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ event_ids: ['not-hex'] }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/hex/i);
  });

  it('returns 400 for too many event IDs', async () => {
    mockAuthSuccess();
    const tooMany = Array(101).fill('a'.repeat(64));
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ event_ids: tooMany }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/100/);
  });

  it('calls verifyNip98 before OTS submission (S10 invariant)', async () => {
    mockAuthFailure('missing_header');
    await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ event_ids: ['a'.repeat(64)] }),
      }),
      {} as any
    );
    expect(verifyNip98).toHaveBeenCalled();
  });
});

// ============================================================================
// issuer-registry Tests (Function #7)
// ============================================================================

describe('issuer-registry', () => {
  let handler: typeof import('../../netlify/functions/issuer-registry').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/issuer-registry'));
  });

  // GET (public)
  describe('GET', () => {
    it('returns 400 for missing pubkey', async () => {
      const result = await handler(
        makeEvent({ httpMethod: 'GET', queryStringParameters: null }),
        {} as any
      );
      expect(result?.statusCode).toBe(400);
    });

    it('returns 400 for invalid pubkey format', async () => {
      const result = await handler(
        makeEvent({ httpMethod: 'GET', queryStringParameters: { pubkey: 'not-hex' } }),
        {} as any
      );
      expect(result?.statusCode).toBe(400);
      expect(JSON.parse(result?.body || '{}').error).toMatch(/hex/i);
    });

    it('returns 404 for unknown pubkey', async () => {
      const { createClient } = await import('@supabase/supabase-js');
      vi.mocked(createClient).mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      } as any);

      const result = await handler(
        makeEvent({ httpMethod: 'GET', queryStringParameters: { pubkey: 'a'.repeat(64) } }),
        {} as any
      );
      expect(result?.statusCode).toBe(404);
    });

    it('GET does not call verifyNip98 (public endpoint)', async () => {
      await handler(
        makeEvent({ httpMethod: 'GET', queryStringParameters: { pubkey: 'a'.repeat(64) } }),
        {} as any
      );
      expect(verifyNip98).not.toHaveBeenCalled();
    });

    it('source file contains NIP-98-not-required comment (S10 invariant)', async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(
        'netlify/functions/issuer-registry.ts',
        'utf-8'
      );
      expect(src).toContain('NIP-98 not required');
    });
  });

  // POST (auth required)
  describe('POST', () => {
    it('returns 401 without auth', async () => {
      mockAuthFailure('missing_header');
      const result = await handler(
        makeEvent({
          httpMethod: 'POST',
          body: JSON.stringify({ name: 'Test Issuer', capabilities: ['age-attestation'] }),
          headers: { host: 'satnam.pub', authorization: 'Nostr missing' },
        }),
        {} as any
      );
      expect(result?.statusCode).toBe(401);
      expect(verifyNip98).toHaveBeenCalledOnce();
    });

    it('returns 400 for missing name', async () => {
      mockAuthSuccess();
      const result = await handler(
        makeEvent({
          httpMethod: 'POST',
          body: JSON.stringify({ capabilities: ['age-attestation'], credential_types: [] }),
          headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
        }),
        {} as any
      );
      expect(result?.statusCode).toBe(400);
      expect(JSON.parse(result?.body || '{}').error).toMatch(/name/i);
    });

    it('returns 400 for empty capabilities', async () => {
      mockAuthSuccess();
      const result = await handler(
        makeEvent({
          httpMethod: 'POST',
          body: JSON.stringify({ name: 'Issuer', capabilities: [], credential_types: [] }),
          headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
        }),
        {} as any
      );
      expect(result?.statusCode).toBe(400);
    });

    it('calls verifyNip98 before DB write (S10 invariant)', async () => {
      mockAuthFailure('expired');
      const { createClient } = await import('@supabase/supabase-js');
      const mockFrom = vi.fn();
      vi.mocked(createClient).mockReturnValue({ from: mockFrom } as any);

      await handler(
        makeEvent({
          httpMethod: 'POST',
          body: JSON.stringify({ name: 'Issuer', capabilities: ['x'], credential_types: [] }),
          headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
        }),
        {} as any
      );

      expect(verifyNip98).toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// unified-comms Tests (Function #8)
// ============================================================================

describe('unified-comms', () => {
  let handler: typeof import('../../netlify/functions/unified-comms').handler;

  beforeEach(async () => {
    vi.resetModules();
    ({ handler } = await import('../../netlify/functions/unified-comms'));
  });

  it('returns 401 without auth', async () => {
    mockAuthFailure('missing_header');
    const result = await handler(
      makeEvent({ httpMethod: 'POST', body: JSON.stringify({}) }),
      {} as any
    );
    expect(result?.statusCode).toBe(401);
    expect(verifyNip98).toHaveBeenCalledOnce();
  });

  it('returns 400 for missing gift_wrapped_event', async () => {
    mockAuthSuccess();
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({}),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/gift_wrapped_event/);
  });

  it('returns 400 for wrong event kind (not 1059)', async () => {
    mockAuthSuccess();
    const badEvent = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1, // Wrong kind — should be 1059
      tags: [],
      content: 'encrypted',
      sig: 'c'.repeat(128),
    };
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ gift_wrapped_event: badEvent }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
    expect(JSON.parse(result?.body || '{}').error).toMatch(/1059/);
  });

  it('returns 400 for event with invalid id length', async () => {
    mockAuthSuccess();
    const badEvent = {
      id: 'too-short',
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000),
      kind: 1059,
      tags: [],
      content: 'encrypted',
      sig: 'c'.repeat(128),
    };
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ gift_wrapped_event: badEvent }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
  });

  it('returns 400 for stale event (older than 24 hours)', async () => {
    mockAuthSuccess();
    const staleEvent = {
      id: 'a'.repeat(64),
      pubkey: 'b'.repeat(64),
      created_at: Math.floor(Date.now() / 1000) - 90000, // 25 hours ago
      kind: 1059,
      tags: [],
      content: 'encrypted',
      sig: 'c'.repeat(128),
    };
    const result = await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ gift_wrapped_event: staleEvent }),
        headers: { host: 'satnam.pub', authorization: 'Nostr valid' },
      }),
      {} as any
    );
    expect(result?.statusCode).toBe(400);
  });

  it('calls verifyNip98 before relay forwarding (S10 invariant)', async () => {
    mockAuthFailure('missing_header');
    await handler(
      makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ gift_wrapped_event: { kind: 1059 } }),
      }),
      {} as any
    );
    expect(verifyNip98).toHaveBeenCalled();
  });

  it('returns 405 for non-POST methods', async () => {
    const result = await handler(makeEvent({ httpMethod: 'GET' }), {} as any);
    expect(result?.statusCode).toBe(405);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const result = await handler(makeEvent({ httpMethod: 'OPTIONS' }), {} as any);
    expect(result?.statusCode).toBe(204);
  });
});

// ============================================================================
// S9 Invariant: Total function count must be ≤ 8
// ============================================================================

describe('S9 invariant — function count', () => {
  it('netlify/functions/ contains exactly 8 functions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const functionsDir = path.resolve('netlify/functions');
    const files = fs.readdirSync(functionsDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBe(8);
    // Verify all 8 functions are present
    const expectedFunctions = [
      'nip05-resolver.ts',
      'well-known-agent.ts',
      'check-username.ts',
      'register-identity.ts',
      'nwc-proxy.ts',
      'simpleproof-anchor.ts',
      'issuer-registry.ts',
      'unified-comms.ts',
    ];
    for (const fn of expectedFunctions) {
      expect(files).toContain(fn);
    }
  });
});

// ============================================================================
// S10 Invariant: Public functions declare no authentication required
// ============================================================================

describe('S10 invariant — public function comments', () => {
  it('nip05-resolver.ts declares no authentication required', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('netlify/functions/nip05-resolver.ts', 'utf-8');
    expect(src).toContain('no authentication required');
  });

  it('well-known-agent.ts declares no authentication required', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('netlify/functions/well-known-agent.ts', 'utf-8');
    expect(src).toContain('no authentication required');
  });

  it('check-username.ts declares no authentication required', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('netlify/functions/check-username.ts', 'utf-8');
    expect(src).toContain('no authentication required');
  });

  it('issuer-registry.ts GET has NIP-98-not-required comment', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('netlify/functions/issuer-registry.ts', 'utf-8');
    expect(src).toContain('NIP-98 not required');
  });
});

// ============================================================================
// S10 Invariant: Auth'd functions import verifyNip98
// ============================================================================

describe('S10 invariant — auth function imports', () => {
  const authFunctions = [
    'register-identity.ts',
    'nwc-proxy.ts',
    'simpleproof-anchor.ts',
    'issuer-registry.ts',
    'unified-comms.ts',
  ];

  for (const fn of authFunctions) {
    it(`${fn} imports verifyNip98`, async () => {
      const fs = await import('fs');
      const src = fs.readFileSync(`netlify/functions/${fn}`, 'utf-8');
      expect(src).toContain('verifyNip98');
    });
  }
});
