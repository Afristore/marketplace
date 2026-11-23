import {
  stroopsToXlm,
  xlmToStroops,
  getAllListings,
  getAllAuctions,
  invokeContract,
  createSyntheticAccount,
  getReadOnlyCallerPublicKey,
  READ_ONLY_CALLER_PUBLIC_KEY,
  getAdmin,
  getProtocolFee,
} from "../lib/contract";
import {
  resolveReadOnlyCaller,
  getCollectionCount,
  FALLBACK_READ_ONLY_PUBLIC_KEY,
} from "../lib/launchpad";
import { SorobanRpc, xdr, nativeToScVal, Address } from "@stellar/stellar-sdk";

jest.mock("../lib/freighter", () => ({
  getConnectedPublicKey: jest.fn().mockResolvedValue(null),
  signWithFreighter: jest.fn(),
}));

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

describe("Read-only simulation with synthetic account and unfunded wallets", () => {
  const unfundedPublicKey =
    "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createSyntheticAccount", () => {
    it("creates a synthetic Account with sequence '0' for a valid unfunded public key", () => {
      const account = createSyntheticAccount(unfundedPublicKey);
      expect(account.accountId()).toBe(unfundedPublicKey);
      expect(account.sequenceNumber()).toBe("0");
    });

    it("falls back to READ_ONLY_CALLER_PUBLIC_KEY when caller key is undefined or invalid", () => {
      const accountUndefined = createSyntheticAccount(undefined);
      expect(accountUndefined.accountId()).toBe(READ_ONLY_CALLER_PUBLIC_KEY);
      expect(accountUndefined.sequenceNumber()).toBe("0");

      const accountEmpty = createSyntheticAccount("");
      expect(accountEmpty.accountId()).toBe(READ_ONLY_CALLER_PUBLIC_KEY);

      const accountInvalid = createSyntheticAccount("INVALID_PUBLIC_KEY");
      expect(accountInvalid.accountId()).toBe(READ_ONLY_CALLER_PUBLIC_KEY);
    });
  });

  describe("getReadOnlyCallerPublicKey & resolveReadOnlyCaller", () => {
    it("returns connected public key when valid", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(unfundedPublicKey);

      const resolved = await getReadOnlyCallerPublicKey();
      expect(resolved).toBe(unfundedPublicKey);
    });

    it("falls back to READ_ONLY_CALLER_PUBLIC_KEY when wallet is not connected", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(null);

      const resolved = await getReadOnlyCallerPublicKey();
      expect(resolved).toBe(READ_ONLY_CALLER_PUBLIC_KEY);
    });

    it("falls back to READ_ONLY_CALLER_PUBLIC_KEY when connected key is malformed", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce("MALFORMED_KEY");

      const resolved = await getReadOnlyCallerPublicKey();
      expect(resolved).toBe(READ_ONLY_CALLER_PUBLIC_KEY);
    });

    it("resolveReadOnlyCaller from launchpad resolves connected key or fallback", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(unfundedPublicKey);

      const resolved = await resolveReadOnlyCaller();
      expect(resolved).toBe(unfundedPublicKey);
    });
  });

  describe("invokeContract — read-only vs state-changing with unfunded account", () => {
    let getAccountSpy: jest.SpyInstance;
    let simulateSpy: jest.SpyInstance;

    beforeEach(() => {
      // Mock getAccount to throw a 404 error (simulating an unfunded account on RPC)
      getAccountSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "getAccount")
        .mockRejectedValue(new Error("404 Not Found: account not found"));

      // Mock simulateTransaction to return a successful simulation
      simulateSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockResolvedValue({
          result: {
            retval: xdr.ScVal.scvU32(42),
          },
        } as any);
    });

    afterEach(() => {
      getAccountSpy.mockRestore();
      simulateSpy.mockRestore();
    });

    it("successfully simulates read-only queries with an unfunded account without calling getAccount", async () => {
      const result = await invokeContract(
        unfundedPublicKey,
        "dummy_query",
        [],
        true,
      );

      // Verify that rpc.getAccount was NEVER called
      expect(getAccountSpy).not.toHaveBeenCalled();

      // Verify simulateTransaction was called
      expect(simulateSpy).toHaveBeenCalledTimes(1);

      // Verify the returned value
      expect(result).toEqual(xdr.ScVal.scvU32(42));
    });

    it("successfully simulates read-only queries when caller key is empty/invalid using fallback synthetic account", async () => {
      const result = await invokeContract("", "dummy_query", [], true);

      expect(getAccountSpy).not.toHaveBeenCalled();
      expect(simulateSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual(xdr.ScVal.scvU32(42));
    });

    it("fails state-changing calls (readonly = false) with unfunded account because getAccount is required", async () => {
      await expect(
        invokeContract(unfundedPublicKey, "state_change", [], false),
      ).rejects.toThrow("404 Not Found: account not found");

      expect(getAccountSpy).toHaveBeenCalledWith(unfundedPublicKey);
      expect(simulateSpy).not.toHaveBeenCalled();
    });

    it("handles simulation error response gracefully on read-only calls", async () => {
      simulateSpy.mockResolvedValueOnce({
        error: "Contract execution trapped",
      } as any);

      await expect(
        invokeContract(unfundedPublicKey, "failing_query", [], true),
      ).rejects.toThrow();
    });
  });

  describe("read-only query helper methods with unfunded accounts", () => {
    let getAccountSpy: jest.SpyInstance;
    let simulateSpy: jest.SpyInstance;

    beforeEach(() => {
      getAccountSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "getAccount")
        .mockRejectedValue(new Error("404 Not Found: account not found"));
    });

    afterEach(() => {
      getAccountSpy.mockRestore();
      simulateSpy?.mockRestore();
    });

    it("getProtocolFee succeeds when user has unfunded connected wallet", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(unfundedPublicKey);

      simulateSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockResolvedValueOnce({
          result: {
            retval: nativeToScVal(250, { type: "u32" }),
          },
        } as any);

      const fee = await getProtocolFee();
      expect(fee).toBe(250);
      expect(getAccountSpy).not.toHaveBeenCalled();
      expect(simulateSpy).toHaveBeenCalledTimes(1);
    });

    it("getAdmin succeeds when user has unfunded connected wallet", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(unfundedPublicKey);

      const adminAddress = "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";
      simulateSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockResolvedValueOnce({
          result: {
            retval: new Address(adminAddress).toScVal(),
          },
        } as any);

      const admin = await getAdmin();
      expect(admin).toBe(adminAddress);
      expect(getAccountSpy).not.toHaveBeenCalled();
      expect(simulateSpy).toHaveBeenCalledTimes(1);
    });

    it("launchpad getCollectionCount succeeds with unfunded connected wallet", async () => {
      const { getConnectedPublicKey } = jest.requireMock("../lib/freighter");
      getConnectedPublicKey.mockResolvedValueOnce(unfundedPublicKey);

      simulateSpy = jest
        .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
        .mockResolvedValueOnce({
          result: {
            retval: nativeToScVal(15, { type: "u32" }),
          },
        } as any);

      const count = await getCollectionCount();
      expect(count).toBe(15);
      expect(getAccountSpy).not.toHaveBeenCalled();
      expect(simulateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
