"use client";

import { useState, useEffect, useCallback } from "react";
import { getWalletActivity, getRoyaltyStats, ActivityEvent } from "@/lib/indexer";

export function useUserActivity(publicKey: string | null) {
    const [activities, setActivities] = useState<ActivityEvent[]>([]);
    const [royaltyStats, setRoyaltyStats] = useState<{
        totalEarned: string;
        payoutCount: number;
        lastPayout: number;
    } | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!publicKey) return;
        setIsLoading(true);
        setError(null);
        try {
            const [history, stats] = await Promise.all([
                getWalletActivity(publicKey),
                getRoyaltyStats(publicKey)
            ]);
            setActivities(history);
            setRoyaltyStats(stats);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load activity");
        } finally {
            setIsLoading(false);
        }
    }, [publicKey]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { activities, royaltyStats, isLoading, error, refresh };
}

export function useListingActivity(listingId: number | null) {
    const [activities, setActivities] = useState<ActivityEvent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (listingId === null) return;
        setIsLoading(true);
        setError(null);
        try {
            const history = await import("@/lib/indexer").then(m => m.getListingActivity(listingId));
            setActivities(history);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Failed to load listing activity");
        } finally {
            setIsLoading(false);
        }
    }, [listingId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { activities, isLoading, error, refresh };
}
