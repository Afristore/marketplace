import { MetadataRoute } from 'next'
import { config } from '@/lib/config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = config.baseUrl

  // Static pages
  const staticPages = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dashboard`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/launchpad`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/auctions`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
  ]

  // Fetch active listings from indexer
  let listings: any[] = []
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000'}/listings`, {
      next: { revalidate: 3600 } // Revalidate every hour
    })
    if (response.ok) {
      listings = await response.json()
    }
  } catch (error) {
    console.error('Failed to fetch listings for sitemap:', error)
  }

  // Add listing pages
  const listingPages = listings.map((listing: any) => ({
    url: `${baseUrl}/listings/${listing.listingId}`,
    lastModified: new Date(listing.updatedAtLedger * 1000), // Convert ledger sequence to approximate timestamp
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }))

  // Fetch collections from indexer
  let collections: any[] = []
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4000'}/collections`, {
      next: { revalidate: 3600 }
    })
    if (response.ok) {
      collections = await response.json()
    }
  } catch (error) {
    console.error('Failed to fetch collections for sitemap:', error)
  }

  // Add collection pages
  const collectionPages = collections.map((collection: any) => ({
    url: `${baseUrl}/launchpad/collections/${collection.contractAddress}`,
    lastModified: new Date(collection.createdAt),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  // Derive unique artist addresses from active listings for profile pages (#213)
  const artistAddresses: string[] = Array.from(
    new Set(
      listings
        .map((l: any) => l.artist as string | undefined)
        .filter((a): a is string => typeof a === 'string' && a.length > 0)
    )
  )

  const profilePages = artistAddresses.map((address) => ({
    url: `${baseUrl}/profile/${address}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  return [...staticPages, ...listingPages, ...collectionPages, ...profilePages]
}
