/**
 * Indexer client additions: owner-scoped listings (#1341) and auction
 * normalisation for the dashboard auctions tab (#1342).
 */
import axios from "axios";
import {
  fetchOwnedListings,
  fetchAuctions,
  normalizeAuction,
} from "@/lib/indexer";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("fetchOwnedListings", () => {
  beforeEach(() => mockedAxios.get.mockReset());

  it("queries by owner with no status filter and returns Sold listings", async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        listings: [
          { listing_id: "5", owner: "GBUYER", artist: "GART", price: "100", status: "Sold" },
        ],
        total: 1,
      },
      status: 200,
    });

    const rows = await fetchOwnedListings("GBUYER");

    const url = mockedAxios.get.mock.calls[0][0] as string;
    expect(url).toContain("/listings?owner=GBUYER");
    expect(url).not.toContain("status=");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("Sold");
    expect(rows[0].price).toBe(BigInt(100));
  });

  it("returns [] without a request for an empty owner", async () => {
    expect(await fetchOwnedListings("")).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it("propagates indexer errors", async () => {
    mockedAxios.get.mockRejectedValue(
      Object.assign(new Error("bad request"), {
        isAxiosError: true,
        response: { status: 400 },
      }),
    );
    await expect(fetchOwnedListings("GBUYER")).rejects.toThrow();
  });
});

describe("normalizeAuction", () => {
  it("maps raw camelCase indexer rows to the Auction shape", () => {
    const a = normalizeAuction({
      auctionId: "12",
      creator: "GCREATOR",
      collection: "CCOLL",
      nftTokenId: "3",
      amount: 1,
      token: "CTOKEN",
      metadataCid: "QmMeta",
      reservePrice: "50000000",
      highestBid: "75000000.0000000",
      highestBidder: "GBIDDER",
      endTime: "1700000000",
      status: "Active",
      recipients: [],
      createdAtLedger: 900,
    });
    expect(a).toMatchObject({
      auction_id: 12,
      creator: "GCREATOR",
      metadata_cid: "QmMeta",
      token_id: 3,
      reserve_price: BigInt(50_000_000),
      highest_bid: BigInt(75_000_000),
      highest_bidder: "GBIDDER",
      end_time: 1_700_000_000,
      status: "Active",
    });
  });

  it("accepts the snake_case shape and empty bidders", () => {
    const a = normalizeAuction({
      auction_id: 4,
      reserve_price: "10",
      highest_bid: "0",
      highest_bidder: null,
      end_time: 5,
      status: "Finalized",
    });
    expect(a.auction_id).toBe(4);
    expect(a.highest_bid).toBe(BigInt(0));
    expect(a.highest_bidder).toBeNull();
    expect(a.status).toBe("Finalized");
  });

  it("is applied by fetchAuctions", async () => {
    mockedAxios.get.mockReset();
    mockedAxios.get.mockResolvedValue({
      data: [{ auctionId: "8", reservePrice: "1", highestBid: "0", endTime: "9" }],
      status: 200,
    });
    const [a] = await fetchAuctions({ creator: "GC" });
    expect(a.auction_id).toBe(8);
    expect(a.end_time).toBe(9);
  });
});
