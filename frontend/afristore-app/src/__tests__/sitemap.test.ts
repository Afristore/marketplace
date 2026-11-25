/**
 * sitemap.ts (#1348): must unwrap the indexer's paginated `{ listings, total }`
 * response, link listings by `listing_id`, and never emit 1970 dates.
 */
const mockFetchListings = jest.fn();
const mockGetCollections = jest.fn();

jest.mock("@/lib/indexer", () => ({
  fetchListings: (...args: unknown[]) => mockFetchListings(...args),
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
}));

jest.mock("@/lib/config", () => ({
  config: { baseUrl: "https://afristore.test" },
}));

import sitemap from "@/app/sitemap";

describe("sitemap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollections.mockResolvedValue({ collections: [], total: 0 });
  });

  it("returns listing URLs built from listing_id with real dates", async () => {
    mockFetchListings.mockResolvedValue({
      listings: [
        { listing_id: "7", artist: "GARTIST1", updatedAtLedger: 123456 },
        { listing_id: "9", artist: "GARTIST1", updatedAtLedger: 123460 },
      ],
      total: 2,
    });

    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(mockFetchListings).toHaveBeenCalledWith({
      status: "Active",
      limit: 1000,
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(urls).toContain("https://afristore.test/listings/7");
    expect(urls).toContain("https://afristore.test/listings/9");
    expect(urls).not.toContain("https://afristore.test/listings/undefined");
    // One profile page per unique artist.
    expect(
      urls.filter((u) => u === "https://afristore.test/profile/GARTIST1"),
    ).toHaveLength(1);

    for (const entry of entries) {
      const d = new Date(entry.lastModified as Date);
      expect(Number.isNaN(d.getTime())).toBe(false);
      expect(d.getUTCFullYear()).toBeGreaterThan(2000);
    }
  });

  it("still returns static pages when the indexer has no listings", async () => {
    mockFetchListings.mockResolvedValue({ listings: [] });
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toContain("https://afristore.test");
    expect(entries.some((e) => e.url.includes("/listings/"))).toBe(false);
  });

  it("falls back to the current date for collections without createdAt", async () => {
    mockFetchListings.mockResolvedValue({ listings: [] });
    mockGetCollections.mockResolvedValue({
      collections: [
        { contractAddress: "CCOLL1", kind: "normal_721", creator: "GC", id: 1 },
      ],
      total: 1,
    });
    const entries = await sitemap();
    const coll = entries.find((e) =>
      e.url.endsWith("/launchpad/collections/CCOLL1"),
    );
    expect(coll).toBeDefined();
    expect(Number.isNaN(new Date(coll!.lastModified as Date).getTime())).toBe(
      false,
    );
  });
});
