import { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { fetchListings, getCollections } from "@/lib/indexer";

// Regenerate hourly so newly indexed listings show up without a redeploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = config.baseUrl;

  // Static pages
  const staticPages = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dashboard`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/launchpad`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/auctions`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 0.9,
    },
  ];

  // Fetch active listings via the indexer client, which unwraps the
  // paginated `{ listings, total }` response and never throws.
  const { listings } = await fetchListings({ status: "Active", limit: 1000 });

  // The indexer exposes ledger sequences, not timestamps, so a ledger number
  // cannot be turned into a date. Use the generation time instead.
  const now = new Date();

  const listingPages = listings
    .filter((listing) => listing.listing_id != null && `${listing.listing_id}` !== "")
    .map((listing) => ({
      url: `${baseUrl}/listings/${listing.listing_id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  const { collections } = await getCollections();

  const collectionPages = collections.map((collection) => {
    const created = collection.createdAt ? new Date(collection.createdAt) : null;
    return {
      url: `${baseUrl}/launchpad/collections/${collection.contractAddress}`,
      lastModified:
        created && !Number.isNaN(created.getTime()) ? created : now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    };
  });

  // Derive unique artist addresses from active listings for profile pages (#213)
  const artistAddresses: string[] = Array.from(
    new Set(
      listings
        .map((l) => l.artist)
        .filter((a): a is string => typeof a === "string" && a.length > 0),
    ),
  );

  const profilePages = artistAddresses.map((address) => ({
    url: `${baseUrl}/profile/${address}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticPages, ...listingPages, ...collectionPages, ...profilePages];
}
