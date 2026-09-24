"use client";

import React from "react";
import Image from "next/image";
import type { LendingListing } from "@/lib/lending";

interface NFTCollateralCardProps {
  listing: LendingListing;
  /** IPFS gateway URL for resolving images */
  ipfsGateway?: string;
  /** Callback when user clicks the borrow button */
  onBorrow?: (listing: LendingListing) => void;
  /** Whether the borrow button is disabled */
  disabled?: boolean;
}

/**
 * Resolves an IPFS URI to a displayable URL.
 * Handles ipfs://, cid://, and plain CID formats.
 */
function resolveIpfsUrl(uri: string, gateway: string): string {
  if (!uri) return "";

  // Already an HTTP URL
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }

  // ipfs:// protocol
  if (uri.startsWith("ipfs://")) {
    const path = uri.slice(7);
    return `${gateway}/ipfs/${path}`;
  }

  // cid:// protocol
  if (uri.startsWith("cid://")) {
    const cid = uri.slice(5);
    return `${gateway}/ipfs/${cid}`;
  }

  // Plain CID (no protocol prefix)
  if (/^[a-zA-Z0-9]{46,}$/.test(uri)) {
    return `${gateway}/ipfs/${uri}`;
  }

  return uri;
}

/**
 * Primary card UI for a lending offer.
 * Shows the NFT image, collateral amount, duration, and call-to-action.
 */
export function NFTCollateralCard({
  listing,
  ipfsGateway = "https://ipfs.io",
  onBorrow,
  disabled = false,
}: NFTCollateralCardProps) {
  // Try to resolve NFT image from listing metadata
  // In production, this would fetch from the NFT contract's metadata
  const [imageUrl, setImageUrl] = React.useState<string>("");
  const [imageError, setImageError] = React.useState(false);

  React.useEffect(() => {
    // Attempt to resolve image from NFT metadata
    // For now, use a placeholder based on the contract address
    const placeholderUrl = `https://ui-avatars.com/api/?name=NFT&background=0A1324&color=4AE292&size=400`;
    setImageUrl(placeholderUrl);
  }, [listing.nft_contract, listing.token_id]);

  const handleImageError = () => {
    setImageError(true);
    setImageUrl(`https://ui-avatars.com/api/?name=NFT#${listing.token_id}&background=0A1324&color=4AE292&size=400`);
  };

  // Format collateral amount (assuming 7 decimals for USDC-like tokens)
  const collateralFormatted = Number(listing.collateral_amount) / 10_000_000;

  // Format declared price
  const priceFormatted = Number(listing.declared_price_usd) / 10_000_000;

  // Calculate average interest rate
  const avgInterestBps =
    listing.interest_schedule_bps.length > 0
      ? listing.interest_schedule_bps.reduce((a, b) => a + b, 0) /
        listing.interest_schedule_bps.length
      : 0;
  const avgInterestPercent = avgInterestBps / 100;

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0A1324] transition-all hover:border-teal-500/30 hover:shadow-lg hover:shadow-teal-500/10">
      {/* NFT Image */}
      <div className="relative aspect-square overflow-hidden bg-white/[0.03]">
        {imageUrl && !imageError ? (
          <Image
            src={imageUrl}
            alt={`NFT #${listing.token_id}`}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            onError={handleImageError}
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-4xl">🖼️</span>
          </div>
        )}
        {/* Status badge */}
        <div className="absolute right-2 top-2">
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              listing.status === "Open"
                ? "bg-teal-500/20 text-teal-400"
                : listing.status === "Filled"
                  ? "bg-gray-500/20 text-gray-400"
                  : "bg-red-500/20 text-red-400"
            }`}
          >
            {listing.status}
          </span>
        </div>
      </div>

      {/* Card Content */}
      <div className="p-4">
        {/* NFT Identifier */}
        <div className="mb-3 flex items-center gap-2">
          <span className="text-sm font-medium text-white">
            NFT #{String(listing.token_id)}
          </span>
          <span className="text-xs text-gray-500">•</span>
          <span className="font-mono text-xs text-gray-400">
            {listing.nft_contract.slice(0, 8)}...
          </span>
        </div>

        {/* Key Details */}
        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Declared Value</span>
            <span className="font-mono text-sm text-white">
              ${priceFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Collateral Required</span>
            <span className="font-mono text-sm text-teal-400">
              {collateralFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Duration</span>
            <span className="text-sm text-white">
              {listing.max_duration_days} days
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Avg. Interest</span>
            <span className="text-sm text-white">
              {avgInterestPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Call to Action */}
        <button
          onClick={() => onBorrow?.(listing)}
          disabled={disabled || listing.status !== "Open"}
          className="w-full rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {listing.status === "Open" ? "Borrow against this NFT" : listing.status === "Filled" ? "Currently Lent" : "Cancelled"}
        </button>
      </div>
    </div>
  );
}
