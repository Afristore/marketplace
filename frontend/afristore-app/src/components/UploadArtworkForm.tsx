// ─────────────────────────────────────────────────────────────
// components/UploadArtworkForm.tsx — create listing form
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useCreateListing, CreateListingInput } from "@/hooks/useMarketplace";
import { useWalletContext } from "@/context/WalletContext";
import { Upload, CheckCircle, ChevronDown } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import { SUPPORTED_TOKENS, DEFAULT_TOKEN, getTokenInfo } from "@/lib/tokens";

interface UploadArtworkFormProps {
  onSuccess?: (listingId: number) => void;
}

export function UploadArtworkForm({ onSuccess }: UploadArtworkFormProps) {
  const { publicKey, isConnected, connect } = useWalletContext();
  const { create, isCreating, progress, error } = useCreateListing(publicKey);

  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<CreateListingInput, "imageFile">>({
    title: "",
    description: "",
    artistName: "",
    year: new Date().getFullYear().toString(),
    priceXlm: 10,
    token: DEFAULT_TOKEN,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleTokenSelect = (symbol: string) => {
    setForm({ ...form, token: symbol });
    setTokenDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    const id = await create({ ...form, imageFile: selectedFile });
    if (id !== null) {
      setSuccess(id);
      onSuccess?.(id);
    }
  };

  const selectedToken = getTokenInfo(form.token || DEFAULT_TOKEN);

  if (success !== null) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <CheckCircle size={48} className="text-green-500" />
        <h3 className="text-xl font-semibold text-green-800">
          Listing #{success} created!
        </h3>
        <p className="text-sm text-green-700">
          Your artwork is now live on the Afristore marketplace.
        </p>
        <button
          onClick={() => {
            setSuccess(null);
            setPreview(null);
            setSelectedFile(null);
            setForm({ title: "", description: "", artistName: "", year: new Date().getFullYear().toString(), priceXlm: 10, token: DEFAULT_TOKEN });
          }}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          List Another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 mx-auto">
      {/* Image upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-300 bg-brand-50 p-8 text-center hover:border-brand-500 transition-colors"
      >
        {preview ? (
          <div className="relative h-48 w-full">
            <Image src={preview} alt="Preview" fill className="object-contain rounded-xl" unoptimized />
          </div>
        ) : (
          <>
            <Upload size={36} className="mb-2 text-brand-400" />
            <p className="text-sm font-medium text-brand-600">
              Drop artwork here or click to browse
            </p>
            <p className="mt-1 text-xs text-gray-400">PNG, JPG, GIF, WEBP — max 50 MB</p>
          </>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Title *
          </label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="e.g. Sunlit Savanna"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="Tell the story behind this piece…"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Artist Name *
          </label>
          <input
            required
            value={form.artistName}
            onChange={(e) => setForm({ ...form, artistName: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="Your name or alias"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Year *
          </label>
          <input
            required
            type="number"
            min={1900}
            max={2100}
            value={form.year}
            onChange={(e) => setForm({ ...form, year: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        {/* Token Dropdown */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Token *
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setTokenDropdownOpen(!tokenDropdownOpen)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none bg-white flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="text-lg">{selectedToken?.icon}</span>
                <span>{selectedToken?.symbol}</span>
                <span className="text-gray-400">— {selectedToken?.name}</span>
              </span>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${tokenDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {tokenDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                {SUPPORTED_TOKENS.map((token) => (
                  <button
                    key={token.symbol}
                    type="button"
                    onClick={() => handleTokenSelect(token.symbol)}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-brand-50 flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className="text-lg">{token.icon}</span>
                    <span>{token.symbol}</span>
                    <span className="text-gray-400">— {token.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Price with dynamic label */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Price ({selectedToken?.symbol}) *
          </label>
          <div className="relative">
            <input
              required
              type="number"
              min={0.0000001}
              step="any"
              value={form.priceXlm}
              onChange={(e) => setForm({ ...form, priceXlm: parseFloat(e.target.value) })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-20 text-sm focus:border-brand-500 focus:outline-none"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
              {selectedToken?.symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Progress / error */}
      {isCreating && progress && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <span className="animate-spin">⏳</span>
          {progress}
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {/* Button at the end */}
      <GuardButton
        type="submit"
        disabled={isCreating || !selectedFile}
        actionName="To list your artwork"
        className="w-full rounded-xl bg-brand-500 py-3.5 text-base font-bold text-white shadow-xl shadow-brand-500/20 hover:bg-brand-600 transition-all active:scale-[0.98] disabled:opacity-50"
      >
        {isCreating ? progress || "Processing…" : "List Artwork"}
      </GuardButton>
    </form>
  );
}
