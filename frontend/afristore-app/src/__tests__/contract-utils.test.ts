/**
 * Tests for pure utility functions exported from lib/contract.ts.
 * No blockchain connection required.
 */
import { stroopsToXlm } from '@/lib/contract';

describe('stroopsToXlm', () => {
  it('converts whole-XLM amounts (no trailing zeros)', () => {
    // 1 XLM = 10_000_000 stroops
    expect(stroopsToXlm(10_000_000n)).toBe('1');
  });

  it('converts fractional XLM amounts', () => {
    // 0.5 XLM = 5_000_000 stroops
    expect(stroopsToXlm(5_000_000n)).toBe('0.5');
  });

  it('converts a price with 7 significant decimal places', () => {
    // 0.0000001 XLM = 1 stroop
    expect(stroopsToXlm(1n)).toBe('0.0000001');
  });

  it('handles zero stroops', () => {
    expect(stroopsToXlm(0n)).toBe('0');
  });

  it('strips trailing zeros after the decimal point', () => {
    // 1.5000000 → '1.5'
    expect(stroopsToXlm(15_000_000n)).toBe('1.5');
  });

  it('handles large amounts (e.g. 1000 XLM)', () => {
    expect(stroopsToXlm(10_000_000_000n)).toBe('1000');
  });

  it('handles prices used in the marketplace (250 XLM)', () => {
    expect(stroopsToXlm(2_500_000_000n)).toBe('250');
  });
});
