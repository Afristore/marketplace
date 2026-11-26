import {
  feesSchema,
  formatFixed7,
  parseFixed7,
  topUpAmountSchema,
  validateLendingListing,
} from "@/lib/lendingValidation";

describe("feesSchema (#1273)", () => {
  it("accepts fees whose sum is below 10000 bps", () => {
    expect(feesSchema.safeParse({ platformFeeBps: "100", liquidatorFeeBps: "500" }).success).toBe(
      true,
    );
    expect(feesSchema.safeParse({ platformFeeBps: "0", liquidatorFeeBps: "9999" }).success).toBe(
      true,
    );
  });

  it("rejects fees that sum to 10000 bps or more", () => {
    for (const [p, l] of [
      ["5000", "5000"],
      ["9000", "1500"],
    ]) {
      const result = feesSchema.safeParse({ platformFeeBps: p, liquidatorFeeBps: l });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/together must be less than 10000/);
        expect(result.error.issues[0].path).toEqual(["liquidatorFeeBps"]);
      }
    }
  });

  it("still validates each fee individually", () => {
    expect(feesSchema.safeParse({ platformFeeBps: "", liquidatorFeeBps: "1" }).success).toBe(false);
    expect(feesSchema.safeParse({ platformFeeBps: "1.5", liquidatorFeeBps: "1" }).success).toBe(
      false,
    );
    expect(feesSchema.safeParse({ platformFeeBps: "10001", liquidatorFeeBps: "0" }).success).toBe(
      false,
    );
  });
});

describe("parseFixed7 / formatFixed7", () => {
  it("parses decimals into 7-decimal fixed point without float error", () => {
    expect(parseFixed7("1")).toBe(10_000_000n);
    expect(parseFixed7("0.1")).toBe(1_000_000n);
    expect(parseFixed7("12.3456789")).toBe(123_456_789n);
    expect(parseFixed7("0.00000001")).toBeNull();
    expect(parseFixed7("-1")).toBeNull();
    expect(parseFixed7("abc")).toBeNull();
  });

  it("formats fixed point for messages", () => {
    expect(formatFixed7(25_000_000n)).toBe("2.5");
    expect(formatFixed7(10_000_000n)).toBe("1");
  });
});

describe("topUpAmountSchema (#1271)", () => {
  it("rejects empty, zero, negative and malformed amounts", () => {
    const schema = topUpAmountSchema(null);
    for (const v of ["", "0", "0.0", "-5", "abc", "1.123456789"]) {
      expect(schema.safeParse(v).success).toBe(false);
    }
    expect(schema.safeParse("0.5").success).toBe(true);
  });

  it("rejects amounts above the wallet balance", () => {
    const schema = topUpAmountSchema(20_000_000n); // 2 units
    expect(schema.safeParse("2").success).toBe(true);
    const result = schema.safeParse("2.0000001");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Insufficient balance: your wallet holds 2");
    }
  });
});

describe("validateLendingListing", () => {
  const input = {
    nftContract: "CNFT",
    tokenId: 1,
    declaredPriceUsd: 1n,
    interestScheduleBps: [300],
    maxDurationDays: 30,
    minCollateralBufferBps: 12000,
    liquidationThresholdBps: 11000,
  };
  const bounds = {
    minBufferBps: 12000,
    maxBufferBps: 20000,
    minLiqThresholdBps: 10500,
    maxLiqThresholdBps: 12000,
  };

  it("accepts a valid listing", () => {
    expect(validateLendingListing(input, bounds)).toEqual({ valid: true });
  });

  it("mirrors the contract's checks", () => {
    expect(validateLendingListing({ ...input, declaredPriceUsd: 0n })).toMatchObject({
      valid: false,
    });
    expect(validateLendingListing({ ...input, maxDurationDays: 0 })).toMatchObject({
      valid: false,
    });
    expect(validateLendingListing({ ...input, liquidationThresholdBps: 13000 }, bounds)).toEqual({
      valid: false,
      error: "Liquidation threshold must be between 10500 and 12000 bps",
    });
  });
});
