"use client";

import { useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { useDeploySplitter } from "@/hooks/useSplitter";
import { SplitterRecipient } from "@/lib/splitter";
import { WalletGuard } from "@/components/WalletGuard";
import { RoyaltiesDistributor } from "@/components/RoyaltiesDistributor";
import {
  Plus,
  Trash2,
  Copy,
  Check,
  Wand2,
  Users,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";

interface Beneficiary {
  id: number;
  address: string;
  percentage: string;
}

function createEmptyBeneficiary(nextId: number): Beneficiary {
  return { id: nextId, address: "", percentage: "" };
}

function validatePercentages(
  beneficiaries: Beneficiary[],
): string | null {
  const filled = beneficiaries.filter(
    (b) => b.address.trim() !== "" || b.percentage.trim() !== "",
  );
  if (filled.length === 0) return "Add at least one beneficiary.";

  for (const b of filled) {
    if (!b.address.trim()) return "All beneficiaries must have an address.";
    const pct = parseFloat(b.percentage);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      return "Each percentage must be between 0 and 100.";
    }
  }

  const total = filled.reduce((sum, b) => sum + parseFloat(b.percentage || "0"), 0);
  const rounded = Math.round(total * 100) / 100;
  if (rounded !== 100) {
    return `Total percentages must equal exactly 100% (currently ${rounded}%).`;
  }

  return null;
}

export default function SplitterPage() {
  const { publicKey } = useWalletContext();
  const { deploy, isDeploying, error } = useDeploySplitter(publicKey);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([
    createEmptyBeneficiary(0),
  ]);
  const [nextId, setNextId] = useState(1);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const addBeneficiary = () => {
    setBeneficiaries((prev) => [...prev, createEmptyBeneficiary(nextId)]);
    setNextId((n) => n + 1);
    setValidationError(null);
  };

  const removeBeneficiary = (id: number) => {
    setBeneficiaries((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((b) => b.id !== id);
    });
    setValidationError(null);
  };

  const updateBeneficiary = (
    id: number,
    field: "address" | "percentage",
    value: string,
  ) => {
    setBeneficiaries((prev) =>
      prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)),
    );
    setValidationError(null);
  };

  const handleSubmit = async () => {
    const err = validatePercentages(beneficiaries);
    if (err) {
      setValidationError(err);
      return;
    }

    setValidationError(null);

    const recipients: SplitterRecipient[] = beneficiaries
      .filter((b) => b.address.trim() !== "" || b.percentage.trim() !== "")
      .map((b) => ({
        address: b.address.trim(),
        percentage: parseInt(b.percentage.trim(), 10),
      }));

    const address = await deploy(recipients);
    if (address) {
      setDeployedAddress(address);
    }
  };

  const total = beneficiaries
    .filter((b) => b.address.trim() || b.percentage.trim())
    .reduce((sum, b) => sum + (parseFloat(b.percentage) || 0), 0);

  const copyAddress = async () => {
    if (!deployedAddress) return;
    await navigator.clipboard.writeText(deployedAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setBeneficiaries([createEmptyBeneficiary(0)]);
    setNextId(1);
    setDeployedAddress(null);
    setValidationError(null);
  };

  return (
    <div className="min-h-screen bg-midnight-950 pb-20 pt-24 selection:bg-brand-500 selection:text-white">
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 overflow-hidden">
        <div className="absolute inset-0 tribal-pattern scale-150 rotate-12" />
      </div>

      <WalletGuard actionName="To create a royalty splitter">
        <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-white/50 hover:text-brand-400 transition-colors text-sm mb-6"
          >
            <ArrowLeft size={16} />
            Back to Dashboard
          </Link>

          {/* My Royalties Section - Distribute from Existing Splitter */}
          <div className="relative mb-12 animate-fade-in">
            <RoyaltiesDistributor userPublicKey={publicKey} />
          </div>

          <div className="relative mb-10 overflow-hidden rounded-[3rem] bg-midnight-900 border border-white/5 shadow-2xl p-8 sm:p-12">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-500/10 blur-[100px]" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-mint-500/10 blur-[100px]" />
            <div className="absolute top-0 right-0 left-0 tribal-strip h-1.5 opacity-40" />

            <div className="relative flex flex-col items-center text-center gap-4">
              <div className="relative group">
                <div className="absolute -inset-1.5 rounded-[2.5rem] bg-gradient-to-tr from-brand-500 via-terracotta-400 to-mint-500 opacity-80 blur transition duration-700 group-hover:opacity-100" />
                <div className="relative flex h-20 w-20 items-center justify-center rounded-[2.2rem] bg-midnight-950 border border-white/10 shadow-2xl">
                  <Wand2 size={36} className="text-brand-400" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-display font-black text-white">
                  Create Royalty Splitter
                </h1>
                <p className="mt-2 text-white/50 text-sm max-w-md">
                  Deploy a smart contract to automatically split royalties among
                  galleries, co-creators, and collaborators.
                </p>
              </div>
            </div>
          </div>

          {deployedAddress ? (
            <div className="animate-fade-in">
              <div className="rounded-[2rem] bg-midnight-900 border border-mint-500/20 shadow-xl p-8 text-center">
                <div className="flex items-center justify-center h-16 w-16 mx-auto rounded-2xl bg-mint-500/10 text-mint-400">
                  <Check size={32} />
                </div>
                <h2 className="mt-6 text-2xl font-display font-bold text-white">
                  Splitter Deployed
                </h2>
                <p className="mt-2 text-white/50 text-sm">
                  Your Royalty Splitter contract is live on-chain.
                </p>
                <div className="mt-6 flex items-center gap-3 p-4 rounded-xl bg-midnight-950 border border-white/10">
                  <code className="flex-1 text-sm font-mono text-mint-400 break-all text-left">
                    {deployedAddress}
                  </code>
                  <button
                    onClick={copyAddress}
                    className="shrink-0 p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    title="Copy contract address"
                  >
                    {copied ? (
                      <Check size={16} className="text-mint-400" />
                    ) : (
                      <Copy size={16} />
                    )}
                  </button>
                </div>
                <button
                  onClick={resetForm}
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3.5 text-base font-bold text-white shadow-xl shadow-brand-500/30 hover:bg-brand-600 transition-all"
                >
                  <Plus size={18} />
                  Create Another
                </button>
              </div>
            </div>
          ) : (
            <div className="animate-fade-in space-y-6">
              <div className="rounded-[2rem] bg-midnight-900 border border-white/5 shadow-xl p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-brand-500/10 text-brand-400">
                      <Users size={20} />
                    </div>
                    <div>
                      <h2 className="font-display font-bold text-white text-lg">
                        Beneficiaries
                      </h2>
                      <p className="text-white/40 text-xs">
                        Add addresses and percentages — must total 100%
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={addBeneficiary}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 text-sm font-bold transition-colors"
                  >
                    <Plus size={16} />
                    Add
                  </button>
                </div>

                <div className="space-y-4">
                  {beneficiaries.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-xl bg-midnight-950 border border-white/5"
                    >
                      <div className="flex-1 w-full sm:w-auto">
                        <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-1.5">
                          Address
                        </label>
                        <input
                          type="text"
                          value={b.address}
                          onChange={(e) =>
                            updateBeneficiary(b.id, "address", e.target.value)
                          }
                          placeholder="GABC…"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 transition-colors"
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-xs font-bold text-white/40 uppercase tracking-widest mb-1.5">
                          %
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            value={b.percentage}
                            onChange={(e) =>
                              updateBeneficiary(
                                b.id,
                                "percentage",
                                e.target.value,
                              )
                            }
                            min="0"
                            max="100"
                            step="1"
                            placeholder="0"
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-sm font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400/30 transition-colors pr-8"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 text-sm font-bold">
                            %
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => removeBeneficiary(b.id)}
                        disabled={beneficiaries.length <= 1}
                        className="shrink-0 p-2.5 rounded-lg text-white/30 hover:text-terracotta-400 hover:bg-terracotta-500/10 transition-colors disabled:opacity-20 disabled:cursor-not-allowed mt-5 sm:mt-0"
                        title="Remove beneficiary"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between p-4 rounded-xl bg-midnight-950 border border-white/5">
                  <span className="text-sm font-bold text-white/50">
                    Total
                  </span>
                  <span
                    className={clsx(
                      "text-lg font-display font-black",
                      total === 100
                        ? "text-mint-400"
                        : total > 100
                          ? "text-terracotta-400"
                          : "text-white/40",
                    )}
                  >
                    {total.toFixed(0)}%
                  </span>
                </div>
              </div>

              {(validationError || error) && (
                <div className="p-4 rounded-xl bg-terracotta-500/10 border border-terracotta-500/20 text-sm font-bold text-terracotta-400">
                  {validationError || error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={isDeploying}
                className="w-full flex items-center justify-center gap-3 rounded-2xl bg-brand-500 py-5 text-lg font-display font-black text-white shadow-2xl shadow-brand-500/30 hover:bg-brand-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {isDeploying ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Deploying…
                  </>
                ) : (
                  <>
                    <Wand2 size={20} />
                    Deploy Royalty Splitter
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </WalletGuard>
    </div>
  );
}
