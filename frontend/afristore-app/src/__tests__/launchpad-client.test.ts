import { deployNormal721 } from "../lib/launchpad";
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("maps deployNormal721 arguments correctly", async () => {
    (invokeContract as jest.Mock).mockResolvedValue(
      new Address(mockCreator).toScVal(),
    );

    await deployNormal721(
      mockCreator,
      "Test Collection",
      "TEST",
      1000,
      500,
      mockRoyaltyReceiver,
      mockSalt,
    );

    expect(invokeContract).toHaveBeenCalledWith(
      mockCreator,
      "deploy_normal_721",
      expect.any(Array),
      false,
      expect.any(String),
    );

    const args = (invokeContract as jest.Mock).mock.calls[0][2] as xdr.ScVal[];

    // Check name
    expect(scValToNative(args[1])).toBe("Test Collection");
    // Check symbol
    expect(scValToNative(args[2])).toBe("TEST");
    // Check maxSupply
    expect(scValToNative(args[3])).toBe(1000n);
    // Check royaltyBps
    expect(scValToNative(args[4])).toBe(500);
    // Check salt
    expect(scValToNative(args[6])).toEqual(Uint8Array.from(mockSalt));
  });

  it("handles errors from invokeContract", async () => {
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
  });
});
