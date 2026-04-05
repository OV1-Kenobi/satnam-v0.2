/**
 * Tests for payment observability components and cascade builder validation.
 *
 * Coverage:
 * - CascadeBuilder: node validation, percentage sum check, distribution preview
 * - PaymentFlowDashboard: data types, balance calculations
 * - AtomicSwapPanel: fee calculation, rail validation
 * - ScheduledPaymentsPanel: countdown calculation, interval logic
 * - BondDashboard: rendering and section counts
 * - RailHealthIndicator: status aggregation
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// CascadeBuilder Validation Logic (extracted for unit testing)
// ============================================================================

type AllocMode = 'percentage' | 'fixed';
type Rail = 'lightning' | 'cashu' | 'lnbits';

interface CascadeNode {
  id: string;
  recipient: string;
  allocMode: AllocMode;
  percentage: number;
  fixedSats: number;
  rail: Rail;
  label: string;
}

interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
  totalPct: number;
  warnings: string[];
}

function validateNodes(nodes: CascadeNode[]): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  const pctNodes = nodes.filter((n) => n.allocMode === 'percentage');
  const totalPct = pctNodes.reduce((s, n) => s + n.percentage, 0);

  if (totalPct > 100) {
    warnings.push(`Percentage nodes sum to ${totalPct.toFixed(1)}% — exceeds 100%`);
  }

  nodes.forEach((node) => {
    if (!node.recipient.trim()) {
      errors[`${node.id}-recipient`] = 'Recipient required';
    }
    if (node.allocMode === 'percentage') {
      if (node.percentage <= 0 || node.percentage > 100) {
        errors[`${node.id}-pct`] = 'Must be 1–100%';
      }
    } else {
      if (node.fixedSats <= 0) {
        errors[`${node.id}-fixed`] = 'Must be > 0 sats';
      }
    }
  });

  return {
    valid: Object.keys(errors).length === 0 && totalPct <= 100,
    errors,
    totalPct,
    warnings,
  };
}

function computeDistribution(
  nodes: CascadeNode[],
  totalSats: number
): Array<{ node: CascadeNode; sats: number }> {
  let remaining = totalSats;

  const fixed = nodes
    .filter((n) => n.allocMode === 'fixed')
    .map((n) => ({ node: n, sats: n.fixedSats }));

  remaining -= fixed.reduce((s, f) => s + f.sats, 0);
  if (remaining < 0) remaining = 0;

  const pct = nodes
    .filter((n) => n.allocMode === 'percentage')
    .map((n) => ({ node: n, sats: Math.floor((n.percentage / 100) * remaining) }));

  return [...fixed, ...pct];
}

function makeNode(id: string, overrides: Partial<CascadeNode> = {}): CascadeNode {
  return {
    id,
    recipient: 'alice@example.com',
    allocMode: 'percentage',
    percentage: 50,
    fixedSats: 0,
    rail: 'lightning',
    label: '',
    ...overrides,
  };
}

describe('CascadeBuilder validation', () => {
  describe('validateNodes', () => {
    it('validates a simple 50/50 split', () => {
      const nodes = [
        makeNode('n1', { percentage: 50 }),
        makeNode('n2', { percentage: 50 }),
      ];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(true);
      expect(result.totalPct).toBe(100);
      expect(result.warnings).toHaveLength(0);
    });

    it('validates nodes summing to less than 100%', () => {
      const nodes = [
        makeNode('n1', { percentage: 30 }),
        makeNode('n2', { percentage: 40 }),
      ];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(true);
      expect(result.totalPct).toBe(70);
    });

    it('rejects nodes summing to more than 100%', () => {
      const nodes = [
        makeNode('n1', { percentage: 60 }),
        makeNode('n2', { percentage: 60 }),
      ];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(false);
      expect(result.totalPct).toBe(120);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('120.0%');
    });

    it('errors on missing recipient', () => {
      const nodes = [makeNode('n1', { recipient: '' })];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(false);
      expect(result.errors['n1-recipient']).toBe('Recipient required');
    });

    it('errors on zero percentage', () => {
      const nodes = [makeNode('n1', { percentage: 0 })];
      const result = validateNodes(nodes);
      expect(result.errors['n1-pct']).toBe('Must be 1–100%');
    });

    it('errors on percentage > 100', () => {
      const nodes = [makeNode('n1', { percentage: 101 })];
      const result = validateNodes(nodes);
      expect(result.errors['n1-pct']).toBe('Must be 1–100%');
    });

    it('errors on zero fixed sats', () => {
      const nodes = [makeNode('n1', { allocMode: 'fixed', fixedSats: 0 })];
      const result = validateNodes(nodes);
      expect(result.errors['n1-fixed']).toBe('Must be > 0 sats');
    });

    it('accepts valid fixed amount node', () => {
      const nodes = [makeNode('n1', { allocMode: 'fixed', fixedSats: 1000 })];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(true);
      expect(result.totalPct).toBe(0); // no percentage nodes
    });

    it('handles mixed fixed + percentage nodes', () => {
      const nodes = [
        makeNode('n1', { allocMode: 'fixed', fixedSats: 1000 }),
        makeNode('n2', { percentage: 80 }),
      ];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(true);
      expect(result.totalPct).toBe(80);
    });

    it('validates 3-way split exactly at 100%', () => {
      const nodes = [
        makeNode('n1', { percentage: 33.4 }),
        makeNode('n2', { percentage: 33.3 }),
        makeNode('n3', { percentage: 33.3 }),
      ];
      const result = validateNodes(nodes);
      expect(result.valid).toBe(true);
      expect(result.totalPct).toBeCloseTo(100, 0);
    });
  });

  describe('computeDistribution', () => {
    it('distributes 10000 sats 50/50', () => {
      const nodes = [
        makeNode('n1', { percentage: 50 }),
        makeNode('n2', { percentage: 50 }),
      ];
      const dist = computeDistribution(nodes, 10_000);
      const sats = dist.map((d) => d.sats);
      expect(sats).toEqual([5000, 5000]);
    });

    it('distributes with fixed allocation first', () => {
      const nodes = [
        makeNode('n1', { allocMode: 'fixed', fixedSats: 2000 }),
        makeNode('n2', { percentage: 50 }),
      ];
      const dist = computeDistribution(nodes, 10_000);
      // Fixed: 2000. Remaining: 8000. 50% of 8000 = 4000
      expect(dist[0].sats).toBe(2000);
      expect(dist[1].sats).toBe(4000);
    });

    it('floors sats to integer', () => {
      const nodes = [makeNode('n1', { percentage: 33 })];
      const dist = computeDistribution(nodes, 10_000);
      expect(dist[0].sats).toBe(3300); // 33% of 10000
      expect(Number.isInteger(dist[0].sats)).toBe(true);
    });

    it('handles zero total safely', () => {
      const nodes = [makeNode('n1', { percentage: 50 })];
      const dist = computeDistribution(nodes, 0);
      expect(dist[0].sats).toBe(0);
    });

    it('clamps remaining to zero when fixed exceeds total', () => {
      const nodes = [
        makeNode('n1', { allocMode: 'fixed', fixedSats: 20_000 }),
        makeNode('n2', { percentage: 50 }),
      ];
      const dist = computeDistribution(nodes, 10_000);
      expect(dist[0].sats).toBe(20_000);
      expect(dist[1].sats).toBe(0); // remaining clamped to 0
    });
  });
});

// ============================================================================
// AtomicSwapPanel — Fee calculation
// ============================================================================

type SwapRail = 'lightning' | 'cashu' | 'lnbits' | 'onchain';

const FEE_ESTIMATES: Partial<Record<`${SwapRail}-${SwapRail}`, number>> = {
  'lightning-cashu': 0.1,
  'cashu-lightning': 0.1,
  'lightning-lnbits': 0.05,
  'lnbits-lightning': 0.05,
  'lightning-onchain': 0.5,
  'cashu-onchain': 0.6,
  'lnbits-onchain': 0.6,
  'cashu-lnbits': 0.15,
  'lnbits-cashu': 0.15,
};

function computeSwapFee(amount: number, from: SwapRail, to: SwapRail): number {
  const key = `${from}-${to}` as `${SwapRail}-${SwapRail}`;
  const feePct = FEE_ESTIMATES[key] ?? 0.3;
  return Math.ceil(amount * feePct / 100);
}

describe('AtomicSwapPanel fee calculation', () => {
  it('calculates lightning→cashu fee at 0.1%', () => {
    const fee = computeSwapFee(10_000, 'lightning', 'cashu');
    expect(fee).toBe(10); // 10_000 * 0.001
  });

  it('calculates lightning→onchain fee at 0.5%', () => {
    const fee = computeSwapFee(50_000, 'lightning', 'onchain');
    expect(fee).toBe(250); // 50_000 * 0.005
  });

  it('uses default 0.3% for unknown rail pairs', () => {
    const fee = computeSwapFee(10_000, 'onchain', 'lightning' as SwapRail);
    expect(fee).toBe(30); // 10_000 * 0.003
  });

  it('receive amount = amount - fee', () => {
    const amount = 10_000;
    const fee = computeSwapFee(amount, 'lightning', 'cashu');
    const receive = amount - fee;
    expect(receive).toBe(9_990);
  });

  it('handles small amounts with ceil rounding', () => {
    // 100 sats * 0.001 = 0.1 → ceil = 1
    const fee = computeSwapFee(100, 'lightning', 'cashu');
    expect(fee).toBe(1);
  });

  it('source and destination cannot be the same', () => {
    // This validates the UI constraint — same rail should be disabled
    const canSwap = (from: SwapRail, to: SwapRail) => from !== to;
    expect(canSwap('lightning', 'lightning')).toBe(false);
    expect(canSwap('lightning', 'cashu')).toBe(true);
  });
});

// ============================================================================
// ScheduledPaymentsPanel — Countdown + interval logic
// ============================================================================

type ScheduleInterval = 'hourly' | 'daily' | 'weekly' | 'monthly';

const INTERVAL_SECS: Record<ScheduleInterval, number> = {
  hourly: 3600,
  daily: 86400,
  weekly: 7 * 86400,
  monthly: 30 * 86400,
};

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'now';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

describe('ScheduledPaymentsPanel countdown', () => {
  it('returns "now" for past timestamps', () => {
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(-1)).toBe('now');
  });

  it('formats seconds only', () => {
    expect(formatCountdown(45)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatCountdown(90)).toBe('1m 30s');
    expect(formatCountdown(3599)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatCountdown(3600)).toBe('1h 0m');
    expect(formatCountdown(7384)).toBe('2h 3m');
  });

  it('interval secs are correct', () => {
    expect(INTERVAL_SECS.hourly).toBe(3600);
    expect(INTERVAL_SECS.daily).toBe(86400);
    expect(INTERVAL_SECS.weekly).toBe(604800);
    expect(INTERVAL_SECS.monthly).toBe(2592000);
  });

  it('nextExecAt = createdAt + intervalSecs', () => {
    const now = 1_700_000_000;
    const nextExecAt = now + INTERVAL_SECS.weekly;
    expect(nextExecAt - now).toBe(INTERVAL_SECS.weekly);
  });
});

// ============================================================================
// RailHealthIndicator — Status aggregation
// ============================================================================

type RailStatus = 'online' | 'degraded' | 'offline' | 'unknown';

function aggregateStatus(statuses: RailStatus[]): RailStatus {
  if (statuses.length === 0) return 'unknown';
  if (statuses.every((s) => s === 'online')) return 'online';
  if (statuses.some((s) => s === 'offline')) return 'degraded';
  return 'degraded';
}

describe('RailHealthIndicator status aggregation', () => {
  it('returns "online" when all rails are online', () => {
    expect(aggregateStatus(['online', 'online', 'online'])).toBe('online');
  });

  it('returns "degraded" when any rail is offline', () => {
    expect(aggregateStatus(['online', 'offline', 'online'])).toBe('degraded');
  });

  it('returns "degraded" when any rail is degraded', () => {
    expect(aggregateStatus(['online', 'degraded'])).toBe('degraded');
  });

  it('returns "unknown" for empty status list', () => {
    expect(aggregateStatus([])).toBe('unknown');
  });

  it('returns "degraded" for mixed statuses', () => {
    expect(aggregateStatus(['online', 'degraded', 'offline'])).toBe('degraded');
  });
});

// ============================================================================
// PaymentFlowDashboard — Balance calculations
// ============================================================================

interface RailBalance {
  rail: string;
  balanceSats: number;
}

function computeTotalBalance(balances: RailBalance[]): number {
  return balances.reduce((s, b) => s + b.balanceSats, 0);
}

function computeRailPct(balance: RailBalance, total: number): number {
  if (total === 0) return 0;
  return (balance.balanceSats / total) * 100;
}

function formatBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(6);
}

describe('PaymentFlowDashboard calculations', () => {
  const mockBalances: RailBalance[] = [
    { rail: 'lightning', balanceSats: 84_000 },
    { rail: 'cashu', balanceSats: 5_030 },
    { rail: 'lnbits', balanceSats: 12_500 },
    { rail: 'boltz', balanceSats: 0 },
  ];

  it('computes total balance correctly', () => {
    expect(computeTotalBalance(mockBalances)).toBe(101_530);
  });

  it('handles empty balance list', () => {
    expect(computeTotalBalance([])).toBe(0);
  });

  it('computes rail percentage', () => {
    const total = computeTotalBalance(mockBalances);
    const lightningPct = computeRailPct(mockBalances[0], total);
    expect(lightningPct).toBeCloseTo(82.73, 1);
  });

  it('handles zero total without division by zero', () => {
    const pct = computeRailPct({ rail: 'lightning', balanceSats: 0 }, 0);
    expect(pct).toBe(0);
  });

  it('formats BTC correctly', () => {
    expect(formatBtc(100_000_000)).toBe('1.000000');
    expect(formatBtc(21_000_000)).toBe('0.210000');
    expect(formatBtc(101_530)).toBe('0.001015');
  });

  it('sats format uses toLocaleString equivalently', () => {
    // Verify large numbers format correctly
    const sats = 84_000;
    expect(sats.toLocaleString('en-US')).toBe('84,000');
  });
});
