// ─────────────────────────────────────────────────────────────
// lib/resolveArtwork.ts — server-side lookup for /listings/[id]
// ─────────────────────────────────────────────────────────────
// Shared by the listing page, its generateMetadata, and the OpenGraph image
// route so all three always describe the same real on-chain artwork.
// Resolution order: indexer listing → on-chain listing → indexer auction →
// on-chain auction. There is deliberately no placeholder/demo fallback: an id
// that cannot be resolved yields `null` and callers render "Artwork Not Found".
// ─────────────────────────────────────────────────────────────

import { getListing, getAuction, Listing, Auction } from "@/lib/contract";
import { fetchListingById, fetchAuctions } from "@/lib/indexer";
import { fetchMetadata, ArtworkMetadata } from "@/lib/ipfs";

export interface ResolvedArtwork {
  listing: Listing | null;
  auction: Auction | null;
  /** IPFS metadata, or null when the CID is missing or the gateway failed. */
  metadata: ArtworkMetadata | null;
}

/** Parse a route param into a positive integer id, or null if invalid. */
export function parseArtworkId(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export async function resolveArtwork(
  rawId: string,
): Promise<ResolvedArtwork | null> {
  const id = parseArtworkId(rawId);
  if (id === null) return null;

  let listing: Listing | null = null;
  let auction: Auction | null = null;

  try {
    listing = await fetchListingById(id);
  } catch {
    // Indexer unavailable — fall back to on-chain.
  }

  if (!listing) {
    try {
      listing = await getListing(id);
    } catch {
      // Not a listing (or RPC unavailable) — may be an auction.
    }
  }

  if (!listing) {
    try {
      const auctions = await fetchAuctions({ status: "Active" });
      auction = auctions.find((a) => a.auction_id === id) ?? null;
    } catch {
      // Indexer unavailable.
    }
    if (!auction) {
      try {
        auction = await getAuction(id);
      } catch {
        // Neither a listing nor an auction.
      }
    }
  }

  if (!listing && !auction) return null;

  let metadata: ArtworkMetadata | null = null;
  const cid = listing?.metadata_cid || auction?.metadata_cid;
  if (cid) {
    try {
      metadata = await fetchMetadata(cid);
    } catch {
      // Gateway failure — still render the real listing without metadata.
    }
  }

  return { listing, auction, metadata };
}
