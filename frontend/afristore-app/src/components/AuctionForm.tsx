// ─────────────────────────────────────────────────────────────
// components/AuctionForm.tsx — create auction form
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useCreateAuction } from "@/hooks/useAuctions";
import { useWalletContext } from "@/context/WalletContext";
import { Upload, CheckCircle, Loader2 } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import { DEFAULT_TOKEN } from "@/config/tokens";
import { useSupportedTokens } from "@/hooks/useSupportedTokens";
import { getDefaultSupportedToken } from "@/lib/token-support";
import { ART_CATEGORIES } from "./ListingForm";

interface AuctionFormProps {
  onSuccess?: (auctionId: number) => void;
  onCancel?: () => void;
}

export function AuctionForm({ onSuccess, onCancel }: AuctionFormProps) {
  const { publicKey } = useWalletContext();
  const { tokens: availableTokens } = useSupportedTokens();
  const { create, isCreating, progress, error } = useCreateAuction(publicKey);

  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [successId, setSuccessId] = useState<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    artistName: "",
    year: new Date().getFullYear().toString(),
    category: ART_CATEGORIES[0],
    reservePriceXlm: 1,
    durationHours: 24,
    tokenAddress: DEFAULT_TOKEN.address,
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const hasTokenOptions = availableTokens.length > 0;
  const defaultToken = getDefaultSupportedToken(availableTokens);
  const selectedToken =
    availableTokens.find((t) => t.address === form.tokenAddress) ??
    defaultToken;

  // When available tokens load, snap to a valid selection if needed
  useEffect(() => {
    if (availableTokens.length === 0) return;
    if (!availableTokens.some((t) => t.address === form.tokenAddress)) {
      setForm((cur) => ({
        ...cur,
        tokenAddress: getDefaultSupportedToken(availableTokens).address,
      }));
    }
  }, [availableTokens, form.tokenAddress]);

  const handleFile = (file: File) => {
    setSelectedFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    try {
      const id = await create({ ...form, imageFile: selectedFile });
      if (id !== null) {
        setSuccessId(id);
        onSuccess?.(id);
      }
    } catch (err) {
      console.error("Failed to create auction:", err);
    }
  };

  if (successId !== null) {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6 rounded-3xl border border-green-100 bg-white p-12 text-center shadow-2xl shadow-green-900/5">
        <div className="rounded-full bg-green-50 p-4">
          <CheckCircle size={56} className="text-green-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-3xl font-display font-bold text-gray-900">
            Auction #{successId} Created!
          </h3>
          <p className="text-gray-500 font-inter">
            Your auction is now live on the Afristore marketplace.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="w-full rounded-2xl border border-gray-200 bg-white px-6 py-4 text-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl shadow-2xl shadow-brand-900/5 border border-brand-100/50 p-6 md:p-10">
        <header className="mb-10 text-center">
          <h2 className="text-4xl font-display font-bold text-gray-900 mb-2">
            Create Auction
          </h2>
          <p className="text-gray-500 font-inter">
            Set a reserve price, duration, and payment token for your auction.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Image upload */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="group relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-brand-200 bg-brand-50/30 p-12 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/60 transition-all"
          >
            {preview ? (
              <div className="relative h-64 w-full">
                <Image
                  src={preview}
                  alt="Preview"
                  fill
                  className="object-contain rounded-2xl"
                  unoptimized
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl transition-opacity">
                  <p className="text-white text-base font-bold underline underline-offset-4">
                    Click to change
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Upload size={32} className="text-brand-500" />
                </div>
                <p className="text-lg font-semibold text-brand-950 font-display">
                  Select Artwork
                </p>
                <p className="mt-1 text-sm text-brand-400 font-inter">
                  PNG, JPG, GIF or WEBP — max 50 MB
                </p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {/* Fields */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Title *
              </label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                placeholder="e.g. Echoes of the Serengeti"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Description
              </label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                placeholder="Describe the soul of this artwork…"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Artist Name *
              </label>
              <input
                required
                value={form.artistName}
                onChange={(e) =>
                  setForm({ ...form, artistName: e.target.value })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                placeholder="Your name or alias"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Creation Year *
              </label>
              <input
                required
                type="number"
                min={1900}
                max={2100}
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Category *
              </label>
              <select
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              >
                {ART_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* ── Reserve price + token selector side-by-side ── */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Reserve Price ({selectedToken?.symbol ?? "Token"}) *
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min={0.0000001}
                  step="any"
                  value={form.reservePriceXlm}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      reservePriceXlm: parseFloat(e.target.value),
                    })
                  }
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 pr-16 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-600">
                  {selectedToken?.symbol ?? ""}
                </span>
              </div>
            </div>

            {/* Token address selector — the key addition for this issue */}
            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Payment Token *
              </label>
              <select
                required
                id="auction-token-address"
                disabled={!hasTokenOptions}
                value={form.tokenAddress}
                onChange={(e) =>
                  setForm({ ...form, tokenAddress: e.target.value })
                }
                className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              >
                {hasTokenOptions ? (
                  availableTokens.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.name} ({token.symbol})
                    </option>
                  ))
                ) : (
                  <option value="">No supported tokens available</option>
                )}
              </select>
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Duration (hours) *
              </label>
              <input
                required
                type="number"
                min={1}
                value={form.durationHours}
                onChange={(e) =>
                  setForm({ ...form, durationHours: parseInt(e.target.value) })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              />
            </div>
          </div>

          {/* Progress / error */}
          {isCreating && progress && (
            <div className="flex items-center gap-3 rounded-2xl bg-brand-50 px-6 py-4 text-sm font-semibold text-brand-700 animate-pulse">
              <Loader2 size={20} className="animate-spin" />
              {progress}
            </div>
          )}
          {error && (
            <p className="rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100">
              {error}
            </p>
          )}

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isCreating}
                className="flex-1 rounded-2xl border border-gray-200 py-4 text-lg font-semibold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <GuardButton
              type="submit"
              disabled={isCreating || !hasTokenOptions || !selectedFile}
              actionName="to create your auction"
              className="flex-[2] flex items-center justify-center gap-3 rounded-2xl bg-brand-500 py-5 text-xl font-bold text-white shadow-2xl shadow-brand-500/30 hover:bg-brand-600 hover:scale-[1.01] transition-all active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              {isCreating ? (
                <>
                  <Loader2 size={24} className="animate-spin" />
                  {progress || "Processing…"}
                </>
              ) : (
                "Create Auction"
              )}
            </GuardButton>
          </div>
        </form>
      </div>
    </div>
  );
}
