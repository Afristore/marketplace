import { act, renderHook, waitFor } from "@testing-library/react";
import { useCreateLendingListing } from "@/hooks/mutations/useCreateLendingListing";
import type { CreateLendingListingInput } from "@/lib/lendingValidation";

const mockPushToast = jest.fn();
const mockCreateLendingListing = jest.fn();
const mockGetNftOwner = jest.fn();
const mockGetConfig = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/lending", () => ({
  createLendingListing: (...args: unknown[]) => mockCreateLendingListing(...args),
  getNftOwner: (...args: unknown[]) => mockGetNftOwner(...args),
  getLendingPlatformConfig: () => mockGetConfig(),
  getLendingContractId: () => "CLENDING",
}));

const LENDER = "GLENDER";

const input: CreateLendingListingInput = {
  nftContract: "CNFT",
  tokenId: 7,
  declaredPriceUsd: 2_500_000_000n,
  interestScheduleBps: [300, 350],
  maxDurationDays: 90,
  minCollateralBufferBps: 12000,
  liquidationThresholdBps: 11000,
};

const platformConfig = {
  min_buffer_bps: 12000,
  max_buffer_bps: 20000,
  min_liq_threshold_bps: 10500,
  max_liq_threshold_bps: 12000,
};

async function runCreate(
  hook: ReturnType<typeof useCreateLendingListing>,
  value: CreateLendingListingInput = input,
): Promise<number | null> {
  let result: number | null = null;
  await act(async () => {
    result = await hook.create(value);
  });
  return result;
}

describe("useCreateLendingListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue(platformConfig);
    mockGetNftOwner.mockResolvedValue(LENDER);
    mockCreateLendingListing.mockResolvedValue(5);
  });

  it("validates, checks ownership, submits and raises a success toast", async () => {
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBe(5);

    expect(mockGetNftOwner).toHaveBeenCalledWith(LENDER, "CNFT", 7);
    expect(mockCreateLendingListing).toHaveBeenCalledWith(LENDER, input);
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith("Lending listing #5 created", "success"),
    );
    expect(result.current.error).toBeNull();
  });

  it("refuses to run without a connected wallet", async () => {
    const { result } = renderHook(() => useCreateLendingListing(null));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toBe("Wallet not connected");
    expect(mockCreateLendingListing).not.toHaveBeenCalled();
  });

  it("rejects terms outside the platform bounds before any transaction", async () => {
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(
      runCreate(result.current, { ...input, minCollateralBufferBps: 25000 }),
    ).resolves.toBeNull();

    expect(result.current.error).toBe(
      "Collateral buffer must be between 12000 and 20000 bps",
    );
    expect(mockGetNftOwner).not.toHaveBeenCalled();
    expect(mockCreateLendingListing).not.toHaveBeenCalled();
  });

  it("still validates basic terms when the platform config is unreadable", async () => {
    mockGetConfig.mockResolvedValue(null);
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(
      runCreate(result.current, { ...input, interestScheduleBps: [] }),
    ).resolves.toBeNull();

    expect(result.current.error).toBe("Add at least one monthly interest rate");
    expect(mockCreateLendingListing).not.toHaveBeenCalled();
  });

  it("stops before signing when the lender does not own the NFT (#1270)", async () => {
    mockGetNftOwner.mockResolvedValue("GSOMEONEELSE");
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toMatch(/not in your connected wallet/);
    expect(mockCreateLendingListing).not.toHaveBeenCalled();
  });

  it("explains when the NFT is already escrowed in the lending contract", async () => {
    mockGetNftOwner.mockResolvedValue("CLENDING");
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toMatch(/already escrowed/);
    expect(mockCreateLendingListing).not.toHaveBeenCalled();
  });

  it("explains when the NFT cannot be found", async () => {
    mockGetNftOwner.mockResolvedValue(null);
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toMatch(/Could not find this NFT/);
  });

  it("treats a declined signature as a dismissal, not an error", async () => {
    mockCreateLendingListing.mockRejectedValue(new Error("User declined access"));
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toBeNull();
    expect(mockPushToast).toHaveBeenCalledWith("Lending listing dismissed.", "info");
  });

  it("surfaces a readable error when the transaction fails", async () => {
    mockCreateLendingListing.mockRejectedValue(new Error("Transaction failed on-chain."));
    const { result } = renderHook(() => useCreateLendingListing(LENDER));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(result.current.error).toBeTruthy();
    expect(result.current.isCreating).toBe(false);
  });
});
