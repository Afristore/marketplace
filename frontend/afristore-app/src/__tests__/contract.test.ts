import {
  Account,
  Address,
  Contract,
  SorobanRpc,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { DEFAULT_TOKEN } from "@/config/tokens";

jest.mock("@/lib/config", () => ({
  config: {
    ...jest.requireActual("@/lib/config").config,
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    rpcUrl: "https://soroban-testnet.example",
  },
}));

import {
  createAuction,
  createListing,
  buyArtwork,
  invokeContract,
  stroopsToXlm,
  xlmToStroops,
  getAllListings,
  getAllAuctions,
  parseAuctionFromScVal,
  parseListingFromScVal,
  pollTransaction,
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

// ── Contract method serialization (#1307) ─────────────────────
// Each write method builds its ScVal argument list and hands it to
// invokeContract. We stop the flow at simulation: the simulation returns an
// error, so nothing is signed or submitted. The Contract.call spy records the
// method name and the exact ScVal arguments that were built.

const SERIALIZE_ARTIST = "GDUSNJ5OGLOZQ7X4XO2KDXMUKSNTNBHAOPYVZEERW7FQVQEIZ5BVTCRD";
const SERIALIZE_BUYER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const SERIALIZE_CO_ARTIST = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
const SERIALIZE_COLLECTION = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("contract method serialization (#1307)", () => {
  let callSpy: jest.SpyInstance;
  let accountSpy: jest.SpyInstance;
  let simulateSpy: jest.SpyInstance;

  beforeEach(() => {
    accountSpy = jest
      .spyOn(SorobanRpc.Server.prototype, "getAccount")
      .mockResolvedValue(new Account(SERIALIZE_ARTIST, "1") as never);
    // Simulation fails on purpose: invokeContract throws before signing.
    simulateSpy = jest
      .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({ error: "serialization-test-stop" } as never);
    callSpy = jest.spyOn(Contract.prototype, "call");
  });

  afterEach(() => {
    callSpy?.mockRestore?.();
    accountSpy?.mockRestore?.();
    simulateSpy?.mockRestore?.();
  });

  /** Runs a write method and returns the method name and its ScVal args. */
  async function captureCall(run: () => Promise<unknown>) {
    await expect(run()).rejects.toThrow();
    expect(callSpy).toHaveBeenCalledTimes(1);
    const [method, ...args] = callSpy.mock.calls[0] as [string, ...xdr.ScVal[]];
    return { method, args };
  }

  it("createListing sends eight typed arguments in contract order", async () => {
    const { method, args } = await captureCall(() =>
      createListing(
        SERIALIZE_ARTIST,
        1,
        DEFAULT_TOKEN.address,
        SERIALIZE_COLLECTION,
        5,
        3,
        [
          { address: SERIALIZE_ARTIST, percentage: 60 },
          { address: SERIALIZE_CO_ARTIST, percentage: 40 },
        ],
      ),
    );

    expect(method).toBe("create_listing");
    expect(args).toHaveLength(8);
    expect(args.map((arg) => arg.switch().name)).toEqual([
      "scvAddress",
      "scvI128",
      "scvSymbol",
      "scvAddress",
      "scvAddress",
      "scvU64",
      "scvU64",
      "scvVec",
    ]);
    expect(scValToNative(args[0])).toBe(SERIALIZE_ARTIST);
    expect(scValToNative(args[1])).toBe(10_000_000n);
    expect(scValToNative(args[2])).toBe(DEFAULT_TOKEN.symbol);
    expect(scValToNative(args[3])).toBe(DEFAULT_TOKEN.address);
    expect(scValToNative(args[4])).toBe(SERIALIZE_COLLECTION);
    expect(scValToNative(args[5])).toBe(5n);
    expect(scValToNative(args[6])).toBe(3n);

    const recipients = scValToNative(args[7]) as Array<{ address: string; percentage: unknown }>;
    expect(recipients.map((r) => r.address)).toEqual([SERIALIZE_ARTIST, SERIALIZE_CO_ARTIST]);
    expect(recipients.map((r) => Number(r.percentage))).toEqual([60, 40]);
  });

  it("createListing defaults recipients to 100% to the artist", async () => {
    const { args } = await captureCall(() =>
      createListing(SERIALIZE_ARTIST, 2, DEFAULT_TOKEN.address, SERIALIZE_COLLECTION, 9),
    );

    expect(scValToNative(args[6])).toBe(1n);
    const recipients = scValToNative(args[7]) as Array<{ address: string; percentage: unknown }>;
    expect(recipients).toHaveLength(1);
    expect(recipients[0].address).toBe(SERIALIZE_ARTIST);
    expect(Number(recipients[0].percentage)).toBe(100);
  });

  it("createAuction sends seven typed arguments with the royalty as u32", async () => {
    const cid = "QmSerializeCid";
    const { method, args } = await captureCall(() =>
      createAuction(
        SERIALIZE_ARTIST,
        cid,
        2,
        3600,
        500,
        [{ address: SERIALIZE_ARTIST, percentage: 100 }],
        DEFAULT_TOKEN.address,
      ),
    );

    expect(method).toBe("create_auction");
    expect(args).toHaveLength(7);
    expect(args.map((arg) => arg.switch().name)).toEqual([
      "scvAddress",
      "scvBytes",
      "scvAddress",
      "scvI128",
      "scvU64",
      "scvU32",
      "scvVec",
    ]);
    expect(scValToNative(args[0])).toBe(SERIALIZE_ARTIST);
    expect(Buffer.from(scValToNative(args[1]) as Uint8Array).toString("utf-8")).toBe(cid);
    expect(scValToNative(args[2])).toBe(DEFAULT_TOKEN.address);
    expect(scValToNative(args[3])).toBe(20_000_000n);
    expect(scValToNative(args[4])).toBe(3600n);
    expect(scValToNative(args[5])).toBe(500);
  });

  it("buyArtwork sends the buyer address and the listing id as u64", async () => {
    const { method, args } = await captureCall(() => buyArtwork(SERIALIZE_BUYER, 42));

    expect(method).toBe("buy_artwork");
    expect(args.map((arg) => arg.switch().name)).toEqual(["scvAddress", "scvU64"]);
    expect(scValToNative(args[0])).toBe(SERIALIZE_BUYER);
    expect(scValToNative(args[1])).toBe(42n);
  });
});

describe("read-only simulation with unfunded accounts (#1171)", () => {
  let accountSpy: jest.SpyInstance;
  let simulateSpy: jest.SpyInstance;

  beforeEach(() => {
    accountSpy = jest
      .spyOn(SorobanRpc.Server.prototype, "getAccount")
      .mockRejectedValue(new Error("Account not found (404)"));
    simulateSpy = jest
      .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({
        result: { retval: xdr.ScVal.scvU64(new xdr.Uint64(7)) },
      } as never);
  });

  afterEach(() => {
    accountSpy.mockRestore();
    simulateSpy.mockRestore();
  });

  it("succeeds for readonly calls with an unfunded caller without calling getAccount", async () => {
    const retval = await invokeContract(
      SERIALIZE_BUYER,
      "listing_count",
      [],
      true,
    );

    expect(accountSpy).not.toHaveBeenCalled();
    expect(simulateSpy).toHaveBeenCalledTimes(1);
    expect(scValToNative(retval)).toBe(7n);
  });

  it("falls back to an ephemeral key when callerPublicKey is empty on readonly calls", async () => {
    const retval = await invokeContract("", "listing_count", [], true);

    expect(accountSpy).not.toHaveBeenCalled();
    expect(simulateSpy).toHaveBeenCalledTimes(1);
    expect(scValToNative(retval)).toBe(7n);
  });
});

describe("pollTransaction (#1335)", () => {
  const NOT_FOUND = { status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND };

  it("returns as soon as the transaction leaves NOT_FOUND", async () => {
    const success = { status: SorobanRpc.Api.GetTransactionStatus.SUCCESS };
    const getTransaction = jest
      .fn()
      .mockResolvedValueOnce(NOT_FOUND)
      .mockResolvedValueOnce(success);
    await expect(
      pollTransaction({ getTransaction } as any, "abc", { intervalMs: 0 }),
    ).resolves.toBe(success);
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });

  it("throws with the hash after the attempt limit instead of hanging", async () => {
    const getTransaction = jest.fn().mockResolvedValue(NOT_FOUND);
    await expect(
      pollTransaction({ getTransaction } as any, "deadbeef", {
        attempts: 3,
        intervalMs: 0,
      }),
    ).rejects.toThrow(/deadbeef.*3 attempts/);
    expect(getTransaction).toHaveBeenCalledTimes(3);
  });
});

// ── ScVal struct parsing (#1331) ──────────────────────────────
// The Rust Listing/Auction structs serialize the NFT id as `token_id`
// (not `nft_token_id`), and Auction has no `created_at`. These fixtures are
// real ScVals fed through the production scValToNative path, guarding the
// documented on-chain fallback reads used when the indexer is unavailable.

describe("ScVal struct parsing (#1331)", () => {
  const mapEntry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

  const recipientEntry = (address: string, percentage: number) =>
    xdr.ScVal.scvMap([
      mapEntry("address", new Address(address).toScVal()),
      mapEntry("percentage", nativeToScVal(percentage, { type: "u32" })),
    ]);

  /** Mirrors how the contract serializes a `Listing` struct. */
  function listingScVal(): xdr.ScVal {
    return xdr.ScVal.scvMap([
      mapEntry("listing_id", nativeToScVal(42n, { type: "u64" })),
      mapEntry("artist", new Address(SERIALIZE_ARTIST).toScVal()),
      mapEntry("price", nativeToScVal(250_000_000n, { type: "i128" })),
      mapEntry("currency", nativeToScVal("XLM", { type: "symbol" })),
      mapEntry("token", new Address(DEFAULT_TOKEN.address).toScVal()),
      mapEntry("collection", new Address(SERIALIZE_COLLECTION).toScVal()),
      mapEntry("token_id", nativeToScVal(7n, { type: "u64" })),
      mapEntry("amount", nativeToScVal(3n, { type: "u64" })),
      mapEntry(
        "recipients",
        xdr.ScVal.scvVec([
          recipientEntry(SERIALIZE_ARTIST, 60),
          recipientEntry(SERIALIZE_CO_ARTIST, 40),
        ]),
      ),
      mapEntry("status", nativeToScVal("Active", { type: "symbol" })),
      mapEntry("owner", xdr.ScVal.scvVoid()), // Option::None
      mapEntry("created_at", nativeToScVal(1_700_000_000, { type: "u32" })),
    ]);
  }

  /** Mirrors how the contract serializes an `Auction` struct. */
  function auctionScVal(): xdr.ScVal {
    return xdr.ScVal.scvMap([
      mapEntry("auction_id", nativeToScVal(11n, { type: "u64" })),
      mapEntry("creator", new Address(SERIALIZE_ARTIST).toScVal()),
      mapEntry("token", new Address(DEFAULT_TOKEN.address).toScVal()),
      mapEntry("collection", new Address(SERIALIZE_COLLECTION).toScVal()),
      mapEntry("token_id", nativeToScVal(9n, { type: "u64" })),
      mapEntry("amount", nativeToScVal(1n, { type: "u64" })),
      mapEntry("reserve_price", nativeToScVal(5_000_000n, { type: "i128" })),
      mapEntry("highest_bid", nativeToScVal(8_000_000n, { type: "i128" })),
      mapEntry("highest_bidder", new Address(SERIALIZE_BUYER).toScVal()),
      mapEntry("end_time", nativeToScVal(1_800_000_000n, { type: "u64" })),
      mapEntry("status", nativeToScVal("Active", { type: "symbol" })),
      mapEntry(
        "recipients",
        xdr.ScVal.scvVec([recipientEntry(SERIALIZE_ARTIST, 100)]),
      ),
    ]);
  }

  it("parseListingFromScVal reads token_id (not nft_token_id) and created_at", () => {
    expect(parseListingFromScVal(listingScVal())).toEqual({
      listing_id: 42,
      artist: SERIALIZE_ARTIST,
      collection: SERIALIZE_COLLECTION,
      token_id: 7,
      amount: 3,
      price: 250_000_000n,
      currency: "XLM",
      token: DEFAULT_TOKEN.address,
      recipients: [
        { address: SERIALIZE_ARTIST, percentage: 60 },
        { address: SERIALIZE_CO_ARTIST, percentage: 40 },
      ],
      status: "Active",
      owner: null,
      created_at: 1_700_000_000,
    });
  });

  it("parseAuctionFromScVal reads token_id and defaults created_at to 0", () => {
    expect(parseAuctionFromScVal(auctionScVal())).toEqual({
      auction_id: 11,
      creator: SERIALIZE_ARTIST,
      collection: SERIALIZE_COLLECTION,
      token_id: 9,
      amount: 1,
      token: DEFAULT_TOKEN.address,
      reserve_price: 5_000_000n,
      highest_bid: 8_000_000n,
      highest_bidder: SERIALIZE_BUYER,
      end_time: 1_800_000_000,
      status: "Active",
      recipients: [{ address: SERIALIZE_ARTIST, percentage: 100 }],
      created_at: 0,
    });
  });

  it("never yields token_id: NaN on the on-chain fallback", () => {
    expect(Number.isNaN(parseListingFromScVal(listingScVal()).token_id)).toBe(
      false,
    );
    expect(Number.isNaN(parseAuctionFromScVal(auctionScVal()).token_id)).toBe(
      false,
    );
  });
});
