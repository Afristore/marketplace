import {
  Keypair,
  StrKey,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";
import { createLendingListing } from "@/lib/lending";
import { invokeContract } from "@/lib/contract";
import { isE2eMockChain } from "@/lib/e2e-chain-mock";

jest.mock("@/lib/contract", () => ({
  invokeContract: jest.fn(),
}));

jest.mock("@/lib/freighter", () => ({
  getConnectedPublicKey: jest.fn(),
  signWithFreighter: jest.fn(),
}));

jest.mock("@/lib/e2e-chain-mock", () => ({
  isE2eMockChain: jest.fn(() => false),
  e2eMockWhitelistCurrency: jest.fn(),
  e2eMockUpdateBounds: jest.fn(),
  e2eMockLendingAdmin: jest.fn(),
}));

const mockInvokeContract = invokeContract as jest.Mock;
const mockIsE2eMockChain = isE2eMockChain as jest.Mock;

const LENDER = Keypair.random().publicKey();
const NFT_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1));

const input = {
  nftContract: NFT_CONTRACT,
  tokenId: 777,
  declaredPriceUsd: 1_000_000,
  interestScheduleBps: [500, 400],
  maxDurationDays: 30,
  minCollateralBufferBps: 1200,
  liquidationThresholdBps: 11000,
};

describe("createLendingListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsE2eMockChain.mockReturnValue(false);
  });

  it("invokes create_listing with the Rust entrypoint argument order", async () => {
    mockInvokeContract.mockResolvedValue(nativeToScVal(42, { type: "u64" }));

    const result = await createLendingListing(LENDER, input);

    expect(result).toBe(42);
    expect(mockInvokeContract).toHaveBeenCalledTimes(1);

    const [caller, method, args, readonly, contractId] =
      mockInvokeContract.mock.calls[0];
    expect(caller).toBe(LENDER);
    expect(method).toBe("create_listing");
    expect(readonly).toBe(false);
    expect(contractId).toBeTruthy();
    expect(args).toHaveLength(8);
    expect(scValToNative(args[2])).toBe(777n);
    expect(scValToNative(args[3])).toBe(1_000_000n);
    expect(scValToNative(args[4])).toEqual([500, 400]);
    expect(scValToNative(args[5])).toBe(30);
    expect(scValToNative(args[6])).toBe(1200);
    expect(scValToNative(args[7])).toBe(11000);
  });

  it("does not submit a transaction on the E2E mock chain", async () => {
    mockIsE2eMockChain.mockReturnValue(true);

    const result = await createLendingListing(LENDER, input);

    expect(result).toBeGreaterThan(0);
    expect(mockInvokeContract).not.toHaveBeenCalled();
  });
});
