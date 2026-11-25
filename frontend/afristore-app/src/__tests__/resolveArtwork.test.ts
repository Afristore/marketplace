/**
 * resolveArtwork (#1340): ids 1–6 must resolve to real data, never placeholders.
 */
const mockFetchListingById = jest.fn();
const mockFetchAuctions = jest.fn();
const mockGetListing = jest.fn();
const mockGetAuction = jest.fn();
const mockFetchMetadata = jest.fn();

jest.mock("@/lib/indexer", () => ({
  fetchListingById: (...a: unknown[]) => mockFetchListingById(...a),
  fetchAuctions: (...a: unknown[]) => mockFetchAuctions(...a),
}));
jest.mock("@/lib/contract", () => ({
  getListing: (...a: unknown[]) => mockGetListing(...a),
  getAuction: (...a: unknown[]) => mockGetAuction(...a),
}));
jest.mock("@/lib/ipfs", () => ({
  fetchMetadata: (...a: unknown[]) => mockFetchMetadata(...a),
}));

import { resolveArtwork, parseArtworkId } from "@/lib/resolveArtwork";

describe("resolveArtwork", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchListingById.mockResolvedValue(null);
    mockFetchAuctions.mockResolvedValue([]);
    mockGetListing.mockRejectedValue(new Error("not found"));
    mockGetAuction.mockRejectedValue(new Error("not found"));
  });

  it("returns the real listing for id 1 instead of placeholder content", async () => {
    mockFetchListingById.mockResolvedValue({
      listing_id: 1,
      artist: "GREALARTIST",
      metadata_cid: "QmReal",
      price: BigInt(5_000_000),
      status: "Active",
    });
    mockFetchMetadata.mockResolvedValue({
      title: "Real Artwork",
      image: "ipfs://QmImg",
    });

    const result = await resolveArtwork("1");

    expect(mockFetchListingById).toHaveBeenCalledWith(1);
    expect(result?.listing?.artist).toBe("GREALARTIST");
    expect(result?.metadata?.title).toBe("Real Artwork");
    expect(JSON.stringify(result)).not.toMatch(/unsplash|Ndebele Geometry/);
  });

  it.each(["1", "3", "6"])(
    "returns null for unresolvable id %s (no mock fallback)",
    async (id) => {
      expect(await resolveArtwork(id)).toBeNull();
    },
  );

  it("falls back to on-chain auctions", async () => {
    mockGetAuction.mockResolvedValue({ auction_id: 4, creator: "GC" });
    const result = await resolveArtwork("4");
    expect(result?.listing).toBeNull();
    expect(result?.auction?.auction_id).toBe(4);
  });

  it("keeps the listing when IPFS metadata cannot be fetched", async () => {
    mockGetListing.mockResolvedValue({ listing_id: 2, metadata_cid: "Qm" });
    mockFetchMetadata.mockRejectedValue(new Error("gateway down"));
    const result = await resolveArtwork("2");
    expect(result?.listing?.listing_id).toBe(2);
    expect(result?.metadata).toBeNull();
  });

  it("rejects non-numeric and non-positive ids without lookups", async () => {
    expect(parseArtworkId("abc")).toBeNull();
    expect(parseArtworkId("0")).toBeNull();
    expect(parseArtworkId("-1")).toBeNull();
    expect(parseArtworkId("12")).toBe(12);
    expect(await resolveArtwork("abc")).toBeNull();
    expect(mockFetchListingById).not.toHaveBeenCalled();
  });
});
