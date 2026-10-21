import {
  DEFAULT_TOKEN,
  SUPPORTED_TOKENS,
  TokenConfig,
  getTokenConfigByAddress,
  isValidTokenAddress,
} from "@/config/tokens";
import { getTokenWhitelist } from "@/lib/contract";

export function resolveSupportedTokens(
  whitelistedAddresses: readonly string[],
): TokenConfig[] {
  const validWhitelist = whitelistedAddresses.filter(isValidTokenAddress);

  if (validWhitelist.length === 0) {
    return SUPPORTED_TOKENS;
  }

  const whitelist = new Set(validWhitelist);
  return SUPPORTED_TOKENS.filter((token) => whitelist.has(token.address));
}

export async function fetchSupportedTokens(): Promise<TokenConfig[]> {
  try {
    const whitelist = await getTokenWhitelist();
    return resolveSupportedTokens(whitelist);
  } catch (error) {
    console.error("Failed to fetch supported tokens:", error);
    // Return default supported tokens on error
    return SUPPORTED_TOKENS;
  }
}

export function ensureTokenOption(
  tokens: readonly TokenConfig[],
  tokenAddress: string,
): TokenConfig[] {
  const configuredToken = getTokenConfigByAddress(tokenAddress);
  if (
    !configuredToken ||
    tokens.some((token) => token.address === tokenAddress)
  ) {
    return [...tokens];
  }

  return [...tokens, configuredToken];
}

export function getDefaultSupportedToken(
  tokens: readonly TokenConfig[],
): TokenConfig {
  return (
    tokens.find((token) => token.address === DEFAULT_TOKEN.address) ??
    tokens[0] ??
    DEFAULT_TOKEN
  );
}

export async function assertSupportedTokenAddress(
  tokenAddress: string | undefined,
  context: string,
): Promise<TokenConfig> {
  try {
    const address = tokenAddress ?? DEFAULT_TOKEN.address;

    if (!isValidTokenAddress(address)) {
      throw new Error(`Invalid ${context} token address.`);
    }

    const configuredToken = getTokenConfigByAddress(address);
    if (!configuredToken) {
      throw new Error(`Unsupported ${context} token address.`);
    }

    const whitelist = (await getTokenWhitelist()).filter(isValidTokenAddress);
    if (whitelist.length > 0 && !whitelist.includes(configuredToken.address)) {
      throw new Error(
        "Token address is not enabled in the current contract whitelist.",
      );
    }

    return configuredToken;
  } catch (error) {
    console.error("Failed to assert supported token address:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Resolves a token symbol from an address or symbol name.
 */
export function resolveTokenSymbol(addressOrSymbol?: string): string {
  if (!addressOrSymbol) return DEFAULT_TOKEN.symbol;
  const token = getTokenConfigByAddress(addressOrSymbol);
  if (token) return token.symbol;
  const match = SUPPORTED_TOKENS.find(
    (t) => t.symbol.toLowerCase() === addressOrSymbol.toLowerCase(),
  );
  if (match) return match.symbol;
  const standardSymbols = ["XLM", "USDC", "AFRI"];
  const standardMatch = standardSymbols.find(
    (s) => s.toLowerCase() === addressOrSymbol.toLowerCase(),
  );
  if (standardMatch) return standardMatch;
  return addressOrSymbol;
}

/**
 * Parses a human-readable token amount string into a BigInt with given decimals (default 7 stroops).
 * Uses string splitting to guarantee zero floating point loss.
 */
export function parseTokenAmount(
  amount: string | number,
  decimals = 7,
): bigint {
  let str: string;
  if (typeof amount === "number") {
    if (isNaN(amount)) return 0n;
    str = amount.toFixed(decimals);
  } else {
    str = amount?.trim() ?? "";
  }
  if (!str || str === "" || str === "NaN") {
    return 0n;
  }
  const isNegative = str.startsWith("-");
  const cleanStr = isNegative ? str.slice(1) : str;
  const parts = cleanStr.split(".");
  const whole = parts[0] || "0";
  let frac = parts[1] || "";
  if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  } else {
    frac = frac.padEnd(decimals, "0");
  }
  const multiplier = 10n ** BigInt(decimals);
  const wholeBig = BigInt(whole) * multiplier;
  const fracBig = BigInt(frac);
  const total = wholeBig + fracBig;
  return isNegative ? -total : total;
}

/**
 * Formats a raw token amount (BigInt or string/number) into a human-readable decimal string.
 */
export function formatTokenAmount(
  amount: bigint | number | string,
  decimals = 7,
  options?: { symbol?: string; showSymbol?: boolean; maxDecimals?: number },
): string {
  let bigValue: bigint;
  if (typeof amount === "bigint") {
    bigValue = amount;
  } else if (typeof amount === "number") {
    bigValue = parseTokenAmount(amount, decimals);
  } else {
    const trimmed = amount?.trim() ?? "";
    if (/^-?\d+$/.test(trimmed)) {
      bigValue = BigInt(trimmed);
    } else {
      bigValue = parseTokenAmount(trimmed, decimals);
    }
  }

  const divisor = 10n ** BigInt(decimals);
  const whole = bigValue / divisor;
  const remainder = bigValue % divisor;

  const absWhole = whole < 0n ? -whole : whole;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  const isNegative = bigValue < 0n;
  const sign = isNegative ? "-" : "";

  let fracStr = absRemainder.toString().padStart(decimals, "0").replace(/0+$/, "");

  if (options?.maxDecimals !== undefined && fracStr.length > options.maxDecimals) {
    fracStr = fracStr.slice(0, options.maxDecimals).replace(/0+$/, "");
  }

  const formatted = fracStr ? `${sign}${absWhole}.${fracStr}` : `${sign}${absWhole}`;

  if (options?.symbol && options.showSymbol !== false) {
    return `${formatted} ${options.symbol}`;
  }
  return formatted;
}

