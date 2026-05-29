import { stroopsToXlm } from '../lib/contract'

describe('stroopsToXlm', () => {
  it('correctly converts 0 stroops to "0"', () => {
    expect(stroopsToXlm(0n)).toBe('0')
  })

  it('correctly converts whole XLM values', () => {
    expect(stroopsToXlm(10_000_000n)).toBe('1')
    expect(stroopsToXlm(500_000_000n)).toBe('50')
  })

  it('correctly converts fractional XLM values', () => {
    expect(stroopsToXlm(10_500_000n)).toBe('1.05')
    expect(stroopsToXlm(10_000_001n)).toBe('1.0000001')
    expect(stroopsToXlm(1n)).toBe('0.0000001')
  })

  it('correctly handles negative values', () => {
    expect(stroopsToXlm(-10_500_000n)).toBe('-1.05')
    expect(stroopsToXlm(-1n)).toBe('-0.0000001')
    expect(stroopsToXlm(-10_000_000n)).toBe('-1')
  })

  it('preserves precision for extremely large values that would overflow JavaScript Number', () => {
    // 2^53 is 9_007_199_254_740_992. Let's use a much larger i128 value.
    const largeStroops = 123456789012345678901234567890n
    // Division by 10_000_000n should give:
    // Whole: 12345678901234567890123n
    // Frac: 4567890n -> "456789"
    expect(stroopsToXlm(largeStroops)).toBe('12345678901234567890123.456789')
  })
})
