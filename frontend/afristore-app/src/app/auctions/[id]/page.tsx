// ─────────────────────────────────────────────────────────────
// app/auctions/[id]/page.tsx — Individual auction detail page
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { getAuction, stroopsToXlm, Auction } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl, ArtworkMetadata } from "@/lib/ipfs";
import { useWalletContext } from "@/context/WalletContext";
import { BiddingPanel } from "@/components/BiddingPanel";
import {
  ArrowLeft,
  ExternalLink,
  User,
  Calendar,
  Hash,
  Gavel,
  Shield,
  Percent,
} from "lucide-react";

export default function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { publicKey } = useWalletContext();

  const [auction, setAuction] = useState<Auction | null>(null);
  const [metadata, setMetadata] = useState<ArtworkMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAuction = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const a = await getAuction(Number(id));
      setAuction(a);
      const m = await fetchMetadata(a.metadata_cid);
      setMetadata(m);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load auction");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (id) loadAuction();
  }, [id]);

  const handleRefresh = async () => {
    try {
      const updated = await getAuction(Number(id));
      setAuction(updated);
    } catch {
      // Silently fail on refresh
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-32">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-500">{error ?? "Auction not found"}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-brand-500 hover:underline"
        >
          Back
        </button>
      </div>
    );
  }

  const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;

  return (
    <div className="min-h-screen bg-gray-50 pt-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600"
        >
          <ArrowLeft size={14} />
          Back to auctions
        </button>

        <div className="grid gap-10 lg:grid-cols-2">
          {/* Image */}
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-brand-50">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={metadata?.title ?? "Auction artwork"}
                fill
                className="object-contain"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Gavel size={64} className="text-brand-300" />
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            <h1 className="text-3xl font-display font-bold text-gray-900">
              {metadata?.title ?? `Auction #${auction.auction_id}`}
            </h1>

            {metadata?.description && (
              <p className="mt-3 text-gray-600 leading-relaxed">
                {metadata.description}
              </p>
            )}

            <div className="mt-6 space-y-3 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <User size={15} />
                <span className="font-mono break-all">{auction.creator}</span>
              </div>
              {metadata?.year && (
                <div className="flex items-center gap-2">
                  <Calendar size={15} />
                  <span>{metadata.year}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Hash size={15} />
                <a
                  href={`https://ipfs.io/ipfs/${auction.metadata_cid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 font-mono text-brand-500 hover:underline"
                >
                  {auction.metadata_cid.slice(0, 20)}...
                  <ExternalLink size={12} />
                </a>
              </div>
              {auction.royalty_bps > 0 && (
                <div className="flex items-center gap-2">
                  <Percent size={15} />
                  <span>
                    Royalty: {(auction.royalty_bps / 100).toFixed(2)}%
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Shield size={15} />
                <span className="font-mono text-xs break-all">
                  Original creator: {auction.original_creator.slice(0, 8)}...
                  {auction.original_creator.slice(-4)}
                </span>
              </div>
            </div>

            {/* Bidding Panel */}
            <div className="mt-8">
              <BiddingPanel
                auction={auction}
                onBidPlaced={handleRefresh}
                onFinalized={handleRefresh}
              />
            </div>

            {/* On-chain info */}
            <div className="mt-6 text-xs text-gray-400 space-y-1">
              <p>
                Auction ID:{" "}
                <span className="font-mono">#{auction.auction_id}</span>
              </p>
              <p>
                End time:{" "}
                <span className="font-mono">
                  {new Date(auction.end_time * 1000).toLocaleString()}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
