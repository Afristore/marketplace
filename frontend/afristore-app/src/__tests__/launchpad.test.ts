import {
  deployNormal721,
  deployNormal1155,
  deployLazy721,
  deployLazy1155,
  generateSalt,
  validateDeployParams,
} from "../lib/launchpad";
import { invokeContract } from "../lib/contract";
import { isE2eMockChain, e2eMockDeployCollection } from "../lib/e2e-chain-mock";
import { Address, xdr, scValToNative } from "@stellar/stellar-sdk";

// Mock invokeContract and e2e chain mock
jest.mock("../lib/contract", () => ({
  invokeContract: jest.fn(),
}));

jest.mock("../lib/e2e-chain-mock", () => ({
  isE2eMockChain: jest.fn(),
  e2eMockDeployCollection: jest.fn(),
}));

describe("launchpad.ts — Collection Deployment Client Helpers", () => {
  const mockCreator =
    "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";
  const mockRoyaltyReceiver =
    "GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F";
  const mockDeployedContract =
    "CD3FSSR667WES5YVVUZZ22LFRQ2RB5NGJGGQEGSPP4OXWLJJV5EFHIIR";
  const mockSalt = Buffer.alloc(32, 7);
  const mockCreatorPubkeyBytes = Buffer.alloc(32, 9);

  beforeEach(() => {
    jest.clearAllMocks();
    (isE2eMockChain as jest.Mock).mockReturnValue(false);
  });

  describe("generateSalt", () => {
    it("generates a 32-byte Buffer", () => {
      const salt = generateSalt();
      expect(Buffer.isBuffer(salt)).toBe(true);
      expect(salt.length).toBe(32);
    });

    it("generates distinct random values across calls", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1.equals(salt2)).toBe(false);
    });
  });

  describe("validateDeployParams", () => {
    it("passes for valid parameters", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: 500,
          salt: mockSalt,
          maxSupply: 1000,
        })
      ).not.toThrow();
    });

    it("throws if creatorPublicKey is missing or empty", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: "",
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: 500,
          salt: mockSalt,
        })
      ).toThrow("Creator public key is required");
    });

    it("throws if royaltyReceiver is missing or empty", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: "   ",
          royaltyBps: 500,
          salt: mockSalt,
        })
      ).toThrow("Royalty receiver is required");
    });

    it("throws if royaltyBps is negative or exceeds 10000 (100%)", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: -1,
          salt: mockSalt,
        })
      ).toThrow("royaltyBps must be between 0 and 10000");

      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: 10001,
          salt: mockSalt,
        })
      ).toThrow("royaltyBps must be between 0 and 10000");
    });

    it("throws if salt length is not exactly 32 bytes", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: 500,
          salt: Buffer.alloc(16),
        })
      ).toThrow("Salt must be exactly 32 bytes");
    });

    it("throws if maxSupply is 0 or negative", () => {
      expect(() =>
        validateDeployParams({
          creatorPublicKey: mockCreator,
          royaltyReceiver: mockRoyaltyReceiver,
          royaltyBps: 500,
          salt: mockSalt,
          maxSupply: 0,
        })
      ).toThrow("maxSupply must be greater than 0");
    });
  });

  describe("deployNormal721", () => {
    it("builds correct ScVal arguments and invokes contract successfully", async () => {
      (invokeContract as jest.Mock).mockResolvedValue(
        new Address(mockDeployedContract).toScVal()
      );

      const address = await deployNormal721(
        mockCreator,
        "African Masks 721",
        "MSK",
        500,
        250,
        mockRoyaltyReceiver,
        mockSalt
      );

      expect(address).toBe(mockDeployedContract);
      expect(invokeContract).toHaveBeenCalledTimes(1);

      const [caller, method, args, isReadOnly] = (invokeContract as jest.Mock)
        .mock.calls[0];
      expect(caller).toBe(mockCreator);
      expect(method).toBe("deploy_normal_721");
      expect(isReadOnly).toBe(false);

      expect(scValToNative(args[1])).toBe("African Masks 721");
      expect(scValToNative(args[2])).toBe("MSK");
      expect(scValToNative(args[3])).toBe(500n);
      expect(scValToNative(args[4])).toBe(250);
      expect(scValToNative(args[6])).toEqual(Uint8Array.from(mockSalt));
    });

    it("rejects immediately on invalid parameters without invoking contract", async () => {
      await expect(
        deployNormal721(
          mockCreator,
          "Invalid",
          "INV",
          -10, // Invalid maxSupply
          250,
          mockRoyaltyReceiver,
          mockSalt
        )
      ).rejects.toThrow("maxSupply must be greater than 0");

      expect(invokeContract).not.toHaveBeenCalled();
    });

    it("routes through e2eMockDeployCollection when e2e mock chain is active", async () => {
      (isE2eMockChain as jest.Mock).mockReturnValue(true);
      (e2eMockDeployCollection as jest.Mock).mockResolvedValue(
        "MOCK_721_CONTRACT"
      );

      const res = await deployNormal721(
        mockCreator,
        "Mock 721",
        "MCK",
        100,
        500,
        mockRoyaltyReceiver,
        mockSalt
      );

      expect(res).toBe("MOCK_721_CONTRACT");
      expect(e2eMockDeployCollection).toHaveBeenCalledWith(
        mockCreator,
        "Mock 721",
        "MCK",
        100,
        500,
        mockRoyaltyReceiver
      );
      expect(invokeContract).not.toHaveBeenCalled();
    });
  });

  describe("deployNormal1155", () => {
    it("builds correct ScVal arguments and returns deployed address", async () => {
      (invokeContract as jest.Mock).mockResolvedValue(
        new Address(mockDeployedContract).toScVal()
      );

      const address = await deployNormal1155(
        mockCreator,
        "African Beads 1155",
        300,
        mockRoyaltyReceiver,
        mockSalt
      );

      expect(address).toBe(mockDeployedContract);
      expect(invokeContract).toHaveBeenCalledWith(
        mockCreator,
        "deploy_normal_1155",
        expect.any(Array),
        false,
        expect.any(String)
      );

      const args = (invokeContract as jest.Mock).mock.calls[0][2] as xdr.ScVal[];
      expect(scValToNative(args[1])).toBe("African Beads 1155");
      expect(scValToNative(args[2])).toBe(300);
      expect(scValToNative(args[4])).toEqual(Uint8Array.from(mockSalt));
    });

    it("rejects on invalid salt size", async () => {
      await expect(
        deployNormal1155(
          mockCreator,
          "Bad Salt",
          300,
          mockRoyaltyReceiver,
          Buffer.alloc(10)
        )
      ).rejects.toThrow("Salt must be exactly 32 bytes");
    });
  });

  describe("deployLazy721", () => {
    it("passes creator pubkey bytes and parameters to deploy_lazy_721", async () => {
      (invokeContract as jest.Mock).mockResolvedValue(
        new Address(mockDeployedContract).toScVal()
      );

      const address = await deployLazy721(
        mockCreator,
        mockCreatorPubkeyBytes,
        "Lazy Art 721",
        "LZY",
        1000,
        750,
        mockRoyaltyReceiver,
        mockSalt
      );

      expect(address).toBe(mockDeployedContract);
      const args = (invokeContract as jest.Mock).mock.calls[0][2] as xdr.ScVal[];
      expect(scValToNative(args[1])).toEqual(
        Uint8Array.from(mockCreatorPubkeyBytes)
      );
      expect(scValToNative(args[2])).toBe("Lazy Art 721");
      expect(scValToNative(args[3])).toBe("LZY");
      expect(scValToNative(args[4])).toBe(1000n);
      expect(scValToNative(args[5])).toBe(750);
      expect(scValToNative(args[7])).toEqual(Uint8Array.from(mockSalt));
    });
  });

  describe("deployLazy1155", () => {
    it("passes creator pubkey bytes and parameters to deploy_lazy_1155", async () => {
      (invokeContract as jest.Mock).mockResolvedValue(
        new Address(mockDeployedContract).toScVal()
      );

      const address = await deployLazy1155(
        mockCreator,
        mockCreatorPubkeyBytes,
        "Lazy Multi 1155",
        400,
        mockRoyaltyReceiver,
        mockSalt
      );

      expect(address).toBe(mockDeployedContract);
      const args = (invokeContract as jest.Mock).mock.calls[0][2] as xdr.ScVal[];
      expect(scValToNative(args[1])).toEqual(
        Uint8Array.from(mockCreatorPubkeyBytes)
      );
      expect(scValToNative(args[2])).toBe("Lazy Multi 1155");
      expect(scValToNative(args[3])).toBe(400);
      expect(scValToNative(args[5])).toEqual(Uint8Array.from(mockSalt));
    });

    it("propagates Soroban invocation failures", async () => {
      (invokeContract as jest.Mock).mockRejectedValue(
        new Error("Soroban HostError: Error(Contract, #12)")
      );

      await expect(
        deployLazy1155(
          mockCreator,
          mockCreatorPubkeyBytes,
          "Failed",
          400,
          mockRoyaltyReceiver,
          mockSalt
        )
      ).rejects.toThrow("Soroban HostError");
    });
  });
});
