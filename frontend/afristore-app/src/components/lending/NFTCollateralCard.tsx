// ─────────────────────────────────────────────────────────────
// components/lending/NFTCollateralCard.tsx
// ─────────────────────────────────────────────────────────────
// The primary card UI for a lending offer. Shows the NFT image
// (resolving IPFS URIs through the configured gateway), the
// required collateral amount, the loan amount and max duration,
// plus a clear call-to-action: "Borrow against this NFT".
//──────────────────────────────────────────────────────────────

"use client";

import Image from "next/image";
import {
  Clock3,
  Coins,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { cidToGatewayUrl } from "@/lib/ipfs";
import { toBigInt } from "@/lib/lendingMath";
import { formatDurationDays, formatUsd } from "./format";
import type { LendingOffer } from "./types";

interface NFTCollateralCardProps {
  /** The lending offer to display. */
  listing: LendingOffer;
  /** Invoked when the user clicks "Borrow against this NFT". */
  onBorrow?: (listing: LendingOffer) => void;
  /** Disables the CTA while a borrow transaction is in flight. */
  isBorrowing?: boolean;
}

/** Shortens a Stellar contract address for compact display. */
function shortenAddress(address: string): string {
  if (!address || address.length <= 13) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function NFTCollateralCard({
  listing,
  onBorrow,
  isBorrowing = false,
}: NFTCollateralCardProps) {
  const declaredPriceUsd = toBigInt(listing.declared_price_usd);
  const requiredCollateralUsd =
    (declaredPriceUsd * BigInt(listing.min_collateral_buffer_bps)) / 10_000n;

  const imageSrc = listing.nftImage
    ? cidToGatewayUrl(listing.nftImage)
    : null;
  const displayName =
    listing.nftName?.trim() || `Token #${String(listing.token_id)}`;
  const durationLabel = formatDurationDays(listing.max_duration_days);

  return (
    <article
      data-testid={`nft-collateral-card-${String(listing.id)}`}
      className="group relative flex flex-col overflow-hidden rounded-3xl bg-midnight-900 border border-white/10 shadow-xl transition-all duration-300 hover:border-brand-500/40 hover:shadow-brand-500/20 hover:-translate-y-1"
    >
      {/* NFT artwork */}
      <div className="relative aspect-square w-full overflow-hidden bg-midnight-950">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={displayName}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-700 group-hover:scale-110"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon size={48} className="text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-midnight-950/90 via-midnight-950/20 to-transparent opacity-70" />

        {/* Max duration badge */}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-midnight-950/70 border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80 backdrop-blur-sm">
          <Clock3 size={12} className="text-brand-400" />
          Up to {durationLabel}
        </span>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3
            className="truncate font-display text-lg font-bold text-white"
            title={displayName}
          >
            {displayName}
          </h3>
          <p className="mt-1 font-mono text-xs text-white/40">
            {shortenAddress(listing.nft_contract)} · #
            {String(listing.token_id)}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Loan Amount
            </dt>
            <dd className="mt-1 font-mono font-bold text-white">
              {formatUsd(declaredPriceUsd)}
            </dd>
          </div>
          <div className="rounded-2xl bg-mint-500/[0.08] border border-mint-500/20 p-3">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-mint-300/60">
              Collateral Required
            </dt>
            <dd className="mt-1 font-mono font-bold text-mint-400">
              {formatUsd(requiredCollateralUsd)}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          data-testid={`borrow-cta-${String(listing.id)}`}
          onClick={() => onBorrow?.(listing)}
          disabled={!onBorrow || isBorrowing}
          className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBorrowing ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Borrowing...
            </>
          ) : (
            <>
              <Coins size={16} />
              Borrow against this NFT
            </>
          )}
        </button>
      </div>
    </article>
  );
}