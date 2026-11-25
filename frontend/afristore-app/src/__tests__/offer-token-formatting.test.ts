import {
  formatTokenAmount,
  resolveOfferTokenDisplay,
  SUPPORTED_TOKENS,
} from "@/config/tokens";

describe("formatTokenAmount in tokens.ts", () => {
  it("formats standard 7-decimal token amounts accurately", () => {
    expect(formatTokenAmount(10_000_000n, 7)).toBe("1");
    expect(formatTokenAmount(5_000_000n, 7)).toBe("0.5");
    expect(formatTokenAmount(10_500_000n, 7)).toBe("1.05");
    expect(formatTokenAmount(1n, 7)).toBe("0.0000001");
    expect(formatTokenAmount(0n, 7)).toBe("0");
  });

  it("formats tokens with custom decimals such as 6 (e.g. USDC SAC) or 2", () => {
    // 6 decimals: 1_000_000 base units = 1.0
    expect(formatTokenAmount(1_000_000n, 6)).toBe("1");
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatTokenAmount(250_000n, 6)).toBe("0.25");
    expect(formatTokenAmount(1n, 6)).toBe("0.000001");

    // 2 decimals: 100 base units = 1.0
    expect(formatTokenAmount(100n, 2)).toBe("1");
    expect(formatTokenAmount(150n, 2)).toBe("1.5");
    expect(formatTokenAmount(5n, 2)).toBe("0.05");
  });

  it("handles negative token amounts correctly", () => {
    expect(formatTokenAmount(-10_000_000n, 7)).toBe("-1");
    expect(formatTokenAmount(-5_000_000n, 7)).toBe("-0.5");
  });

  it("handles zero decimals gracefully", () => {
    expect(formatTokenAmount(42n, 0)).toBe("42");
  });
});

describe("resolveOfferTokenDisplay", () => {
  it("resolves supported token symbol and formats amount using token decimals", () => {
    const supported = SUPPORTED_TOKENS[0];
    if (supported) {
      const result = resolveOfferTokenDisplay(25_000_000n, supported.address);
      expect(result.isUnknown).toBe(false);
      expect(result.symbol).toBe(supported.symbol);
      expect(result.formattedAmount).toBe("2.5");
      expect(result.rawAmount).toBe("25000000");
    }
  });

  it("renders explicit Unknown token (<address>) state for unconfigured tokens", () => {
    const unknownAddress = "CUNKNOWNADDRESS9999999999999999999999999999999999999";
    const result = resolveOfferTokenDisplay(1500000n, unknownAddress);
    expect(result.isUnknown).toBe(true);
    expect(result.symbol).toBe(`Unknown token (${unknownAddress})`);
    expect(result.formattedAmount).toBe("1500000");
    expect(result.rawAmount).toBe("1500000");
  });
});
