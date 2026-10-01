import { describe, it, expect, vi } from 'vitest';

// Liam access & cost brief, Parts C2/C3 (2026-10-01) — cost in micro-dollars
// with the cache fields, and the cap comparison at its boundary. Pure
// functions only; the DB and Firestore config are mocked out.
vi.mock('../db/client.js', () => ({ db: { query: vi.fn() } }));
vi.mock('./sommelierConfig.js', () => ({ getSommelierConfig: vi.fn(() => null) }));

const { computeCostMicros, capBlockReason, parseUsdMicros, usdToMicros } = await import('./anthropicGuard.js');

const controls = (globalDailyUsd: number, liamDailyUsd: number | null = null) => ({
  enabled: true,
  globalDailyUsd,
  features: {
    liam_chat:           { enabled: true, dailyUsd: liamDailyUsd },
    quiz_recommendation: { enabled: true, dailyUsd: null },
    coffee_content:      { enabled: true, dailyUsd: null },
    lifecycle:           { enabled: true, dailyUsd: null },
  },
});

describe('computeCostMicros', () => {
  it('without cache fields: input and output at the base rates (Sonnet 4.6, $3 / $15 per MTok)', () => {
    // 4,000 × $3/MTok = 12,000 µ$; 100 × $15/MTok = 1,500 µ$
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 4000, output_tokens: 100 })).toBe(13500);
  });

  it('treats null cache fields as zero', () => {
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 4000, output_tokens: 100, cache_creation_input_tokens: null, cache_read_input_tokens: null })).toBe(13500);
  });

  it('with cache fields: cache write at 1.25x and cache read at 0.1x of input', () => {
    // uncached 500 × 3 = 1,500; write 3,000 × 3.75 = 11,250; read 1,000 × 0.30 = 300; out 100 × 15 = 1,500
    expect(computeCostMicros('claude-sonnet-4-6', {
      input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 3000, cache_read_input_tokens: 1000,
    })).toBe(14550);
  });

  it('a call costing less than one cent records a non-zero amount', () => {
    const micros = computeCostMicros('claude-sonnet-4-6', { input_tokens: 200, output_tokens: 0, cache_read_input_tokens: 4000 });
    expect(micros).toBe(1800); // $0.0018
    expect(micros).toBeGreaterThan(0);
    expect(micros).toBeLessThan(10_000);
  });

  it('rounds a fractional micro-dollar UP, never down', () => {
    // 1 cache-read token × $0.30/MTok = 0.3 µ$ → 1
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 })).toBe(1);
    // 3 tokens × 0.30 = 0.9 µ$ → 1; 4 tokens = 1.2 µ$ → 2
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 3 })).toBe(1);
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 4 })).toBe(2);
  });

  it('is exact on totals that float arithmetic would get wrong', () => {
    // 10 × 0.30 in float is 3.0000000000000004, which a plain Math.ceil would
    // turn into 4; the scaled integer sum is exactly 3
    expect(computeCostMicros('claude-sonnet-4-6', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10 })).toBe(3);
  });

  it('Haiku 4.5 rates', () => {
    expect(computeCostMicros('claude-haiku-4-5-20251001', {
      input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000,
    })).toBe(1000 + 5000 + 1250 + 100);
  });

  it('costs an unknown model at the Sonnet rate rather than as free', () => {
    expect(computeCostMicros('some-override-model', { input_tokens: 1000, output_tokens: 0 })).toBe(3000);
  });
});

describe('capBlockReason — boundary', () => {
  it('global cap: one micro-dollar under passes, exactly at the cap blocks', () => {
    const cap = usdToMicros(20);
    expect(capBlockReason('liam_chat', controls(20), { totalMicros: cap - 1, byFeatureMicros: {} })).toBeNull();
    expect(capBlockReason('liam_chat', controls(20), { totalMicros: cap, byFeatureMicros: {} })).toBe('global_cap');
  });

  it('feature cap: one micro-dollar under passes, exactly at the cap blocks', () => {
    const c = controls(20, 1.5);
    expect(capBlockReason('liam_chat', c, { totalMicros: 1_499_999, byFeatureMicros: { liam_chat: 1_499_999 } })).toBeNull();
    expect(capBlockReason('liam_chat', c, { totalMicros: 1_500_000, byFeatureMicros: { liam_chat: 1_500_000 } })).toBe('feature_cap');
  });

  it('the env ceiling still wins over a higher admin cap', () => {
    const prev = process.env.CLAUDE_GLOBAL_DAILY_USD;
    process.env.CLAUDE_GLOBAL_DAILY_USD = '5';
    try {
      expect(capBlockReason('liam_chat', controls(20), { totalMicros: usdToMicros(5), byFeatureMicros: {} })).toBe('global_cap');
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_GLOBAL_DAILY_USD; else process.env.CLAUDE_GLOBAL_DAILY_USD = prev;
    }
  });
});

describe('parseUsdMicros', () => {
  it('parses pg BIGINT strings', () => {
    expect(parseUsdMicros('160000')).toBe(160000);
    expect(parseUsdMicros(42)).toBe(42);
  });
  it('throws on garbage instead of reading it as zero', () => {
    expect(() => parseUsdMicros('abc')).toThrow();
    expect(() => parseUsdMicros(undefined)).toThrow();
  });
});
