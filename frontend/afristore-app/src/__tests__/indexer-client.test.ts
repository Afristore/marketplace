/**
 * Indexer client: tests use mocked HTTP (axios) and assert mapping + guards + error handling.
 */
import axios from "axios";
import {
  getWalletActivity,
  getRoyaltyStats,
  getListingActivity,
  getCollections,
  getCollection,
  fetchArtistListings,
  getWalletPreferences,
  putWalletPreferences,
  fetchMarketplaceStats,
  fetchListingById,
  getOwnedTokens,
} from "@/lib/indexer";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("getWalletActivity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  it("maps ARTWORK_SOLD to PURCHASE for the buyer address", async () => {
    try {
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 1,
            eventType: "ARTWORK_SOLD",
            actor: "GARTIST1",
            listingId: "42",
            data: { artist: "GARTIST1", buyer: "GUSER01", price: 5000000 },
            ledgerSequence: 1000,
            ledgerTimestamp: "2020-01-01T00:00:00.000Z",
          },
        ],
        status: 200,
      });

      const result = await getWalletActivity("GUSER01");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("PURCHASE");
      expect(result[0].listing_id).toBe(42);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns an empty list when the indexer is unreachable (graceful)", async () => {
    try {
      mockedAxios.get.mockRejectedValue(new Error("Network error"));
      const result = await getWalletActivity("GUSER01");
      expect(result).toEqual([]);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns an empty list when publicKey is empty or invalid", async () => {
    try {
      const result = await getWalletActivity("");
      expect(result).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("getRoyaltyStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  it("returns parsed body when the shape is valid", async () => {
    try {
      mockedAxios.get.mockResolvedValue({
        data: {
          totalEarned: "12.5",
          payoutCount: 3,
          lastPayout: 1700000000000,
        },
        status: 200,
      });
      const stats = await getRoyaltyStats("GARTIST1");
      expect(stats.totalEarned).toBe("12.5");
      expect(stats.payoutCount).toBe(3);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to zero stats on invalid payload", async () => {
    try {
      mockedAxios.get.mockResolvedValue({ data: { oops: true }, status: 200 });
      const stats = await getRoyaltyStats("GARTIST1");
      expect(stats.payoutCount).toBe(0);
      expect(stats.totalEarned).toBe("0");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to zero stats on indexer network failure", async () => {
    try {
      mockedAxios.get.mockRejectedValue(new Error("Timeout"));
      const stats = await getRoyaltyStats("GARTIST1");
      expect(stats.totalEarned).toBe("0");
      expect(stats.payoutCount).toBe(0);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns zero stats immediately for empty publicKey", async () => {
    try {
      const stats = await getRoyaltyStats("");
      expect(stats.totalEarned).toBe("0");
      expect(mockedAxios.get).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("getListingActivity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  it("returns mapped listing history events", async () => {
    try {
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 1,
            eventType: "LISTING_CREATED",
            actor: "GART",
            listingId: "5",
            data: { artist: "GART", price: 1000 },
            ledgerSequence: 10,
            ledgerTimestamp: "2020-01-01T00:00:00.000Z",
          },
        ],
        status: 200,
      });
      const ev = await getListingActivity(5);
      expect(ev[0].listing_id).toBe(5);
      expect(ev[0].type).toBe("LISTED");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns empty array when indexer encounters network error", async () => {
    try {
      mockedAxios.get.mockRejectedValue(new Error("500 Internal Error"));
      const ev = await getListingActivity(10);
      expect(ev).toEqual([]);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns empty array for non-finite listing ID", async () => {
    try {
      const ev = await getListingActivity(NaN);
      expect(ev).toEqual([]);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("getCollections and getCollection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  it("returns typed collection rows and total", async () => {
    try {
      mockedAxios.get.mockResolvedValue({
        data: [
          {
            id: 1,
            contractAddress: "CCONTRACT",
            kind: "normal_721",
            creator: "GART",
            name: "A",
            symbol: "A",
            deployedAtLedger: 1,
          },
          { not: "a collection row" },
        ],
        status: 200,
      });
      const { collections, total } = await getCollections();
      expect(total).toBe(1);
      expect(collections[0].kind).toBe("normal_721");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles network failure gracefully in getCollections", async () => {
    try {
      mockedAxios.get.mockRejectedValue(new Error("Connection refused"));
      const result = await getCollections();
      expect(result).toEqual({ collections: [], total: 0 });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("fetches single collection and handles errors in getCollection", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          id: 1,
          contractAddress: "CCONTRACT_EXACT",
          kind: "normal_721",
          creator: "GART",
          name: "Test",
          symbol: "T",
          deployedAtLedger: 5,
        },
        status: 200,
      });

      const col = await getCollection("CCONTRACT_EXACT");
      expect(col?.contractAddress).toBe("CCONTRACT_EXACT");

      // Error handling on network failure
      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));
      const failed = await getCollection("CCONTRACT_EXACT");
      expect(failed).toBeNull();

      // Empty string guard
      const empty = await getCollection("");
      expect(empty).toBeNull();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("fetchArtistListings and fetchListingById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
  });

  it("handles fetchArtistListings success and errors", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: [
          {
            listing_id: 1,
            price: "10000000",
            artist: "GARTIST",
            status: "Active",
          },
        ],
        status: 200,
      });

      const listings = await fetchArtistListings("GARTIST");
      expect(listings).toHaveLength(1);
      expect(listings[0].price).toBe(10000000n);

      mockedAxios.get.mockRejectedValueOnce(new Error("Network down"));
      const failed = await fetchArtistListings("GARTIST");
      expect(failed).toEqual([]);

      const empty = await fetchArtistListings("");
      expect(empty).toEqual([]);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles fetchListingById success and errors", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          listing_id: 2,
          price: "50000000",
          artist: "GARTIST2",
          status: "Active",
        },
        status: 200,
      });

      const item = await fetchListingById(2);
      expect(item?.listing_id).toBe(2);
      expect(item?.price).toBe(50000000n);

      mockedAxios.get.mockRejectedValueOnce(new Error("Not found"));
      const notFound = await fetchListingById(2);
      expect(notFound).toBeNull();

      const invalid = await fetchListingById(NaN);
      expect(invalid).toBeNull();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("preferences and stats error handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.get.mockReset();
    mockedAxios.put = jest.fn();
  });

  it("handles getWalletPreferences and putWalletPreferences errors", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: { theme: "dark", currency: "XLM" },
        status: 200,
      });
      const prefs = await getWalletPreferences("GWALLET");
      expect(prefs.theme).toBe("dark");

      mockedAxios.get.mockRejectedValueOnce(new Error("Server error"));
      const failedPrefs = await getWalletPreferences("GWALLET");
      expect(failedPrefs).toEqual({});

      expect(await getWalletPreferences("")).toEqual({});

      // putWalletPreferences throws error when server fails so caller can display feedback
      (mockedAxios.put as jest.Mock).mockRejectedValueOnce(new Error("Save failed"));
      await expect(
        putWalletPreferences("GWALLET", { theme: "dark" }),
      ).rejects.toThrow("Save failed");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles fetchMarketplaceStats success and error paths", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: { totalListings: 10, activeListings: 8, totalSales: 2 },
        status: 200,
      });
      const stats = await fetchMarketplaceStats();
      expect(stats?.totalListings).toBe(10);

      mockedAxios.get.mockRejectedValueOnce(new Error("Timeout"));
      const failed = await fetchMarketplaceStats();
      expect(failed).toBeNull();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("handles getOwnedTokens success, empty input, and re-throws on network failure", async () => {
    try {
      mockedAxios.get.mockResolvedValueOnce({
        data: [{ collectionAddress: "C1", tokenId: 1 }],
        status: 200,
      });
      const tokens = await getOwnedTokens("GWALLET");
      expect(tokens).toHaveLength(1);

      expect(await getOwnedTokens("")).toEqual([]);

      mockedAxios.get.mockRejectedValueOnce(new Error("Tokens fetch error"));
      await expect(getOwnedTokens("GWALLET")).rejects.toThrow(
        "Tokens fetch error",
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
