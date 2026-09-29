import { useEffect, useState } from "react";

type BorrowerPosition = {
  id: string;
  status: "active" | "historical";
  amount: string;
  currency: string;
  created_at: string;
};

type UseBorrowerPositions = {
  borrower: string | null;
  positions: BorrowerPosition[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useBorrowerPositions({ walletAddress }: { walletAddress: string | null }): UseBorrowerPositions {
  const [positions, setPositions] = useState<BorrowerPosition[]>([]);
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
        const res = await fetch(`/api/lending/positions/${walletAddress}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPositions(data.positions || []);
      } catch (e: any) {
        setError(e.message || "Failed to fetch positions");
      } finally {
        setLoading(false);
      }
    }

    fetchPositions();
  }, [walletAddress]);

  return { borrower: walletAddress, positions, loading, error, refetch: () => {} }
}