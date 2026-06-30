// ─────────────────────────────────────────────────────────────
// components/ListingForm.tsx — create and edit listing form
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useCreateListing, useUpdateListing } from "@/hooks/useMarketplace";
import { useWalletContext } from "@/context/WalletContext";
import { Upload, CheckCircle, Loader2, Save } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import { ArtworkMetadata, fetchMetadata, cidToGatewayUrl } from "@/lib/ipfs";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { DEFAULT_TOKEN } from "@/config/tokens";
import { useSupportedTokens } from "@/hooks/useSupportedTokens";
import {
  ensureTokenOption,
  getDefaultSupportedToken,
} from "@/lib/token-support";
import posthog from "posthog-js";

export const ART_CATEGORIES = [
  "Painting",
  "Sculpture",
  "Photography",
  "Digital Art",
  "Textile",
  "Jewelry",
  "Other",
];

interface ListingFormProps {
  listing?: Listing; // If provided, we are in EDIT mode
  prefilledCollectionAddress?: string;
  prefilledTokenId?: number;
  onSuccess?: (listingId: number) => void;
  onCancel?: () => void;
}

export function ListingForm({
  listing,
  prefilledCollectionAddress,
  prefilledTokenId,
  onSuccess,
  onCancel,
}: ListingFormProps) {
  const isEdit = !!listing;
  const { publicKey } = useWalletContext();
  const { tokens: availableTokens } = useSupportedTokens();

  const {
    create,
    isCreating,
    progress: createProgress,
    error: createError,
  } = useCreateListing(publicKey);
  const {
    update,
    isUpdating,
    progress: updateProgress,
    error: updateError,
  } = useUpdateListing(publicKey);

  const [form, setForm] = useState({
    collectionAddress: prefilledCollectionAddress || "",
    nftTokenId: prefilledTokenId !== undefined ? prefilledTokenId : 0,
    price: 10,
    amount: 1,
    tokenAddress: DEFAULT_TOKEN.address,
  });
  const [successId, setSuccessId] = useState<number | null>(null);
  const [currentMetadata, setCurrentMetadata] =
    useState<ArtworkMetadata | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const tokenOptions = listing
    ? ensureTokenOption(availableTokens, form.tokenAddress)
    : availableTokens;
  const hasTokenOptions = tokenOptions.length > 0;
  const defaultToken = getDefaultSupportedToken(tokenOptions);
  const selectedToken =
    tokenOptions.find((token) => token.address === form.tokenAddress) ||
    defaultToken;

  // Load existing data if in edit mode
  useEffect(() => {
    if (listing) {
      setIsFetchingMetadata(true);
      fetchMetadata(listing.metadata_cid)
        .then((meta) => {
          setCurrentMetadata(meta);
          setForm({
            collectionAddress: listing.collection,
            nftTokenId: Number(listing.token_id),
            price: parseFloat(stroopsToXlm(listing.price)),
            amount: 1,
            tokenAddress: listing.token,
          });
        })
        .finally(() => setIsFetchingMetadata(false));
    }
  }, [listing]);

  useEffect(() => {
    if (isEdit || tokenOptions.length === 0) {
      return;
    }

    if (!tokenOptions.some((token) => token.address === form.tokenAddress)) {
      setForm((current) => ({
        ...current,
        tokenAddress: getDefaultSupportedToken(tokenOptions).address,
      }));
    }
  }, [form.tokenAddress, isEdit, tokenOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEdit && listing && currentMetadata) {
      const success = await update({
        listingId: listing.listing_id,
        originalTokenAddress: listing.token,
        ...form,
        title: "",
        description: "",
        artistName: "",
        year: "",
        category: "",
        currentMetadata,
      });
      if (success) {
        setSuccessId(listing.listing_id);
        onSuccess?.(listing.listing_id);
      }
    } else if (!isEdit) {
      const id = await create({ ...form });
      if (id !== null) {
        setSuccessId(id);
        posthog.capture("Listing Created", {
          listing_id: id,
          price_xlm: form.price,
        });
        onSuccess?.(id);
      }
    }
  };

  const isLoading = isCreating || isUpdating || isFetchingMetadata;
  const progress = isEdit ? updateProgress : createProgress;
  const error = isEdit ? updateError : createError;

  if (successId !== null) {
    return (
      <div className="max-w-xl mx-auto flex flex-col items-center gap-6 rounded-3xl border border-green-100 bg-white p-12 text-center shadow-2xl shadow-green-900/5">
        <div className="rounded-full bg-green-50 p-4">
          <CheckCircle size={56} className="text-green-500" />
        </div>
        <div className="space-y-2">
          <h3 className="text-3xl font-display font-bold text-gray-900">
            Listing #{successId} {isEdit ? "Updated" : "Created"}!
          </h3>
          <p className="text-gray-500 font-inter">
            Your artwork is now live and available for purchase on the Afristore
            marketplace.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full mt-4">
          {!isEdit && (
            <button
              onClick={() => {
                setSuccessId(null);
                setForm({
                  collectionAddress: "",
                  nftTokenId: 0,
                  price: 10,
                  amount: 1,
                  tokenAddress: defaultToken.address,
                });
              }}
              className="flex-1 rounded-2xl bg-brand-500 px-6 py-4 text-lg font-bold text-white hover:bg-brand-600 shadow-lg shadow-brand-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              List Another
            </button>
          )}
          <button
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-gray-200 bg-white px-6 py-4 text-lg font-semibold text-gray-700 hover:bg-gray-50 transition-all"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-white rounded-3xl shadow-2xl shadow-brand-900/5 border border-brand-100/50 p-6 md:p-10">
        <header className="mb-10 text-center">
          <h2 className="text-4xl font-display font-bold text-gray-900 mb-2">
            {isEdit ? "Refine Your Masterpiece" : "List Your Artwork"}
          </h2>
          <p className="text-gray-500 font-inter">
            {isEdit
              ? "Update your listing details to attract more buyers."
              : "Share your creative vision with collectors across the globe."}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Fields */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Collection Address *
              </label>
              <input
                required
                disabled={!!prefilledCollectionAddress || isEdit}
                value={form.collectionAddress}
                onChange={(e) =>
                  setForm({ ...form, collectionAddress: e.target.value })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter disabled:opacity-60 disabled:bg-gray-100 disabled:cursor-not-allowed"
                placeholder="e.g. C..."
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                NFT Token ID *
              </label>
              <input
                required
                type="number"
                disabled={prefilledTokenId !== undefined || isEdit}
                value={form.nftTokenId}
                onChange={(e) =>
                  setForm({ ...form, nftTokenId: parseInt(e.target.value) })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter disabled:opacity-60 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Amount (ERC-1155 Quantity)
              </label>
              <input
                type="number"
                min={1}
                value={form.amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    amount: Math.max(1, parseInt(e.target.value) || 1),
                  })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                placeholder="Number of copies to list (default: 1)"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Price ({selectedToken.symbol}) *
              </label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min={0.0000001}
                  step="any"
                  value={form.price}
                  onChange={(e) =>
                    setForm({ ...form, price: parseFloat(e.target.value) })
                  }
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 pr-16 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-600">
                  {selectedToken.symbol}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Amount *
              </label>
              <input
                required
                type="number"
                min={1}
                value={form.amount}
                onChange={(e) =>
                  setForm({ ...form, amount: parseInt(e.target.value) || 1 })
                }
                className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                Payment Token *
              </label>
              <select
                required
                disabled={!hasTokenOptions || isEdit}
                value={form.tokenAddress}
                onChange={(e) =>
                  setForm({ ...form, tokenAddress: e.target.value })
                }
                className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
              >
                {hasTokenOptions ? (
                  tokenOptions.map((token) => (
                    <option key={token.address} value={token.address}>
                      {token.name} ({token.symbol})
                    </option>
                  ))
                ) : (
                  <option value="">No supported tokens available</option>
                )}
              </select>
            </div>
          </div>

          {/* Progress / error */}
          {isLoading && progress && (
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
            {isEdit && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="flex-1 rounded-2xl border border-gray-200 py-4 text-lg font-semibold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <GuardButton
              type="submit"
              disabled={isLoading || !hasTokenOptions}
              actionName={
                isEdit ? "to update your listing" : "to list your artwork"
              }
              className="flex-[2] flex items-center justify-center gap-3 rounded-2xl bg-brand-500 py-5 text-xl font-bold text-white shadow-2xl shadow-brand-500/30 hover:bg-brand-600 hover:scale-[1.01] transition-all active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              {isLoading ? (
                <>
                  <Loader2 size={24} className="animate-spin" />
                  {progress || "Processing…"}
                </>
              ) : (
                <>
                  {isEdit ? <Save size={24} /> : <Upload size={24} />}
                  {isEdit ? "Update Listing" : "Create Listing"}
                </>
              )}
            </GuardButton>
          </div>
        </form>
      </div>
    </div>
  );
}
