import { useEffect, useState } from "react";

type LenderPosition = {
  id: string;
  status: "active" | "historical";
  amount: string;
  currency: string;
  created_at: string;
};

type UseLenderPositions = {
  lender: string | null;
  positions: LenderPosition[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useLenderPositions({ walletAddress }: { walletAddress: string | null }): UseLenderPositions {
  const [positions, setPositions] = useState<LenderPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setPositions([]);
      setLoading(false);
      return;
    }

    async function fetchPositions() {
      setLoading(true);
      try {
        const res = await fetch(`/api/lending/positions/lender/${walletAddress}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPositions(data.positions || []);
      } catch (e: any) {
        setError(e.message || "Failed to fetch lender positions");
      } finally {
        setLoading(false);
      }
    }

    fetchPositions();
  }, [walletAddress]);

  return { lender: walletAddress, positions, loading, error, refetch: () => {} }
}