// ─────────────────────────────────────────────────────────────
// hooks/useAdmin.ts — Administrative hooks for stats + moderation
// Error handling: async failures are caught and surfaced via `error` state.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getTotalListings,
  getAllListings,
  getTreasury,
  getProtocolFee,
  getAdmin,
  revokeArtist,
  reinstateArtist,
  isArtistRevoked,
  addTokenToWhitelist,
  removeTokenFromWhitelist,
  getTokenWhitelist,
} from "@/lib/contract";
import { Horizon } from "@stellar/stellar-sdk";
import { config } from "@/lib/config";

export interface AdminStats {
  totalListings: number;
  totalUsers: number;
  protocolFeeBps: number;
  treasuryAddress: string | null;
  treasuryBalances: any[];
}

export function useAdminStats() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const totalListings = await getTotalListings();
      const allListings = await getAllListings();

      // Calculate unique users (artists)
      const uniqueArtists = new Set(allListings.map((l) => l.artist));
      const totalUsers = uniqueArtists.size;

      const protocolFeeBps = await getProtocolFee();
      const treasuryAddress = await getTreasury();

      let treasuryBalances: any[] = [];
      let treasuryError: string | null = null;
      if (treasuryAddress) {
        try {
          const horizon = new Horizon.Server(config.horizonUrl);
          const account = await horizon.loadAccount(treasuryAddress);
          treasuryBalances = account.balances;
        } catch (err: unknown) {
          treasuryError =
            err instanceof Error
              ? `Treasury balances unavailable: ${err.message}`
              : "Treasury balances unavailable";
        }
      }

      setStats({
        totalListings,
        totalUsers,
        protocolFeeBps,
        treasuryAddress,
        treasuryBalances,
      });
      if (treasuryError) setError(treasuryError);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load admin stats",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, isLoading, error, refresh };
}

export function useModeration(adminPublicKey: string | null) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (artistAddress: string) => {
    if (!adminPublicKey) return;
    setIsProcessing(true);
    setError(null);
    try {
      await revokeArtist(adminPublicKey, artistAddress);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Revoke failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const reinstate = async (artistAddress: string) => {
    if (!adminPublicKey) return;
    setIsProcessing(true);
    setError(null);
    try {
      await reinstateArtist(adminPublicKey, artistAddress);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reinstate failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const checkStatus = async (artistAddress: string) => {
    try {
      return await isArtistRevoked(artistAddress);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Status check failed");
      return false;
    }
  };

  return { revoke, reinstate, checkStatus, isProcessing, error };
}

export function useTokenManagement(adminPublicKey: string | null) {
  const [whitelistedTokens, setWhitelistedTokens] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const tokens = await getTokenWhitelist();
      setWhitelistedTokens(tokens);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load whitelist");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const whitelist = async (tokenAddress: string) => {
    if (!adminPublicKey) return;
    setIsProcessing(true);
    setError(null);

    // Optimistic update
    const prev = [...whitelistedTokens];
    setWhitelistedTokens((curr) => [...curr, tokenAddress]);

    try {
      await addTokenToWhitelist(adminPublicKey, tokenAddress);
      return true;
    } catch (err: unknown) {
      setWhitelistedTokens(prev); // Rollback
      setError(err instanceof Error ? err.message : "Whitelist failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const unwhitelist = async (tokenAddress: string) => {
    if (!adminPublicKey) return;
    setIsProcessing(true);
    setError(null);

    // Optimistic update
    const prev = [...whitelistedTokens];
    setWhitelistedTokens((curr) => curr.filter((t) => t !== tokenAddress));

    try {
      await removeTokenFromWhitelist(adminPublicKey, tokenAddress);
      return true;
    } catch (err: unknown) {
      setWhitelistedTokens(prev); // Rollback
      setError(err instanceof Error ? err.message : "Unwhitelist failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    whitelistedTokens,
    whitelist,
    unwhitelist,
    isLoading,
    isProcessing,
    error,
    refresh,
  };
}

export function useAdminCheck(currentPublicKey: string | null) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const check = async () => {
      if (!currentPublicKey) {
        setIsAdmin(false);
        setIsLoading(false);
        return;
      }
      try {
        const adminAddr = await getAdmin();
        setIsAdmin(adminAddr === currentPublicKey);
      } catch {
        setIsAdmin(false);
      } finally {
        setIsLoading(false);
      }
    };
    check();
  }, [currentPublicKey]);

  return { isAdmin, isLoading };
}
