// ─────────────────────────────────────────────────────────────
// app/listings/[id]/page.tsx — Server component wrapper with OpenGraph metadata
// ─────────────────────────────────────────────────────────────

import { Metadata } from "next";
import ListingClient from "./ListingClient";
import { getListing, getAuction, stroopsToXlm } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl } from "@/lib/ipfs";

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = params;

  try {
    // Try to fetch listing or auction data
    let listing = null;
    let auction = null;
    let metadata = null;

    try {
      listing = await getListing(Number(id));
    } catch (e) {
      // Might be an auction
    }

    try {
      auction = await getAuction(Number(id));
    } catch (e) {
      // Might be a listing
    }

    const cid = listing?.metadata_cid || auction?.metadata_cid;
    if (cid) {
      metadata = await fetchMetadata(cid);
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
    const artist = listing?.artist || auction?.creator || "Unknown Artist";
    const price =
      listing?.price || auction?.highest_bid || auction?.reserve_price;
    const priceDisplay = price
      ? `${stroopsToXlm(price)} XLM`
      : "Price on request";

    // Convert IPFS URLs to HTTP gateway URLs for OpenGraph
    const imageUrl = metadata.image ? cidToGatewayUrl(metadata.image) : null;

    return {
      title: `${title} - Afristore`,
      description: `${description} | By ${artist.slice(0, 8)}... | ${priceDisplay}`,
      openGraph: {
        title,
        description: `${description}\n\nArtist: ${artist.slice(0, 12)}...\nPrice: ${priceDisplay}`,
        type: "website",
        url: `https://afristore.art/listings/${id}`,
        images: imageUrl
          ? [
              {
                url: imageUrl,
                width: 1200,
                height: 1200,
                alt: title,
              },
            ]
          : [],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description: `${description} | ${priceDisplay}`,
        images: imageUrl ? [imageUrl] : [],
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Afristore - African Art Marketplace",
      description: "Discover unique African art on the Stellar blockchain",
    };
  }
}

export default function ListingPage({ params }: PageProps) {
  return <ListingClient id={params.id} />;
}
