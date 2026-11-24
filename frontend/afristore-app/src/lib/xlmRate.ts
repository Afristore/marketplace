// ─────────────────────────────────────────────────────────────
// lib/xlmRate.ts — XLM / USD rate resolution
//
// Priority order:
//   1. Live price from CoinGecko oracle (fetched client-side)
//   2. NEXT_PUBLIC_XLM_USD_RATE  env-var override (useful for CI / staging)
//   3. DEFAULT_XLM_USD_RATE      compile-time safety fallback
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";

/** Compile-time safety fallback — only used when all live sources fail. */
export const DEFAULT_XLM_USD_RATE = 0.12;

/** CoinGecko simple-price endpoint for XLM → USD. */
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd";

/** Cache entry to limit redundant API calls within the same page session. */
let _cachedRate: number | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Returns the current XLM/USD exchange rate.
 *
 * In order:
 *  1. Returns the in-memory cached value if still fresh.
 *  2. Fetches a live quote from CoinGecko and caches the result.
 *  3. Falls back to the `NEXT_PUBLIC_XLM_USD_RATE` env var if the fetch fails.
 *  4. Falls back to `DEFAULT_XLM_USD_RATE` if the env var is unset.
 *
 * This function is safe to call from client components.
 */
export async function fetchXlmUsdRate(): Promise<number> {
  const now = Date.now();

  // 1. Return cached value if still fresh
  if (_cachedRate !== null && now < _cacheExpiry) {
    return _cachedRate;
  }

  // 2. Try CoinGecko price oracle
  try {
    const res = await fetch(COINGECKO_URL, { next: { revalidate: 300 } });
    if (res.ok) {
      const data = await res.json();
      const rate = data?.stellar?.usd;
      if (typeof rate === "number" && rate > 0) {
        _cachedRate = rate;
        _cacheExpiry = now + CACHE_TTL_MS;
        return rate;
      }
    }
  } catch {
    // Network error or CORS — fall through to env var / default
  }

  // 3. Env-var override (e.g. NEXT_PUBLIC_XLM_USD_RATE=0.15)
  const envRate = parseFloat(
    process.env.NEXT_PUBLIC_XLM_USD_RATE ?? "",
  );
  if (!isNaN(envRate) && envRate > 0) {
    return envRate;
  }

  // 4.Compile-time safety fallback
  return DEFAULT_XLM_USD_RATE;
}

/**
 * Returns the configurable XLM/USD rate synchronously.
 *
 * Suitable for use during SSR or in non-async contexts.
 * Does NOT hit the oracle; reads only the env var / default.
 * Prefer `fetchXlmUsdRate()` in client components.
 */
export function getStaticXlmUsdRate(): number {
  const envRate = parseFloat(process.env.NEXT_PUBLIC_XLM_USD_RATE ?? "");
  if (!isNaN(envRate) && envRate > 0) return envRate;
  return DEFAULT_XLM_USD_RATE;
}

/**
 * Resets the in-memory rate cache.
 * Internal use only — primarily for testing.
 */
export function __resetCache(): void {
  _cachedRate = null;
  _cacheExpiry = 0;
}

/**
 * React hook returning the XLM/USD rate.
 *
 * Starts from the synchronous env-var / default rate so the first render never
 * waits on the network, then swaps in the live quote once `fetchXlmUsdRate()`
 * resolves. A failed fetch keeps the fallback rate.
 */
export function useXlmRate(): number {
  const [rate, setRate] = useState<number>(getStaticXlmUsdRate);

  useEffect(() => {
    let cancelled = false;
    fetchXlmUsdRate()
      .then((live) => {
        if (!cancelled) setRate(live);
      })
      .catch(() => {
        // fetchXlmUsdRate already falls back internally; keep the current rate.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return rate;
}
