import {
  calculateAccruedInterest,
  calculateHealthFactor,
  toBigInt,
  MAX_HEALTH_FACTOR_BPS,
  DEFAULT_DECLARED_PRICE_USD,
} from "@/lib/lendingMath";

describe("toBigInt", () => {
  it("returns bigint unchanged", () => {
    expect(toBigInt(100n)).toBe(100n);
  });

  it("throws on non-integer number", () => {
    expect(() => toBigInt(10.5)).toThrow(TypeError);
  });

  it("throws on non-matching string", () => {
    expect(() => toBigInt("10.5")).toThrow(TypeError);
    expect(() => toBigInt("abc")).toThrow(TypeError);
  });

  it("throws on invalid type", () => {
    expect(() => toBigInt({} as any)).toThrow(TypeError);
  });
});

describe("calculateAccruedInterest", () => {
  const PRICE = 100_000_000n;

  it("returns 0 when no months have elapsed", () => {
    expect(calculateAccruedInterest([500], 0, PRICE)).toBe(0n);
  });

  it("accrues one full month at the schedule rate", () => {
    expect(calculateAccruedInterest([500], 1, PRICE)).toBe(5_000_000n);
  });

  it("accrues several months at a constant rate", () => {
    expect(calculateAccruedInterest([500], 3, PRICE)).toBe(15_000_000n);
  });

  it("uses the second month's rate once the schedule advances", () => {
    expect(calculateAccruedInterest([500, 800], 2, PRICE)).toBe(13_000_000n);
  });

  it("repeats the last schedule entry indefinitely (contract test vector)", () => {
    expect(calculateAccruedInterest([500, 800], 3, PRICE)).toBe(21_000_000n);
  });

  it("floors fractional elapsed months to completed months", () => {
    expect(calculateAccruedInterest([500], 1.99, PRICE)).toBe(5_000_000n);
    expect(calculateAccruedInterest([500], 0.5, PRICE)).toBe(0n);
  });

  it("uses the default contract reference price when none is supplied", () => {
    expect(calculateAccruedInterest([500], 1)).toBe(5_000_000n);
  });

  it("accepts numeric and integer-string inputs", () => {
    expect(calculateAccruedInterest([500], 1, 100000000)).toBe(5_000_000n);
    expect(calculateAccruedInterest([500], 1, "100000000")).toBe(5_000_000n);
  });

  it("throws on an empty schedule (mirrors the contract panic)", () => {
    expect(() => calculateAccruedInterest([], 1, PRICE)).toThrow();
  });

  it("throws when elapsedMonths is not finite", () => {
    expect(() => calculateAccruedInterest([500], Infinity, PRICE)).toThrow(TypeError);
    expect(() => calculateAccruedInterest([500], NaN, PRICE)).toThrow(TypeError);
  });
});

describe("calculateHealthFactor", () => {
  it("computes the bps health factor exactly", () => {
    expect(calculateHealthFactor(150_000_000n, 100_000_000n)).toBe(15000n);
  });

  it("computes a below-threshold factor", () => {
    expect(calculateHealthFactor(95_000_000n, 100_000_000n)).toBe(9500n);
  });

  it("factors in accrued interest as part of the debt", () => {
    const debt = 100_000_000n + calculateAccruedInterest([1000], 1, 100_000_000n);
    expect(calculateHealthFactor(110_000_000n, debt)).toBe(10000n);
  });

  it("truncates fractional bps like the contract's i128 division", () => {
    expect(calculateHealthFactor(100_000_000n, 30_000_000n)).toBe(33333n);
  });

  it("treats zero debt as infinitely healthy", () => {
    expect(calculateHealthFactor(100_000_000n, 0n)).toBe(MAX_HEALTH_FACTOR_BPS);
  });

  it("treats negative debt as infinitely healthy", () => {
    expect(calculateHealthFactor(100_000_000n, -10n)).toBe(MAX_HEALTH_FACTOR_BPS);
  });

  it("accepts numeric and integer-string inputs", () => {
    expect(calculateHealthFactor(150000000, "100000000")).toBe(15000n);
  });
});
