import { useEffect, useState, useCallback } from "react";

export type BorrowerPosition = {
  id: string;
  status?: "active" | "historical";
  amount: string;
  currency?: string;
  borrower?: string;
  created_at?: string;
  createdAt?: string;
};

export type UseBorrowerPositions = {
  borrower: string | null;
  positions: BorrowerPosition[];
  data: BorrowerPosition[] | undefined;
  loading: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

export interface UseBorrowerPositionsOptions {
  page?: number;
  limit?: number;
}

export function useBorrowerPositions(
  walletAddressOrParams: { walletAddress: string | null } | string | null,
  options?: UseBorrowerPositionsOptions
): UseBorrowerPositions {
  const walletAddress =
    typeof walletAddressOrParams === "object" && walletAddressOrParams !== null
      ? walletAddressOrParams.walletAddress
      : walletAddressOrParams;

  const [positions, setPositions] = useState<BorrowerPosition[]>([]);
  const [data, setData] = useState<BorrowerPosition[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const refetch = useCallback(() => {
    setReloadTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setPositions([]);
      setData([]);
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function fetchPositions() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = new URLSearchParams();
        if (options?.page) queryParams.set("page", String(options.page));
        if (options?.limit) queryParams.set("limit", String(options.limit));
        const queryString = queryParams.toString() ? `?${queryParams.toString()}` : "";

        const res = await fetch(`/api/lending/positions/${walletAddress}${queryString}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json) ? json : json.positions || [];
        if (isMounted) {
          setPositions(list);
          setData(list);
        }
      } catch (e: any) {
        if (isMounted) {
          setError(e.message || "Failed to fetch positions");
          setData(undefined);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchPositions();

    return () => {
      isMounted = false;
    };
  }, [walletAddress, options?.page, options?.limit, reloadTrigger]);

  return {
    borrower: walletAddress,
    positions,
    data,
    loading,
    isLoading: loading,
    error,
    refetch,
  };
}
