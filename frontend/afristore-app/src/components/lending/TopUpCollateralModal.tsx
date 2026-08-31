"use client";

import { useState, useMemo } from "react";
import { X, Loader2, Plus, ArrowRight } from "lucide-react";
import { useAddCollateral } from "@/hooks/mutations/useAddCollateral";
import { BorrowerDebt } from "./BorrowerDashboardTable";
import { calculateHealthFactor, calculateAccruedInterest, toBigInt, MAX_HEALTH_FACTOR_BPS } from "@/lib/lendingMath";

interface TopUpCollateralModalProps {
  isOpen: boolean;
  onClose: () => void;
  debt: BorrowerDebt | null;
  borrowerPublicKey: string | null;
}

function formatHealthFactor(hf: bigint): string {
  if (hf >= MAX_HEALTH_FACTOR_BPS) return "\u2014"; 
  const whole = hf / 100n;
  const frac = (hf % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

export function TopUpCollateralModal({
  isOpen,
  onClose,
  debt,
  borrowerPublicKey,
}: TopUpCollateralModalProps) {
  const { addCollateral, isAddingCollateral, error } = useAddCollateral(borrowerPublicKey);
  const [amount, setAmount] = useState("");
  
  const currentDebtUsd = useMemo(() => {
    if (!debt) return 0n;
    const principal = toBigInt(debt.declaredPriceUsd);
    const accrued = calculateAccruedInterest(
      debt.interestScheduleBps,
      debt.elapsedMonths,
      principal
    );
    return principal + accrued;
  }, [debt]);

  const currentHealthFactor = useMemo(() => {
    if (!debt) return 0n;
    return calculateHealthFactor(debt.collateralUsdValue, currentDebtUsd);
  }, [debt, currentDebtUsd]);

  const newHealthFactor = useMemo(() => {
    if (!debt || !amount || isNaN(Number(amount))) return currentHealthFactor;
    try {
      const addedAmount = BigInt(Math.floor(Number(amount) * 10_000_000));
      const newCollateral = toBigInt(debt.collateralUsdValue) + addedAmount;
      return calculateHealthFactor(newCollateral, currentDebtUsd);
    } catch {
      return currentHealthFactor;
    }
  }, [debt, amount, currentDebtUsd, currentHealthFactor]);

  if (!isOpen || !debt) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(Number(amount))) return;
    
    // convert amount to the 7-decimal fixed-point expected by the contract
    const addedAmount = BigInt(Math.floor(Number(amount) * 10_000_000));
    
    const success = await addCollateral({
      positionId: debt.positionId,
      amount: addedAmount,
      collateralCurrency: debt.collateralCurrency,
      borrowerPublicKey: borrowerPublicKey || undefined,
    });
    
    if (success) {
      setAmount("");
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-scale-in">
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="font-display text-xl font-bold text-gray-900">
            Top Up Collateral
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {error}
              </div>
            )}
            
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-700">
                Amount to Add (USD)
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Plus size={16} className="text-gray-400" />
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-100 p-3 pl-10 text-gray-900 outline-none transition focus:border-brand-500"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            
            <div className="rounded-2xl bg-gray-50 p-4">
              <h3 className="mb-3 text-sm font-bold text-gray-500 uppercase tracking-wider">
                Health Factor Preview
              </h3>
              <div className="flex items-center justify-between">
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">Current</p>
                  <p className="font-mono text-lg font-bold text-gray-700">
                    {formatHealthFactor(currentHealthFactor)}
                  </p>
                </div>
                <ArrowRight className="text-gray-300" />
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-1">New</p>
                  <p className="font-mono text-lg font-bold text-brand-500">
                    {formatHealthFactor(newHealthFactor)}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isAddingCollateral || !amount}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-mint-500 py-4 font-bold text-white shadow-lg shadow-mint-500/20 hover:bg-mint-600 transition-all disabled:opacity-50"
            >
              {isAddingCollateral ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> Processing...
                </>
              ) : (
                "Add Collateral"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
