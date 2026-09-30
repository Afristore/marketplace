import { act, renderHook, waitFor } from "@testing-library/react";
import { useCreateListing } from "@/hooks/mutations/useCreateListing";
import type { CreateListingInput } from "@/hooks/mutations/useCreateListing";

const mockPushToast = jest.fn();
const mockCreateListing = jest.fn();
const mockAssertSupportedTokenAddress = jest.fn();
const mockListingCreated = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/contract", () => ({
  createListing: (...args: unknown[]) => mockCreateListing(...args),
}));

jest.mock("@/lib/token-support", () => ({
  assertSupportedTokenAddress: (...args: unknown[]) =>
    mockAssertSupportedTokenAddress(...args),
}));

jest.mock("@/providers/PostHogProvider", () => ({
  trackEvent: {
    listingCreated: (...args: unknown[]) => mockListingCreated(...args),
  },
}));

const ARTIST = "GARTIST";
const TOKEN = { address: "CTOKEN", symbol: "XLM" };

const INPUT: CreateListingInput = {
  collectionAddress: "CCOLLECTION",
  nftTokenId: 7,
  price: 100,
  tokenAddress: "CTOKEN",
};

async function runCreate(
  hook: ReturnType<typeof useCreateListing>,
  input: CreateListingInput = INPUT,
): Promise<number | null> {
  let result: number | null = null;
  await act(async () => {
    result = await hook.create(input);
  });
  return result;
}

describe("useCreateListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertSupportedTokenAddress.mockResolvedValue(TOKEN);
    mockCreateListing.mockResolvedValue(99);
  });

  it("simulates + submits via createListing and raises a success toast", async () => {
    const { result } = renderHook(() => useCreateListing(ARTIST));

    await expect(runCreate(result.current)).resolves.toBe(99);

    expect(mockCreateListing).toHaveBeenCalledWith(
      ARTIST,
      100,
      "CTOKEN",
      "CCOLLECTION",
      7,
    );
    expect(mockListingCreated).toHaveBeenCalledWith(99, "100", "XLM");
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith("Listing #99 created", "success"),
    );
  });

  it("refuses to run without a connected wallet and never builds a transaction", async () => {
    const { result } = renderHook(() => useCreateListing(null));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(mockAssertSupportedTokenAddress).not.toHaveBeenCalled();
    expect(mockCreateListing).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith("Wallet not connected", "error"),
    );
  });

  it("surfaces a failed simulation as an error toast and returns null", async () => {
    mockCreateListing.mockRejectedValueOnce(
      new Error("Unable to simulate this transaction."),
    );
    const { result } = renderHook(() => useCreateListing(ARTIST));

    await expect(runCreate(result.current)).resolves.toBeNull();

    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Unable to simulate this transaction.",
        "error",
      ),
    );
    expect(mockPushToast).not.toHaveBeenCalledWith(
      expect.anything(),
      "success",
    );
  });

  it("treats a declined wallet signature as a normal, non-error cancellation", async () => {
    mockCreateListing.mockRejectedValueOnce(new Error("User declined access"));
    const { result } = renderHook(() => useCreateListing(ARTIST));

    await expect(runCreate(result.current)).resolves.toBeNull();

    expect(mockPushToast).toHaveBeenCalledWith(
      "Listing creation cancelled.",
      "info",
    );
    expect(mockPushToast).not.toHaveBeenCalledWith(expect.anything(), "error");
    expect(result.current.error).toBeNull();
  });

  it("surfaces a submission failure as an error toast and returns null", async () => {
    mockCreateListing.mockRejectedValueOnce(
      new Error("Transaction submission failed."),
    );
    const { result } = renderHook(() => useCreateListing(ARTIST));

    await expect(runCreate(result.current)).resolves.toBeNull();

    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Transaction submission failed.",
        "error",
      ),
    );
  });
});
