import { DEFAULT_TOKEN, SUPPORTED_TOKENS } from "@/config/tokens";
import {
  assertSupportedTokenAddress,
  fetchSupportedTokens,
  resolveSupportedTokens,
} from "@/lib/token-support";
import { getTokenWhitelist } from "@/lib/contract";

jest.mock("@/lib/contract", () => ({
  getTokenWhitelist: jest.fn(),
}));

describe("token support", () => {
  const whitelistedButUnconfiguredToken =
    "CD3FSSR667WES5YVVUZZ22LFRQ2RB5NGJGGQEGSPP4OXWLJJV5EFHIIR";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps configured tokens when no whitelist addresses are available", () => {
    expect(resolveSupportedTokens([])).toEqual(SUPPORTED_TOKENS);
  });

  it("filters configured tokens against the contract whitelist", () => {
    const token = SUPPORTED_TOKENS[1] ?? DEFAULT_TOKEN;
    expect(resolveSupportedTokens([token.address])).toEqual([token]);
  });

  it("rejects malformed token addresses before contract calls", async () => {
    try {
      await expect(
        assertSupportedTokenAddress("not-a-contract-address", "listing"),
      ).rejects.toThrow("Invalid listing token address.");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("rejects configured tokens that are not in the current whitelist", async () => {
    try {
      (getTokenWhitelist as jest.Mock).mockResolvedValue([
        whitelistedButUnconfiguredToken,
      ]);

      await expect(
        assertSupportedTokenAddress(DEFAULT_TOKEN.address, "listing"),
      ).rejects.toThrow(
        "Token address is not enabled in the current contract whitelist.",
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("rejects unconfigured token addresses even if valid contract address format", async () => {
    try {
      await expect(
        assertSupportedTokenAddress(whitelistedButUnconfiguredToken, "listing"),
      ).rejects.toThrow("Unsupported listing token address.");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("resolves configured token successfully when whitelist includes it", async () => {
    try {
      (getTokenWhitelist as jest.Mock).mockResolvedValue([
        DEFAULT_TOKEN.address,
      ]);

      const token = await assertSupportedTokenAddress(
        DEFAULT_TOKEN.address,
        "listing",
      );
      expect(token).toEqual(DEFAULT_TOKEN);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles unexpected errors when contract call rejects in assertSupportedTokenAddress", async () => {
    try {
      (getTokenWhitelist as jest.Mock).mockRejectedValue(
        new Error("Soroban RPC unreachable"),
      );

      await expect(
        assertSupportedTokenAddress(DEFAULT_TOKEN.address, "listing"),
      ).rejects.toThrow("Soroban RPC unreachable");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("fetches supported tokens and resolves successfully", async () => {
    try {
      (getTokenWhitelist as jest.Mock).mockResolvedValue([
        DEFAULT_TOKEN.address,
      ]);

      const tokens = await fetchSupportedTokens();
      expect(tokens).toEqual([DEFAULT_TOKEN]);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles errors when contract call rejects in fetchSupportedTokens", async () => {
    try {
      (getTokenWhitelist as jest.Mock).mockRejectedValue(
        new Error("Network timeout"),
      );

      // fetchSupportedTokens should return fallback tokens on error
      const tokens = await fetchSupportedTokens();
      expect(tokens).toEqual(SUPPORTED_TOKENS);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
