// ─────────────────────────────────────────────────────────────
// app/listings/[id]/page.tsx — Server Component
// Fetches listing/auction/metadata on the server, generates
// OpenGraph metadata, and delegates interactive UI to
// ListingInteractiveArea (Client Component).
// ─────────────────────────────────────────────────────────────

import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getListing, getAuction, stroopsToXlm } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl } from "@/lib/ipfs";
import ListingInteractiveArea from "./ListingInteractiveArea";
import { ArrowLeft, AlertCircle } from "lucide-react";

interface PageProps {
  params: Promise<{ id: string }>;
}

// ── Mock data shared between generateMetadata and the page ───

const MOCK_DATA = [
  {
    title: "Ndebele Geometry",
    artist: "GB2...Traditional",
    category: "Traditional",
    price: 250,
    image:
      "https://images.unsplash.com/photo-1582582621959-48d27397dc69?w=800&q=80",
  },
  {
    title: "Maasai Beadwork Essence",
    artist: "GB3...Contemporary",
    category: "Contemporary",
    price: 180,
    image:
      "https://images.unsplash.com/photo-1590845947698-8924d7409b56?w=800&q=80",
  },
  {
    title: "Bronze Kingdom Legacy",
    artist: "GB4...Classical",
    category: "Classical",
    price: 420,
    image:
      "https://images.unsplash.com/photo-1580136579312-94651dfd596d?w=800&q=80",
  },
  {
    title: "Sahel Sunset Canvas",
    artist: "GB5...Modern",
    category: "Modern",
    price: 310,
    image:
      "https://images.unsplash.com/photo-1578926375605-eaf7559b1458?w=800&q=80",
  },
  {
    title: "Kente Woven Dreams",
    artist: "GB6...Textile",
    category: "Textile",
    price: 195,
    image:
      "https://images.unsplash.com/photo-1528699144885-3652875b4783?w=800&q=80",
  },
  {
    title: "Baobab Spirit",
    artist: "GB7...Sculpture",
    category: "Sculpture",
    price: 375,
    image:
      "https://images.unsplash.com/photo-1559519529-0935f852b3a6?w=800&q=80",
  },
];

// ── generateMetadata ─────────────────────────────────────────

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    let listing = null;
    let auction = null;
    let metadata = null;

    // Primary path: Try indexer API first
    try {
      const { fetchListingById } = await import("@/lib/indexer");
      listing = await fetchListingById(Number(id));
    } catch (_e) {
      // Indexer unavailable, continue to fallback
    }

    // Fallback to on-chain if indexer didn't return a listing
    if (!listing) {
      try {
        listing = await getListing(Number(id));
      } catch (_e) {
        // may be an auction
      }
    }

    // Try auction from indexer or on-chain
    if (!listing) {
      try {
        const { fetchAuctions } = await import("@/lib/indexer");
        const auctions = await fetchAuctions({ status: "Active" });
        auction = auctions.find((a) => a.auction_id === Number(id)) || null;
      } catch (_e) {
        // Indexer unavailable
      }

      if (!auction) {
        try {
          auction = await getAuction(Number(id));
        } catch (_e) {
          // may be a listing
        }
      }
    }

    const cid = listing?.metadata_cid || auction?.metadata_cid;
    if (cid) {
      metadata = await fetchMetadata(cid);
    }

    // Fallback for mock IDs 1–6
    if (!metadata && Number(id) >= 1 && Number(id) <= 6) {
      const m = MOCK_DATA[Number(id) - 1];
      metadata = {
        title: m.title,
        description: `A stunning masterpiece representing the rich ${
          m.title.split(" ")[0]
        } culture.`,
        artist: m.artist,
        image: m.image,
        year: "2024",
        category: m.category,
      };
      listing = {
        price: BigInt(m.price) * BigInt(10_000_000),
        artist: m.artist,
      } as typeof listing;
    }

    if (!metadata) {
      return {
        title: "Artwork Not Found - Afristore",
        description:
          "This artwork could not be found on Afristore marketplace.",
      };
    }

    const title = metadata.title || `Artwork #${id}`;
    const description =
      metadata.description || "Unique African art on Stellar blockchain";
    const artist =
      listing?.artist || auction?.creator || "Unknown Artist";
    const price =
      listing?.price || auction?.highest_bid || auction?.reserve_price;
    const priceDisplay = price
      ? `${stroopsToXlm(price)} XLM`
      : "Price on request";
    const imageUrl = metadata.image ? cidToGatewayUrl(metadata.image) : null;

    return {
      title: `${title} - Afristore`,
      description: `${description} | By ${artist.slice(0, 8)}... | ${priceDisplay}`,
      openGraph: {
        title,
        description: `${description}\n\nArtist: ${artist.slice(
          0,
          12
        )}...\nPrice: ${priceDisplay}`,
        type: "website",
        url: `https://afristore.art/listings/${id}`,
        images: imageUrl
          ? [{ url: imageUrl, width: 1200, height: 1200, alt: title }]
          : [],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: `${description} | ${priceDisplay}`,
        images: imageUrl ? [imageUrl] : [],
      },
    };
  } catch (_e) {
    return {
      title: "Afristore - African Art Marketplace",
      description: "Discover unique African art on the Stellar blockchain",
    };
  }
}

// ── Server Component page ────────────────────────────────────

export default async function ListingPage({ params }: PageProps) {
  const { id } = await params;

  // ── Fetch data on the server ────────────────────────────────
  let listing = null;
  let auction = null;
  let metadata = null;
  let fetchError: string | null = null;

  try {
    // Mock data for placeholder IDs 1–6
    if (Number(id) >= 1 && Number(id) <= 6) {
      const m = MOCK_DATA[Number(id) - 1];
      listing = {
        listing_id: Number(id),
        artist: m.artist,
        collection: m.artist,
        token_id: Number(id),
        metadata_cid: `mock_cid_${id}`,
        price: BigInt(m.price) * BigInt(10_000_000),
        currency: "XLM",
        token: "CAS...XLM",
        recipients: [],
        status: "Active" as const,
        owner: null,
        created_at: Math.floor(Date.now() / 1000),
      };
      metadata = {
        title: m.title,
        description: `A stunning masterpiece representing the rich ${
          m.title.split(" ")[0]
        } culture. This unique artwork captures the essence of African heritage through modern digital expression.`,
        artist: m.artist,
        image: m.image,
        year: "2024",
        category: m.category,
      };
    } else {
      // Primary path: Try indexer API first
      try {
        const { fetchListingById } = await import("@/lib/indexer");
        listing = await fetchListingById(Number(id));
      } catch (indexerError) {
        console.warn("[page] Indexer unavailable, falling back to on-chain:", indexerError);
      }

      // Fallback: If indexer didn't return a listing, try on-chain
      if (!listing) {
        try {
          listing = await getListing(Number(id));
        } catch (_e) {
          // may be an auction
        }
      }

      // Try auction from indexer or on-chain
      if (!listing) {
        try {
          const { fetchAuctions } = await import("@/lib/indexer");
          const auctions = await fetchAuctions({ status: "Active" });
          auction = auctions.find((a) => a.auction_id === Number(id)) || null;
        } catch (_e) {
          console.warn("[page] Indexer auction fetch failed");
        }

        if (!auction) {
          try {
            auction = await getAuction(Number(id));
          } catch (_e) {
            // not an auction either
          }
        }
      }

      if (!listing && !auction) {
        fetchError = "Artwork not found";
      } else {
        const cid = listing?.metadata_cid || auction?.metadata_cid;
        if (cid) {
          metadata = await fetchMetadata(cid);
        }
      }
    }
  } catch (err) {
    fetchError =
      err instanceof Error ? err.message : "Failed to load artwork details";
  }

  // ── Static image URL resolved server-side ──────────────────
  const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;
  const status = listing?.status || auction?.status;

  // ── Error state ─────────────────────────────────────────────
  if (fetchError || (!listing && !auction)) {
    return (
      <div className="py-32 flex flex-col items-center text-center">
        <div className="w-20 h-20 bg-terracotta-500/10 rounded-full flex items-center justify-center mb-6">
          <AlertCircle size={40} className="text-terracotta-500" />
        </div>
        <h2 className="text-2xl font-display font-bold text-white mb-2">
          Artwork Not Found
        </h2>
        <p className="text-white/60 mb-8 max-w-md">
          {fetchError ??
            "The listing you are looking for does not exist or has been removed."}
        </p>
        <Link
          href="/"
          className="px-8 py-3 rounded-xl bg-brand-500 text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand-500/20"
        >
          Return to Marketplace
        </Link>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────
  const priceDisplay = listing
    ? stroopsToXlm(listing.price)
    : auction
    ? stroopsToXlm(auction.highest_bid || auction.reserve_price)
    : "0";

  return (
    <div className="min-h-screen bg-midnight-950 text-white pb-20 pt-24 px-4 sm:px-6 lg:px-8">
      {/* Back link */}
      <div className="max-w-7xl mx-auto mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} />
          Back to Marketplace
        </Link>
      </div>

      <div className="max-w-7xl mx-auto grid gap-12 lg:grid-cols-2 lg:items-start">
        {/* LEFT COLUMN: Static media + interactive tabs */}
        <div className="space-y-8">
          {/* Artwork image — rendered on server */}
          <div className="relative aspect-square overflow-hidden rounded-[2.5rem] bg-midnight-900 border border-white/5 shadow-2xl group">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={metadata?.title ?? "Artwork"}
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-105"
                priority
                unoptimized
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-8xl opacity-20">
                🎨
                <span className="text-lg font-display mt-4 italic">
                  No media available
                </span>
              </div>
            )}

            {/* Status badge */}
            <div
              className={`absolute top-6 right-6 px-4 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase backdrop-blur-md shadow-xl border ${
                status === "Active"
                  ? "bg-mint-500/20 text-mint-400 border-mint-500/30"
                  : status === "Sold" || status === "Finalized"
                  ? "bg-brand-500/20 text-brand-400 border-brand-500/30"
                  : "bg-terracotta-500/20 text-terracotta-400 border-terracotta-500/30"
              }`}
            >
              {status}
            </div>

            {/* Type badge */}
            <div className="absolute top-6 left-6 px-4 py-1.5 rounded-full text-xs font-bold bg-white/10 backdrop-blur-md text-white border border-white/20">
              {listing ? "Fixed Price" : "Timed Auction"}
            </div>
          </div>

          {/* Interactive tabs + action buttons (Client Component) */}
          <ListingInteractiveArea
            id={id}
            listing={listing}
            auction={auction}
            metadata={metadata}
          />
        </div>

        {/* RIGHT COLUMN: Title, price, action panel */}
        <div className="space-y-8 sticky top-28">
          <div className="p-10 rounded-[3rem] bg-gradient-to-br from-white/10 to-white/5 border border-white/10 backdrop-blur-md shadow-2xl relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-500/10 blur-3xl rounded-full" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-terracotta-500/10 blur-3xl rounded-full" />

            <div className="relative">
              <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-2 leading-tight">
                {metadata?.title || `Art Asset #${id}`}
              </h1>

              <div className="flex items-center gap-4 mb-8">
                <div className="flex -space-x-3">
                  <div className="w-8 h-8 rounded-full bg-brand-500 border-2 border-midnight-950 flex items-center justify-center text-white font-bold text-xs ring-2 ring-brand-500/20">
                    A
                  </div>
                  <div className="w-8 h-8 rounded-full bg-terracotta-500 border-2 border-midnight-950 flex items-center justify-center text-white font-bold text-xs ring-2 ring-terracotta-500/20">
                    B
                  </div>
                </div>
                <p className="text-sm text-white/40 font-medium">
                  Collection:{" "}
                  <span className="text-white">Afristore Origins</span>
                </p>
              </div>

              {/* Price */}
              <div className="grid grid-cols-1 gap-6 mb-10">
                <div className="p-6 rounded-3xl bg-midnight-950/50 border border-white/5 shadow-inner">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-black mb-1">
                        {listing ? "Fixed Price" : "Current Bid"}
                      </p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-5xl font-display font-bold text-white">
                          {priceDisplay}
                        </span>
                        <span className="text-brand-400 font-bold">XLM</span>
                      </div>
                      <p className="text-xs text-white/30 mt-1 font-mono">
                        ≈ {(Number(priceDisplay) * 0.12).toFixed(2)} USD
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* All interactive actions live in the Client Component */}
              <ListingInteractiveArea
                id={id}
                listing={listing}
                auction={auction}
                metadata={metadata}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
