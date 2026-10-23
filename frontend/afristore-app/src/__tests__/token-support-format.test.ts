import {
    STELLAR_DECIMALS,
    formatTokenAmount,
    parseTokenAmount,
    resolveTokenSymbol,
} from "@/lib/token-support";
import { DEFAULT_TOKEN, SUPPORTED_TOKENS } from "@/config/tokens";

// resolveTokenSymbol calls getTokenConfigByAddress which reads SUPPORTED_TOKENS
// — no async contract calls needed, so no mocks required.

describe("STELLAR_DECIMALS", () => {
    it("is 7", () => {
        expect(STELLAR_DECIMALS).toBe(7);
    });
});

describe("formatTokenAmount", () => {
    it("formats 1 token (10_000_000 stroops)", () => {
        expect(formatTokenAmount(10_000_000n)).toBe("1.0000000");
    });

    it("formats 0 stroops", () => {
        expect(formatTokenAmount(0n)).toBe("0.0000000");
    });

    it("formats a fractional amount", () => {
        expect(formatTokenAmount(5_000_000n)).toBe("0.5000000");
    });

    it("formats a large amount", () => {
        expect(formatTokenAmount(1_000_000_000_000n)).toBe("100000.0000000");
    });

    it("formats 1 stroop (minimum unit)", () => {
        expect(formatTokenAmount(1n)).toBe("0.0000001");
    });

    it("formats a negative amount", () => {
        expect(formatTokenAmount(-10_000_000n)).toBe("-1.0000000");
    });

    it("formats a negative fractional amount", () => {
        expect(formatTokenAmount(-1n)).toBe("-0.0000001");
    });

    it("accepts a number input", () => {
        expect(formatTokenAmount(10_000_000)).toBe("1.0000000");
    });

    it("accepts a string input", () => {
        expect(formatTokenAmount("10000000")).toBe("1.0000000");
    });

    it("pads fractional part to full decimals width", () => {
        // 10 stroops → 0.0000010
        expect(formatTokenAmount(10n)).toBe("0.0000010");
    });

    it("respects a custom decimals argument", () => {
        // 2 decimal places: 100 base units = 1.00
        expect(formatTokenAmount(100n, 2)).toBe("1.00");
    });
});

describe("parseTokenAmount", () => {
    it("parses '1.0000000' to 10_000_000n", () => {
        expect(parseTokenAmount("1.0000000")).toBe(10_000_000n);
    });

    it("parses '0' to 0n", () => {
        expect(parseTokenAmount("0")).toBe(0n);
    });

    it("parses '0.0000000' to 0n", () => {
        expect(parseTokenAmount("0.0000000")).toBe(0n);
    });

    it("parses a fractional value", () => {
        expect(parseTokenAmount("0.5000000")).toBe(5_000_000n);
    });

    it("parses a large value", () => {
        expect(parseTokenAmount("100000.0000000")).toBe(1_000_000_000_000n);
    });

    it("parses minimum unit '0.0000001'", () => {
        expect(parseTokenAmount("0.0000001")).toBe(1n);
    });

    it("parses a negative amount", () => {
        expect(parseTokenAmount("-1.0000000")).toBe(-10_000_000n);
    });

    it("parses a negative fractional amount", () => {
        expect(parseTokenAmount("-0.0000001")).toBe(-1n);
    });

    it("truncates extra fractional digits beyond 7 decimals", () => {
        // "1.00000001" has 8 fractional digits — the 8th is dropped
        expect(parseTokenAmount("1.00000001")).toBe(10_000_000n);
    });

    it("pads short fractional parts", () => {
        // "1.5" → same as "1.5000000"
        expect(parseTokenAmount("1.5")).toBe(15_000_000n);
    });

    it("handles leading/trailing whitespace", () => {
        expect(parseTokenAmount("  1.0000000  ")).toBe(10_000_000n);
    });

    it("respects a custom decimals argument", () => {
        expect(parseTokenAmount("1.00", 2)).toBe(100n);
    });
});

describe("formatTokenAmount / parseTokenAmount roundtrip", () => {
    const cases = [0n, 1n, 10n, 5_000_000n, 10_000_000n, 999_999_999n];

    it.each(cases)("roundtrips %s stroops", (stroops) => {
        expect(parseTokenAmount(formatTokenAmount(stroops))).toBe(stroops);
    });

    it("roundtrips a negative value", () => {
        expect(parseTokenAmount(formatTokenAmount(-10_000_000n))).toBe(
            -10_000_000n,
        );
    });
});

describe("resolveTokenSymbol", () => {
    it("returns the symbol for a configured token address", () => {
        expect(resolveTokenSymbol(DEFAULT_TOKEN.address)).toBe(DEFAULT_TOKEN.symbol);
    });

    it("returns the fallback for an unknown address", () => {
        expect(resolveTokenSymbol("CUNKNOWN", "???")).toBe("???");
    });

    it("defaults fallback to 'UNKNOWN' when not provided", () => {
        expect(resolveTokenSymbol("CUNKNOWN")).toBe("UNKNOWN");
    });

    it("resolves all configured SUPPORTED_TOKENS by address", () => {
        for (const token of SUPPORTED_TOKENS) {
            expect(resolveTokenSymbol(token.address)).toBe(token.symbol);
        }
    });
});
