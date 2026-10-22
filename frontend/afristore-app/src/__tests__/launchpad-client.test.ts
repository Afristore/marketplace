import {
  deployNormal721,
  deployNormal1155,
  deployLazy721,
  deployLazy1155,
  getCollectionsByCreator,
  getCollections,
  getCollectionRecordByAddress,
  getStakingPoolByNft,
  deployStakingPool,
  getCollectionCount,
  getPlatformFee,
  getLaunchpadAdmin,
  transferLaunchpadAdmin,
  updatePlatformFee,
  mint721,
  mint1155New,
  redeemLazy721,
  redeemLazy1155,
  parseLazy721VoucherJson,
  parseLazy1155VoucherJson,
} from "../lib/launchpad";
import { invokeContract } from "../lib/contract";
import { Address, xdr, scValToNative } from "@stellar/stellar-sdk";

// Mock invokeContract
jest.mock("../lib/contract", () => ({
  invokeContract: jest.fn(),
  getContract: jest.fn(),
}));

describe("Launchpad Client", () => {
  const mockCreator =
    "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";
  const mockCurrency =
    "CD3FSSR667WES5YVVUZZ22LFRQ2RB5NGJGGQEGSPP4OXWLJJV5EFHIIR";
  const mockRoyaltyReceiver =
    "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";
  const mockSalt = Buffer.alloc(32, 1);
  const mock32Bytes = Buffer.alloc(32, 2);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("deployNormal721", () => {
    it("maps deployNormal721 arguments correctly", async () => {
      try {
        (invokeContract as jest.Mock).mockResolvedValue(
          new Address(mockCreator).toScVal(),
        );

        const result = await deployNormal721(
          mockCreator,
          "Test Collection",
          "TEST",
          1000,
          500,
          mockRoyaltyReceiver,
          mockSalt,
        );

        expect(result).toBe(mockCreator);
        expect(invokeContract).toHaveBeenCalledWith(
          mockCreator,
          "deploy_normal_721",
          expect.any(Array),
          false,
          expect.any(String),
        );

        const args = (invokeContract as jest.Mock).mock.calls[0][2] as xdr.ScVal[];
        expect(scValToNative(args[1])).toBe("Test Collection");
        expect(scValToNative(args[2])).toBe("TEST");
        expect(scValToNative(args[3])).toBe(1000n);
        expect(scValToNative(args[4])).toBe(500);
        expect(scValToNative(args[6])).toEqual(Uint8Array.from(mockSalt));
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles errors from invokeContract", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Simulation failed"),
        );

        await expect(
          deployNormal721(
            mockCreator,
            "Test",
            "T",
            100,
            0,
            mockCreator,
            mockSalt,
          ),
        ).rejects.toThrow("Simulation failed");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("deployNormal1155", () => {
    it("maps deployNormal1155 arguments and returns address", async () => {
      try {
        (invokeContract as jest.Mock).mockResolvedValue(
          new Address(mockCreator).toScVal(),
        );

        const result = await deployNormal1155(
          mockCreator,
          "Test 1155",
          250,
          mockRoyaltyReceiver,
          mockSalt,
        );

        expect(result).toBe(mockCreator);
        expect(invokeContract).toHaveBeenCalledWith(
          mockCreator,
          "deploy_normal_1155",
          expect.any(Array),
          false,
          expect.any(String),
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles rejection when deployNormal1155 invocation fails", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Contract invocation failed"),
        );

        await expect(
          deployNormal1155(
            mockCreator,
            "Test 1155",
            250,
            mockRoyaltyReceiver,
            mockSalt,
          ),
        ).rejects.toThrow("Contract invocation failed");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("deployLazy721 and deployLazy1155", () => {
    it("handles deployLazy721 invocation and errors", async () => {
      try {
        (invokeContract as jest.Mock).mockResolvedValue(
          new Address(mockCreator).toScVal(),
        );

        const result = await deployLazy721(
          mockCreator,
          mock32Bytes,
          "Lazy 721",
          "L721",
          500,
          300,
          mockRoyaltyReceiver,
          mockSalt,
        );

        expect(result).toBe(mockCreator);

        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Failed to deploy lazy 721"),
        );
        await expect(
          deployLazy721(
            mockCreator,
            mock32Bytes,
            "Lazy 721",
            "L721",
            500,
            300,
            mockRoyaltyReceiver,
            mockSalt,
          ),
        ).rejects.toThrow("Failed to deploy lazy 721");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles deployLazy1155 invocation and errors", async () => {
      try {
        (invokeContract as jest.Mock).mockResolvedValue(
          new Address(mockCreator).toScVal(),
        );

        const result = await deployLazy1155(
          mockCreator,
          mock32Bytes,
          "Lazy 1155",
          300,
          mockRoyaltyReceiver,
          mockSalt,
        );

        expect(result).toBe(mockCreator);

        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Failed to deploy lazy 1155"),
        );
        await expect(
          deployLazy1155(
            mockCreator,
            mock32Bytes,
            "Lazy 1155",
            300,
            mockRoyaltyReceiver,
            mockSalt,
          ),
        ).rejects.toThrow("Failed to deploy lazy 1155");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("collection queries & record resolution", () => {
    it("returns null gracefully when getCollectionRecordByAddress fails", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Collection not found"),
        );

        const record = await getCollectionRecordByAddress(mockCreator);
        expect(record).toBeNull();
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles errors in getCollections and getCollectionsByCreator", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("RPC query failure"),
        );

        await expect(getCollections(0, 10)).rejects.toThrow("RPC query failure");
        await expect(getCollectionsByCreator(mockCreator)).rejects.toThrow(
          "RPC query failure",
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("staking pool operations", () => {
    it("handles getStakingPoolByNft and deployStakingPool errors", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Staking error"),
        );

        await expect(getStakingPoolByNft(mockCreator)).rejects.toThrow(
          "Staking error",
        );

        await expect(
          deployStakingPool(
            mockCreator,
            mockCreator,
            mockCurrency,
            100n,
            mockSalt,
          ),
        ).rejects.toThrow("Staking error");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("admin and fee management", () => {
    it("handles errors in getCollectionCount, getPlatformFee, and admin operations", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Admin query failure"),
        );

        await expect(getCollectionCount()).rejects.toThrow(
          "Admin query failure",
        );
        await expect(getPlatformFee()).rejects.toThrow("Admin query failure");
        await expect(getLaunchpadAdmin()).rejects.toThrow(
          "Admin query failure",
        );
        await expect(
          transferLaunchpadAdmin(mockCreator, mockRoyaltyReceiver),
        ).rejects.toThrow("Admin query failure");
        await expect(
          updatePlatformFee(mockCreator, mockRoyaltyReceiver, 300),
        ).rejects.toThrow("Admin query failure");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });

  describe("minting and voucher redemptions", () => {
    it("handles errors in mint721 and mint1155New", async () => {
      try {
        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Minting rejected"),
        );

        await expect(
          mint721(mockCreator, mockCreator, mockRoyaltyReceiver, "ipfs://cid"),
        ).rejects.toThrow("Minting rejected");

        await expect(
          mint1155New(
            mockCreator,
            mockCreator,
            mockRoyaltyReceiver,
            10n,
            "ipfs://cid",
          ),
        ).rejects.toThrow("Minting rejected");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("validates voucher JSON parsers and throws on malformed inputs", () => {
      expect(() => parseLazy721VoucherJson("invalid json")).toThrow(
        "Voucher is not valid JSON",
      );
      expect(() => parseLazy721VoucherJson("[]")).toThrow(
        "Voucher must be a JSON object",
      );
      expect(() =>
        parseLazy721VoucherJson(
          JSON.stringify({
            token_id: "1",
            price: "100",
            currency: mockCurrency,
          }),
        ),
      ).toThrow('Voucher: missing "uri"');

      expect(() => parseLazy1155VoucherJson("invalid json")).toThrow(
        "Voucher is not valid JSON",
      );
      expect(() =>
        parseLazy1155VoucherJson(
          JSON.stringify({
            token_id: "1",
            buyer_quota: "10",
          }),
        ),
      ).toThrow('Voucher: missing "price_per_unit"');
    });

    it("handles errors during redeemLazy721 and redeemLazy1155 invocation", async () => {
      try {
        const validVoucher721 = {
          token_id: "1",
          price: "1000",
          currency: mockCurrency,
          uri: "ipfs://test",
          uri_hash: "a".repeat(64),
          valid_until: "1700000000",
        };
        const validSig = "b".repeat(128);

        (invokeContract as jest.Mock).mockRejectedValue(
          new Error("Redeem failed on-chain"),
        );

        await expect(
          redeemLazy721(mockCreator, mockCreator, validVoucher721, validSig),
        ).rejects.toThrow("Redeem failed on-chain");

        const validVoucher1155 = {
          token_id: "1",
          buyer_quota: "5",
          price_per_unit: "200",
          currency: mockCurrency,
          uri: "ipfs://test1155",
          uri_hash: "a".repeat(64),
          valid_until: "1700000000",
        };

        await expect(
          redeemLazy1155(
            mockCreator,
            mockCreator,
            validVoucher1155,
            2n,
            validSig,
          ),
        ).rejects.toThrow("Redeem failed on-chain");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
});
