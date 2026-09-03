// ─────────────────────────────────────────────────────────────
// components/ListingCard.tsx
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { ArtworkMetadata, fetchMetadata, cidToGatewayUrl } from "@/lib/ipfs";
import { useEffect } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { useBuyArtwork } from "@/hooks/useMarketplace";
import { ShoppingCart, User, Calendar, Tag } from "lucide-react";
import { GuardButton } from "./WalletGuard";
import posthog from "posthog-js";
import { CheckoutModal } from "./CheckoutModal";

interface ListingCardProps {
  listing: Listing;
  onPurchased?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-green-100 text-green-700",
  Sold: "bg-gray-100 text-gray-500",
  Cancelled: "bg-red-100 text-red-600",
};

function formatPrice(stroops: bigint): string {
  const [whole, fraction] = stroopsToXlm(stroops).split(".");
  const formattedWhole = Intl.NumberFormat("en-US").format(BigInt(whole));
  return fraction ? `${formattedWhole}.${fraction}` : formattedWhole;
}

export function ListingCard({ listing, onPurchased }: ListingCardProps) {
  const { publicKey, status } = useWalletContext();
  const { buy, isBuying, error: buyError } = useBuyArtwork(publicKey);

  const [metadata, setMetadata] = useState<ArtworkMetadata | null>(null);
  const [imgError, setImgError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showCheckout, setShowCheckout] = useState(false);

  // Resolve metadata from IPFS on mount.
  useEffect(() => {
    setIsLoading(true);
    fetchMetadata(listing.metadata_cid)
      .then(setMetadata)
      .catch(() => setMetadata(null))
      .finally(() => setIsLoading(false));
  }, [listing.metadata_cid]);

  const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;

  const isOwn = publicKey === listing.artist;

  const handleBuy = async () => {
    return await buy(listing.listing_id);
  };

  return (
    <>
      <CheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        listing={listing}
        onCryptoPurchase={handleBuy}
        onPurchased={onPurchased}
        isBuyingCrypto={isBuying}
      />
      <div className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-shadow">
        {/* Image */}
        <Link href={`/listings/${listing.listing_id}`}>
          <div className="relative aspect-square overflow-hidden bg-brand-50">
            {isLoading ? (
              <div
                className="flex h-full w-full items-center justify-center bg-gray-100 animate-pulse"
                aria-label="Loading artwork"
                data-testid="artwork-loading"
              >
                <span className="sr-only">Loading artwork...</span>
              </div>
            ) : imageUrl && !imgError ? (
              <Image
                src={imageUrl}
                alt={metadata?.title ?? `Listing #${listing.listing_id}`}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                onError={() => setImgError(true)}
                unoptimized
              />
            ) : (
              <div
                className="flex h-full w-full flex-col items-center justify-center bg-gray-50 text-gray-400"
                aria-label="Artwork missing"
                data-testid="artwork-missing"
              >
                <span className="text-4xl mb-2">🖼️</span>
                <span className="text-xs font-medium uppercase tracking-wider">
                  No Artwork
                </span>
              </div>
            )}

            {/* Status badge */}
            <span
              className={`absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[listing.status] ?? "bg-gray-100 text-gray-500"}`}
            >
              {listing.status}
            </span>
          </div>
        </Link>

        {/* Info */}
        <div className="flex flex-1 flex-col p-4">
          <Link href={`/listings/${listing.listing_id}`}>
            <h3 className="truncate text-base font-semibold text-gray-900 hover:text-brand-600 transition-colors">
              {metadata?.title ?? `Artwork #${listing.listing_id}`}
            </h3>
          </Link>

          {metadata?.description && (
            <p className="mt-1 line-clamp-2 text-sm text-gray-500">
              {metadata.description}
            </p>
          )}

          <div className="mt-3 space-y-1 text-xs text-gray-400">
            <div className="flex items-center gap-1.5">
              <User size={12} />
              <span className="truncate font-mono">
                {listing.artist.slice(0, 8)}…{listing.artist.slice(-4)}
              </span>
            </div>
            {metadata?.year && (
              <div className="flex items-center gap-1.5">
                <Calendar size={12} />
                <span>{metadata.year}</span>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-brand-600">
              <Tag size={14} />
              <span className="text-lg font-bold">
                {formatPrice(listing.price)} XLM
              </span>
            </div>

            {listing.status === "Active" && (
              <GuardButton
                onAction={() => setShowCheckout(true)}
                disabled={isBuying || isOwn}
                actionName="To purchase this artwork"
                title={isOwn ? "You cannot buy your own listing" : undefined}
                className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-md shadow-brand-500/20 active:scale-95"
              >
                <ShoppingCart size={14} />
                {isBuying ? "Buying…" : isOwn ? "Yours" : "Buy Now"}
              </GuardButton>
            )}
          </div>

          {buyError && <p className="mt-2 text-xs text-red-500">{buyError}</p>}
        </div>
      </div>
    </>
  );
}
