import {
  DEFAULT_TOKEN,
  SUPPORTED_TOKENS,
  TokenConfig,
  getTokenConfigByAddress,
  isValidTokenAddress,
} from "@/config/tokens";
import { getTokenWhitelist } from "@/lib/contract";

/** Stellar stroops: 1 token = 10^7 base units */
export const STELLAR_DECIMALS = 7;

/**
 * Formats a raw stroop amount (integer) to a human-readable decimal string.
 * e.g. 10_000_000n → "1.0000000"
 */
export function formatTokenAmount(
  rawAmount: bigint | number | string,
  decimals: number = STELLAR_DECIMALS,
): string {
  const amount = BigInt(rawAmount);
  const scale = BigInt(10 ** decimals);
  const isNegative = amount < 0n;
  const abs = isNegative ? -amount : amount;
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = frac.toString().padStart(decimals, "0");
  return `${isNegative ? "-" : ""}${whole}.${fracStr}`;
}

/**
 * Parses a human-readable decimal string to a raw stroop amount (bigint).
 * e.g. "1.0000000" → 10_000_000n
 * Rounds to `decimals` places; excess fractional digits are truncated.
 */
export function parseTokenAmount(
  value: string,
  decimals: number = STELLAR_DECIMALS,
): bigint {
  const trimmed = value.trim();
  const isNegative = trimmed.startsWith("-");
  const abs = isNegative ? trimmed.slice(1) : trimmed;
  const [wholePart = "0", fracPart = ""] = abs.split(".");
  const truncatedFrac = fracPart.slice(0, decimals).padEnd(decimals, "0");
  const raw = BigInt(wholePart) * BigInt(10 ** decimals) + BigInt(truncatedFrac);
  return isNegative ? -raw : raw;
}

/**
 * Resolves the display symbol for a token by its contract address.
 * Falls back to the provided default if the address is not configured.
 */
export function resolveTokenSymbol(
  address: string,
  fallback: string = "UNKNOWN",
): string {
  return getTokenConfigByAddress(address)?.symbol ?? fallback;
}

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
