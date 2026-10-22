"use client";

import { useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { Wallet } from "lucide-react";
import {
  BorrowerDashboardTable,
  type BorrowerDebt,
} from "@/components/lending/BorrowerDashboardTable";
import {
  LenderDashboardTable,
  type LenderListingRow,
} from "@/components/lending/LenderDashboardTable";
import { useBorrowerPositions } from "@/hooks/useBorrowerPositions";
import { useLenderPositions } from "@/hooks/useLenderPositions";
import { calculateAccruedInterest, toBigInt } from "@/lib/lendingMath";
import type { IndexedLendingPosition } from "@/hooks/useLendingPositions";

function elapsedMonths(position: IndexedLendingPosition) {
  return Math.max(
    0,
    Math.floor((Date.now() / 1000 - Number(position.startTime)) / (30 * 86400)),
  );
}

function PositionError({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div role="alert">
      <p>{error}</p>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

function BorrowerView({ publicKey }: { publicKey: string }) {
  const { positions, loading, error, refetch } = useBorrowerPositions({
    walletAddress: publicKey,
  });
  const debts: BorrowerDebt[] = positions
    .filter((position) => position.status === "Active")
    .map((position) => ({
      positionId: Number(position.positionId),
      nftName: `NFT #${position.tokenId}`,
      nftContract: position.nftContract,
      tokenId: Number(position.tokenId),
      declaredPriceUsd: position.declaredPriceUsd,
      collateralCurrency: position.collateralCurrency,
      // Token amounts are not USD values. Use the indexer's oracle quote for health.
      collateralUsdValue: 0n,
      healthFactorBps:
        position.healthFactor == null
          ? null
          : BigInt(Math.floor(Number(position.healthFactor) * 10_000)),
      interestScheduleBps: position.interestScheduleBps,
      elapsedMonths: elapsedMonths(position),
      liquidationThresholdBps: position.liquidationThresholdBps,
    }));
  if (error) return <PositionError error={error} retry={refetch} />;
  return <BorrowerDashboardTable debts={debts} isLoading={loading} />;
}

function LenderView({ publicKey }: { publicKey: string }) {
  const { positions, loading, error, refetch } = useLenderPositions({
    walletAddress: publicKey,
  });
  const rows: LenderListingRow[] = positions
    .filter((position) => position.status === "Active")
    .map((position) => ({
      id: position.positionId,
      nftContract: position.nftContract,
      tokenId: BigInt(position.tokenId),
      principalUsd: toBigInt(position.declaredPriceUsd),
      earnedInterestUsd: calculateAccruedInterest(
        position.interestScheduleBps,
        elapsedMonths(position),
        position.declaredPriceUsd,
      ),
      currency: position.collateralCurrency,
      status: "Active Loan",
    }));
  if (error) return <PositionError error={error} retry={refetch} />;
  return <LenderDashboardTable rows={rows} isLoading={loading} />;
}

function DashboardViews({ publicKey }: { publicKey: string }) {
  const [view, setView] = useState<"borrower" | "lender">("borrower");
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Dashboard view" className="flex gap-3">
        {(["borrower", "lender"] as const).map((role) => (
          <button
            key={role}
            id={`lending-${role}-tab`}
            role="tab"
            type="button"
            aria-selected={view === role}
            aria-controls="lending-positions"
            tabIndex={view === role ? 0 : -1}
            onClick={() => setView(role)}
            onKeyDown={(event) => {
              let next: typeof view;
              if (event.key === "Home") next = "borrower";
              else if (event.key === "End") next = "lender";
              else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
                next = role === "borrower" ? "lender" : "borrower";
              else return;
              event.preventDefault();
              setView(next);
              document.getElementById(`lending-${next}-tab`)?.focus();
            }}
            className={`rounded-xl px-5 py-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 ${view === role ? "bg-brand-500 text-white" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
          >
            {role === "borrower" ? "Borrower" : "Lender"}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id="lending-positions"
        aria-labelledby={`lending-${view}-tab`}
      >
        {view === "borrower" ? (
          <BorrowerView publicKey={publicKey} />
        ) : (
          <LenderView publicKey={publicKey} />
        )}
      </section>
    </div>
  );
}

export default function LendingDashboardPage() {
  const { isConnected, connect, publicKey } = useWalletContext();
  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
          Lending & Borrowing Dashboard
        </h2>
        <p className="text-sm text-white/60 mt-1 max-w-2xl">
          Track active loans, positions, health factors, accrued interest, and
          collateral status in one place.
        </p>
      </div>
      {!isConnected || !publicKey ? (
        <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
          <Wallet size={32} className="mx-auto text-brand-400 mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
            Connect your wallet to inspect your active lending listings and open
            borrower positions.
          </p>
          <button
            onClick={() => connect()}
            className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-white hover:bg-brand-600"
          >
            Connect Wallet
          </button>
        </div>
      ) : (
        <DashboardViews key={publicKey} publicKey={publicKey} />
      )}
    </div>
  );
}
