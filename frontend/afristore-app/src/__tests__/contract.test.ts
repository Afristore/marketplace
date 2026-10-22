import {
  stroopsToXlm,
  xlmToStroops,
  getAllListings,
  getAllAuctions,
} from "../lib/contract";

jest.mock("@/lib/e2e-chain-mock", () => ({
  isE2eMockChain: () => false,
  e2eMockCreateListing: jest.fn(),
  e2eMockBuyArtwork: jest.fn(),
  getE2eMockListings: jest.fn(),
  registerE2eMockListingsOnWindow: jest.fn(),
}));

jest.mock("@/lib/indexer", () => ({
  fetchListings: jest.fn(),
  fetchAuctions: jest.fn(),
}));

describe("xlmToStroops", () => {
  it("converts 0.0000001 XLM to 1 stroop (FP bug regression)", () => {
    // BigInt(Math.round(0.0000001 * 10_000_000)) === 0n due to FP drift;
    // xlmToStroops must return 1n
    expect(xlmToStroops(0.0000001)).toBe(1n);
  });

  it("converts whole XLM values", () => {
    expect(xlmToStroops(1)).toBe(10_000_000n);
    expect(xlmToStroops(50)).toBe(500_000_000n);
  });

  it("converts fractional XLM values", () => {
    expect(xlmToStroops(1.05)).toBe(10_500_000n);
    expect(xlmToStroops(0.5)).toBe(5_000_000n);
  });

  it("converts 0 XLM to 0 stroops", () => {
    expect(xlmToStroops(0)).toBe(0n);
  });
});

describe("stroopsToXlm", () => {
  it('correctly converts 0 stroops to "0"', () => {
    expect(stroopsToXlm(0n)).toBe("0");
  });

  it("correctly converts whole XLM values", () => {
    expect(stroopsToXlm(10_000_000n)).toBe("1");
    expect(stroopsToXlm(500_000_000n)).toBe("50");
  });

  it("correctly converts fractional XLM values", () => {
    expect(stroopsToXlm(10_500_000n)).toBe("1.05");
    expect(stroopsToXlm(10_000_001n)).toBe("1.0000001");
    expect(stroopsToXlm(1n)).toBe("0.0000001");
  });

  it("correctly handles negative values", () => {
    expect(stroopsToXlm(-10_500_000n)).toBe("-1.05");
    expect(stroopsToXlm(-1n)).toBe("-0.0000001");
    expect(stroopsToXlm(-10_000_000n)).toBe("-1");
  });

  it("preserves precision for extremely large values that would overflow JavaScript Number", () => {
    // 2^53 is 9_007_199_254_740_992. Let's use a much larger i128 value.
    const largeStroops = 123456789012345678901234567890n;
    // Division by 10_000_000n should give:
    // Whole: 12345678901234567890123n
    // Frac: 4567890n -> "456789"
    expect(stroopsToXlm(largeStroops)).toBe("12345678901234567890123.456789");
  });
});

describe("getAllListings — indexer path and error handling", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns empty array when indexer responds with { listings: [] }", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockResolvedValueOnce({ listings: [] });

      const result = await getAllListings();

      expect(result).toEqual([]);
      expect(fetchListings).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("returns listings from indexer without on-chain fallback", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      const mockListing = { listing_id: 1, artist: "GARTIST", status: "Active" };
      fetchListings.mockResolvedValueOnce({ listings: [mockListing] });

      const result = await getAllListings();

      expect(result).toEqual([mockListing]);
      expect(fetchListings).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to on-chain and rejects when indexer response has no listings field", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockResolvedValueOnce({ listings: null });

      // On-chain path will throw (no real RPC in unit tests)
      await expect(getAllListings()).rejects.toThrow();
      expect(fetchListings).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to on-chain and handles error when indexer call rejects", async () => {
    try {
      const { fetchListings } = jest.requireMock("@/lib/indexer");
      fetchListings.mockRejectedValueOnce(new Error("Indexer service down"));

      await expect(getAllListings()).rejects.toThrow();
      expect(fetchListings).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("getAllAuctions — indexer path and error handling", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns auctions from indexer when valid array returned", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      const mockAuction = { auction_id: 1, creator: "GCREATOR", status: "Active" };
      fetchAuctions.mockResolvedValueOnce([mockAuction]);

      const result = await getAllAuctions();

      expect(result).toEqual([mockAuction]);
      expect(fetchAuctions).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to on-chain and rejects when indexer returns empty auctions array", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockResolvedValueOnce([]);

      await expect(getAllAuctions()).rejects.toThrow();
      expect(fetchAuctions).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("falls back to on-chain and rejects when indexer fetchAuctions fails", async () => {
    try {
      const { fetchAuctions } = jest.requireMock("@/lib/indexer");
      fetchAuctions.mockRejectedValueOnce(new Error("Auction indexer unreachable"));

      await expect(getAllAuctions()).rejects.toThrow();
      expect(fetchAuctions).toHaveBeenCalledTimes(1);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
