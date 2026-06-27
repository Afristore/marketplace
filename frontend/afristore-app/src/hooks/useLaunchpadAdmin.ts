// ─────────────────────────────────────────────────────────────
// hooks/useLaunchpadAdmin.ts — Launchpad admin hooks
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getLaunchpadAdmin,
  transferLaunchpadAdmin,
  updatePlatformFee,
  getPlatformFee,
  getCollectionCount,
} from "@/lib/launchpad";

export interface LaunchpadStats {
  totalCollections: number;
  platformFeeBps: number;
  platformFeeReceiver: string;
}

export function useLaunchpadAdminCheck(currentPublicKey: string | null) {
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
        const adminAddr = await getLaunchpadAdmin();
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

export function useLaunchpadAdminStats() {
  const [stats, setStats] = useState<LaunchpadStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [collectionCount, platformFee] = await Promise.all([
        getCollectionCount(),
        getPlatformFee(),
      ]);

      setStats({
        totalCollections: collectionCount,
        platformFeeBps: platformFee.bps,
        platformFeeReceiver: platformFee.receiver,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load launchpad stats",
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

export function useLaunchpadAdminActions(adminPublicKey: string | null) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transferAdmin = async (newAdminAddress: string) => {
    if (!adminPublicKey) return false;
    setIsProcessing(true);
    setError(null);
    try {
      await transferLaunchpadAdmin(adminPublicKey, newAdminAddress);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transfer admin failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const updateFee = async (receiverAddress: string, feeBps: number) => {
    if (!adminPublicKey) return false;
    setIsProcessing(true);
    setError(null);
    try {
      await updatePlatformFee(adminPublicKey, receiverAddress, feeBps);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Update fee failed");
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return { transferAdmin, updateFee, isProcessing, error };
}
