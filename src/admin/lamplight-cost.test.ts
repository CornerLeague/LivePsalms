import { describe, it, expect } from 'vitest';
import { estCostCents, formatCents } from './lamplight-cost';

describe('lamplight-cost', () => {
  it('voyage-3-large: 1M in tokens → 18 cents', () => {
    expect(estCostCents('voyage-3-large', 1_000_000, 0)).toBe(18);
  });

  it('voyage-context-3: 1M in tokens → 18 cents', () => {
    expect(estCostCents('voyage-context-3', 1_000_000, 0)).toBe(18);
  });

  it('gpt-5.6-terra: 1M in + 500k out → 800 cents', () => {
    expect(estCostCents('gpt-5.6-terra', 1_000_000, 500_000)).toBe(800);
  });

  it('gpt-5.6-luna: 1M in + 500k out → 80 cents', () => {
    expect(estCostCents('gpt-5.6-luna', 1_000_000, 500_000)).toBe(80);
  });

  it('gpt-5.6-sol: 1M in + 500k out → 2000 cents', () => {
    expect(estCostCents('gpt-5.6-sol', 1_000_000, 500_000)).toBe(2000);
  });

  it('unknown model defaults to 0 cents', () => {
    expect(estCostCents('mystery-model', 9_999_999, 9_999_999)).toBe(0);
  });

  it('null model (no model ran) defaults to 0 cents', () => {
    expect(estCostCents(null, 9_999_999, 9_999_999)).toBe(0);
  });

  it('formatCents renders dollars with two decimals', () => {
    expect(formatCents(1050)).toBe('$10.50');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(7)).toBe('$0.07');
  });

  // Historical lamplight_usage rows still carry Claude model ids; they must keep
  // pricing so past spend doesn't display as $0.
  it('retains legacy Claude rates for pre-switch usage rows', () => {
    expect(estCostCents('claude-sonnet-4-6', 1_000_000, 500_000)).toBe(1050);
    expect(estCostCents('claude-haiku-4-5-20251001', 1_000_000, 500_000))
      .toBe(estCostCents('claude-haiku-4-5', 1_000_000, 500_000));
  });
});
