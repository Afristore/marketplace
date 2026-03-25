// ─────────────────────────────────────────────────────────────
// lib/tokens.ts — Supported tokens configuration
// ─────────────────────────────────────────────────────────────

export interface SupportedToken {
  symbol: string;
  name: string;
  icon?: string;
}

// Tokens supported by the marketplace contract
export const SUPPORTED_TOKENS: SupportedToken[] = [
  { symbol: "XLM", name: "Stellar Lumens", icon: "☆" },
  { symbol: "USDC", name: "USD Coin", icon: "$" },
];

export const DEFAULT_TOKEN = "XLM";

export function getTokenInfo(symbol: string): SupportedToken | undefined {
  return SUPPORTED_TOKENS.find((t) => t.symbol === symbol);
}