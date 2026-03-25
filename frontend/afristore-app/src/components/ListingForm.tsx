// ─────────────────────────────────────────────────────────────
// components/ListingForm.tsx — create and edit listing form
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useCreateListing, useUpdateListing, UpdateListingInput, CreateListingInput } from "@/hooks/useMarketplace";
import { useWalletContext } from "@/context/WalletContext";
import { Upload, CheckCircle, Loader2, Save } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import { ArtworkMetadata, fetchMetadata, cidToGatewayUrl } from "@/lib/ipfs";
import { Listing, stroopsToXlm } from "@/lib/contract";

import { SUPPORTED_TOKENS, DEFAULT_TOKEN } from "@/config/tokens";

interface ListingFormProps {
  listing?: Listing; // If provided, we are in EDIT mode
  onSuccess?: (listingId: number) => void;
  onCancel?: () => void;
}

export function ListingForm({ listing, onSuccess, onCancel }: ListingFormProps) {
  const isEdit = !!listing;
  const { publicKey } = useWalletContext();
  
  const { create, isCreating, progress: createProgress, error: createError } = useCreateListing(publicKey);
  const { update, isUpdating, progress: updateProgress, error: updateError } = useUpdateListing(publicKey);

  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    artistName: "",
    year: new Date().getFullYear().toString(),
    price: 10,
    tokenAddress: DEFAULT_TOKEN.address,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [successId, setSuccessId] = useState<number | null>(null);
  const [currentMetadata, setCurrentMetadata] = useState<ArtworkMetadata | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedToken = SUPPORTED_TOKENS.find(t => t.address === form.tokenAddress) || DEFAULT_TOKEN;

  // Load existing data if in edit mode
  useEffect(() => {
    if (listing) {
      setIsFetchingMetadata(true);
      fetchMetadata(listing.metadata_cid)
        .then((meta) => {
          setCurrentMetadata(meta);
          setForm({
            title: meta.title,
            description: meta.description,
            artistName: meta.artist,
            year: meta.year,
            price: parseFloat(stroopsToXlm(listing.price)),
            tokenAddress: listing.token,
          });
          setPreview(cidToGatewayUrl(meta.image));
        })
        .finally(() => setIsFetchingMetadata(false));
    }
  }, [listing]);

  const handleFile = (file: File) => {
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreview(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) handleFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isEdit && listing && currentMetadata) {
      const success = await update({
        listingId: listing.listing_id,
        ...form,
        imageFile: selectedFile || undefined,
        currentMetadata,
      });
      if (success) {
        setSuccessId(listing.listing_id);
        onSuccess?.(listing.listing_id);
      }
    } else if (!isEdit) {
      if (!selectedFile) return;
      const id = await create({ ...form, imageFile: selectedFile });
      if (id !== null) {
        setSuccessId(id);
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
            Your artwork is now live and available for purchase on the Afristore marketplace.
            </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full mt-4">
            {!isEdit && (
                <button
                onClick={() => {
                    setSuccessId(null);
                    setPreview(null);
                    setSelectedFile(null);
                    setForm({ title: "", description: "", artistName: "", year: new Date().getFullYear().toString(), price: 10, tokenAddress: DEFAULT_TOKEN.address });
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
                    {isEdit ? "Update your listing details to attract more buyers." : "Share your creative vision with collectors across the globe."}
                </p>
            </header>

            <form onSubmit={handleSubmit} className="space-y-8">
            {/* Image upload zone */}
            <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !isEdit && fileRef.current?.click()}
                className={`group relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-brand-200 bg-brand-50/30 p-12 text-center transition-all ${!isEdit ? "cursor-pointer hover:border-brand-400 hover:bg-brand-50/60" : ""}`}
            >
                {preview ? (
                <div className="relative h-64 w-full">
                    <Image src={preview} alt="Preview" fill className="object-contain rounded-2xl" unoptimized />
                    {!isEdit && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-2xl transition-opacity">
                            <p className="text-white text-base font-bold underline underline-offset-4">Click to change</p>
                        </div>
                    )}
                </div>
                ) : (
                <div className="py-4">
                    <div className="mx-auto w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Upload size={32} className="text-brand-500" />
                    </div>
                    <p className="text-lg font-semibold text-brand-950 font-display">
                    Select Your Artwork
                    </p>
                    <p className="mt-1 text-sm text-brand-400 font-inter">PNG, JPG, GIF or WEBP — max 50 MB</p>
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
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                    onChange={(e) => setForm({ ...form, artistName: e.target.value })}
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
                    Price ({selectedToken.symbol}) *
                </label>
                <div className="relative">
                    <input
                    required
                    type="number"
                    min={0.0000001}
                    step="any"
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) })}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 pr-16 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                    />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-bold text-brand-600">
                    {selectedToken.symbol}
                    </span>
                </div>
                </div>

                <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-950 uppercase tracking-wider font-inter">
                    Payment Token *
                </label>
                <select
                    required
                    value={form.tokenAddress}
                    onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })}
                    className="w-full appearance-none rounded-2xl border border-gray-200 bg-gray-50/50 px-5 py-4 text-base focus:border-brand-500 focus:bg-white focus:outline-none transition-all shadow-sm font-inter"
                >
                    {SUPPORTED_TOKENS.map((token) => (
                        <option key={token.address} value={token.address}>
                            {token.name} ({token.symbol})
                        </option>
                    ))}
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
                    disabled={isLoading || (!isEdit && !selectedFile)}
                    actionName={isEdit ? "to update your listing" : "to list your artwork"}
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
