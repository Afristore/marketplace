"use client";

import { useEffect, useState } from "react";
import {
  useDeployCollection,
  DeployCollectionInput,
} from "@/hooks/useLaunchpad";
import { useWalletContext } from "@/context/WalletContext";
import { Loader2, Rocket, CheckCircle, ArrowRight, Info, ChevronDown } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import { CollectionKind } from "@/lib/launchpad";
import { useSupportedTokens } from "@/hooks/useSupportedTokens";
import { getDefaultSupportedToken } from "@/lib/token-support";

const SPLITTER_TOOLTIP =
  "If you want to split royalties with multiple people, paste your deployed Royalty Splitter contract address here, or deploy one first via Launchpad → Royalty Splitter.";

function SplitterTooltip() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="Royalty splitter info"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="ml-1.5 text-gray-400 hover:text-brand-500 transition-colors focus:outline-none"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-6 top-0 z-50 w-72 rounded-2xl bg-gray-900 px-4 py-3 text-xs text-white shadow-xl font-inter leading-relaxed"
        >
          {SPLITTER_TOOLTIP}
        </span>
      )}
    </span>
  );
}

function isStellarAddress(v: string) {
  return (v.startsWith("G") || v.startsWith("C")) && v.length >= 50;
}

export function CollectionForm() {
  const { publicKey } = useWalletContext();
  const { deploy, isDeploying, error } = useDeployCollection(publicKey);
  const { tokens: supportedTokens } = useSupportedTokens();
  const hasSupportedTokens = supportedTokens.length > 0;

  const [successAddress, setSuccessAddress] = useState<string | null>(null);

  // Splitter addresses the user has deployed (persisted in localStorage under their pubkey)
  const [savedSplitters, setSavedSplitters] = useState<string[]>([]);
  const [showSplitterPicker, setShowSplitterPicker] = useState(false);

  const [form, setForm] = useState({
    name: "",
    symbol: "",
    kind: "Normal721" as CollectionKind,
    maxSupply: 10000,
    royaltyBps: 500, // 5%
    royaltyReceiver: publicKey || "",
    currencyAddress: "",
  });

  useEffect(() => {
    if (supportedTokens.length === 0) {
      return;
    }

    if (
      !supportedTokens.some((token) => token.address === form.currencyAddress)
    ) {
      setForm((current) => ({
        ...current,
        currencyAddress: getDefaultSupportedToken(supportedTokens).address,
      }));
    }
  }, [form.currencyAddress, supportedTokens]);

  // Load saved splitter addresses from localStorage when the wallet connects
  useEffect(() => {
    if (!publicKey) return;
    try {
      const raw = localStorage.getItem(`splitters:${publicKey}`);
      setSavedSplitters(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setSavedSplitters([]);
    }
  }, [publicKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey) return;

    const input: DeployCollectionInput = {
      ...form,
      royaltyReceiver: form.royaltyReceiver || publicKey,
    };

    // If it's a lazy collection, we need the pubkey bytes
    if (form.kind.startsWith("LazyMint")) {
      try {
        // Dynamically import StrKey to avoid Node deps in initial bundle
        const sdk = await import("@stellar/stellar-sdk");
        const decoded = sdk.StrKey.decodeEd25519PublicKey(publicKey);
        input.creatorPubkeyBytes = Buffer.from(decoded);
      } catch (err) {
        console.error("Failed to decode public key", err);
        return;
      }
    }

    const addr = await deploy(input);
    if (addr) {
      setSuccessAddress(addr);
    }
  };

  if (successAddress) {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6 rounded-3xl border border-green-100 bg-white p-12 text-center shadow-2xl shadow-green-900/5">
        <div className="rounded-full bg-green-50 p-4">
          <CheckCircle size={56} className="text-green-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-3xl font-display font-bold text-gray-900">
            Collection Deployed!
          </h3>
          <p className="text-gray-500 font-inter">
            Your collection has been successfully created on the Stellar
            network.
          </p>
          <div className="mt-4 p-4 bg-gray-50 rounded-2xl break-all font-mono text-sm text-gray-600 border border-gray-100">
            {successAddress}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full mt-4">
          <a
            href={`/launchpad/collections/${successAddress}`}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 text-lg font-bold text-white hover:bg-brand-600 shadow-lg shadow-brand-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            View Collection <ArrowRight size={20} />
          </a>
        </div>
      </div>
    );
  }

  const is721 = form.kind.includes("721");
  const royaltyAddressValid =
    !form.royaltyReceiver || isStellarAddress(form.royaltyReceiver);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl shadow-2xl shadow-brand-900/5 border border-brand-100/50 p-6 md:p-10">
        <header className="mb-10 text-center">
          <h2 className="text-4xl font-display font-bold text-gray-900 mb-2">
            Launch Your Collection
          </h2>
          <p className="text-gray-500 font-inter">
            Create a permanent home for your digital creations on the
            blockchain.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Collection Type *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  {
                    id: "Normal721",
                    label: "Standard 721",
                    desc: "Classic one-of-a-kind NFTs",
                  },
                  {
                    id: "Normal1155",
                    label: "Standard 1155",
                    desc: "Multi-edition fungible tokens",
                  },
                  {
                    id: "LazyMint721",
                    label: "Lazy 721",
                    desc: "Mint only when sold (Gasless)",
                  },
                  {
                    id: "LazyMint1155",
                    label: "Lazy 1155",
                    desc: "Multi-edition lazy minting",
                  },
                ].map((type) => (
                  <label
                    key={type.id}
                    className={`flex flex-col p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                      form.kind === type.id
                        ? "border-brand-500 bg-brand-50/50"
                        : "border-gray-100 bg-gray-50/30 hover:border-brand-200"
                    }`}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={type.id}
                      checked={form.kind === type.id}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          kind: e.target.value as CollectionKind,
                        })
                      }
                      className="sr-only"
                    />
                    <span className="font-bold text-gray-900">
                      {type.label}
                    </span>
                    <span className="text-xs text-gray-500 mt-1">
                      {type.desc}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Collection Name *
              </label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                placeholder="e.g. African Legends"
              />
            </div>

            {is721 && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                    Symbol *
                  </label>
                  <input
                    required
                    value={form.symbol}
                    onChange={(e) =>
                      setForm({ ...form, symbol: e.target.value.toUpperCase() })
                    }
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                    placeholder="e.g. AFRL"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                    Max Supply *
                  </label>
                  <input
                    required
                    type="number"
                    min={1}
                    value={form.maxSupply}
                    onChange={(e) =>
                      setForm({ ...form, maxSupply: parseInt(e.target.value) })
                    }
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Royalty (BPS) *
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min={0}
                  max={10000}
                  value={form.royaltyBps}
                  onChange={(e) =>
                    setForm({ ...form, royaltyBps: parseInt(e.target.value) })
                  }
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 pr-16 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-600">
                  {((form.royaltyBps / 10000) * 100).toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Fee Payment Token *
              </label>
              <select
                required
                disabled={!hasSupportedTokens}
                value={form.currencyAddress}
                onChange={(e) =>
                  setForm({ ...form, currencyAddress: e.target.value })
                }
                className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              >
                {hasSupportedTokens ? (
                  supportedTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.name} ({token.symbol})
                    </option>
                  ))
                ) : (
                  <option value="">No supported tokens available</option>
                )}
              </select>
            </div>

            {/* ── Royalty Receiver Address ─────────────────────────── */}
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <label className="flex items-center text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                  Royalty Receiver Address
                  <SplitterTooltip />
                </label>

                {/* "Use my Splitter" picker — shown when saved splitters exist */}
                {savedSplitters.length > 0 && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSplitterPicker((o) => !o)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 border border-brand-200 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100 transition-colors"
                    >
                      Select my Splitter
                      <ChevronDown size={12} />
                    </button>
                    {showSplitterPicker && (
                      <div className="absolute right-0 top-8 z-40 w-80 rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
                        <p className="px-4 pt-3 pb-1 text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Your deployed splitters
                        </p>
                        {savedSplitters.map((addr) => (
                          <button
                            key={addr}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, royaltyReceiver: addr });
                              setShowSplitterPicker(false);
                            }}
                            className="w-full text-left px-4 py-3 font-mono text-xs text-gray-700 hover:bg-brand-50 truncate border-t border-gray-100 first:border-0"
                          >
                            {addr}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <input
                value={form.royaltyReceiver}
                onChange={(e) =>
                  setForm({ ...form, royaltyReceiver: e.target.value })
                }
                className={`w-full rounded-2xl border bg-gray-50/50 px-5 py-4 text-base focus:bg-white focus:outline-none transition-all shadow-sm font-inter font-mono text-sm ${
                  form.royaltyReceiver && !royaltyAddressValid
                    ? "border-red-400 focus:border-red-500"
                    : "border-gray-200 focus:border-brand-500"
                }`}
                placeholder={publicKey || "G… wallet or C… contract address (defaults to creator)"}
                aria-describedby="royalty-receiver-hint"
              />
              <p id="royalty-receiver-hint" className="text-xs text-gray-400 font-inter">
                Accepts any Stellar address: a regular wallet (G…) or a Royalty Splitter contract (C…).
              </p>
              {form.royaltyReceiver && !royaltyAddressValid && (
                <p className="text-xs text-red-500 font-inter">
                  Must be a valid Stellar address starting with G or C.
                </p>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100">
              {error}
            </p>
          )}

          <GuardButton
            type="submit"
            disabled={isDeploying}
            actionName="to deploy your collection"
            className="w-full flex items-center justify-center gap-3 rounded-2xl bg-brand-500 py-5 text-xl font-bold text-white shadow-2xl shadow-brand-500/30 hover:bg-brand-600 hover:scale-[1.01] transition-all active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
          >
            {isDeploying ? (
              <>
                <Loader2 size={24} className="animate-spin" />
                Deploying to Stellar…
              </>
            ) : (
              <>
                <Rocket size={24} />
                Deploy Collection
              </>
            )}
          </GuardButton>
        </form>
      </div>
    </div>
  );
}
