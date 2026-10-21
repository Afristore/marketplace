import {
  formatTokenAmount,
  parseTokenAmount,
  resolveTokenSymbol,
} from "../lib/token-support";
import { DEFAULT_TOKEN, SUPPORTED_TOKENS } from "../config/tokens";

describe("token-support.ts — formatTokenAmount, parseTokenAmount & resolveTokenSymbol", () => {
  describe("parseTokenAmount", () => {
    it("parses whole number amounts to stroops (7 decimals)", () => {
      expect(parseTokenAmount("1")).toBe(10_000_000n);
      expect(parseTokenAmount(50)).toBe(500_000_000n);
      expect(parseTokenAmount("100")).toBe(1_000_000_000n);
    });

    it("parses fractional amounts accurately to stroops", () => {
      expect(parseTokenAmount("1.5")).toBe(15_000_000n);
      expect(parseTokenAmount("0.05")).toBe(500_000n);
      expect(parseTokenAmount(1.05)).toBe(10_500_000n);
    });

    it("handles smallest fractional unit (0.0000001 = 1 stroop)", () => {
      expect(parseTokenAmount("0.0000001")).toBe(1n);
      expect(parseTokenAmount(0.0000001)).toBe(1n);
    });

    it("handles 0, empty string, whitespace, and nullish inputs", () => {
      expect(parseTokenAmount("0")).toBe(0n);
      expect(parseTokenAmount(0)).toBe(0n);
      expect(parseTokenAmount("")).toBe(0n);
      expect(parseTokenAmount("   ")).toBe(0n);
    });

    it("handles negative amounts correctly", () => {
      expect(parseTokenAmount("-5")).toBe(-50_000_000n);
      expect(parseTokenAmount("-0.0000001")).toBe(-1n);
      expect(parseTokenAmount("-12.345")).toBe(-123_450_000n);
    });

    it("truncates fractions beyond 7 decimal precision without rounding drift", () => {
      expect(parseTokenAmount("1.123456789")).toBe(11_234_567n);
    });

    it("supports custom decimals (e.g. 2 for fiat, 18 for ERC-20)", () => {
      expect(parseTokenAmount("25.50", 2)).toBe(2550n);
      expect(parseTokenAmount("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    });
  });

  describe("formatTokenAmount", () => {
    it("formats stroops BigInt to decimal string", () => {
      expect(formatTokenAmount(10_000_000n)).toBe("1");
      expect(formatTokenAmount(15_000_000n)).toBe("1.5");
      expect(formatTokenAmount(1n)).toBe("0.0000001");
      expect(formatTokenAmount(0n)).toBe("0");
    });

    it("formats negative stroops values accurately", () => {
      expect(formatTokenAmount(-50_000_000n)).toBe("-5");
      expect(formatTokenAmount(-1n)).toBe("-0.0000001");
      expect(formatTokenAmount(-10_500_000n)).toBe("-1.05");
    });

    it("formats with symbol appended when requested", () => {
      expect(formatTokenAmount(10_000_000n, 7, { symbol: "XLM" })).toBe("1 XLM");
      expect(
        formatTokenAmount(250_000_000n, 7, { symbol: "USDC", showSymbol: false })
      ).toBe("25");
    });

    it("formats with maxDecimals limiting displayed precision", () => {
      expect(
        formatTokenAmount(12_345_678n, 7, { maxDecimals: 2 })
      ).toBe("1.23");
    });

    it("handles string input representing raw stroops or decimal amount", () => {
      expect(formatTokenAmount("10000000")).toBe("1");
      expect(formatTokenAmount("2.5")).toBe("2.5");
    });

    it("supports custom decimals", () => {
      expect(formatTokenAmount(2550n, 2)).toBe("25.5");
    });
  });

  describe("resolveTokenSymbol", () => {
    it("resolves token symbol from known token contract addresses", () => {
      for (const token of SUPPORTED_TOKENS) {
        expect(resolveTokenSymbol(token.address)).toBe(token.symbol);
      }
    });

    it("resolves case-insensitive token symbols", () => {
      expect(resolveTokenSymbol("xlm")).toBe("XLM");
      expect(resolveTokenSymbol("usdc")).toBe("USDC");
    });

    it("falls back to default token symbol when input is empty or undefined", () => {
      expect(resolveTokenSymbol("")).toBe(DEFAULT_TOKEN.symbol);
      expect(resolveTokenSymbol(undefined)).toBe(DEFAULT_TOKEN.symbol);
    });

    it("returns raw unknown address if no match found", () => {
      const unknown = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      expect(resolveTokenSymbol(unknown)).toBe(unknown);
    });
  });
});
