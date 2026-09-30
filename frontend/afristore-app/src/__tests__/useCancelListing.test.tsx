import { act, renderHook, waitFor } from "@testing-library/react";
import { useCancelListing } from "@/hooks/mutations/useCancelListing";

const mockPushToast = jest.fn();
const mockCancelListing = jest.fn();

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

jest.mock("@/lib/contract", () => ({
  cancelListing: (...args: unknown[]) => mockCancelListing(...args),
}));

const ARTIST = "GARTIST";
const LISTING_ID = 42;

async function runCancel(
  hook: ReturnType<typeof useCancelListing>,
  listingId: number = LISTING_ID,
): Promise<boolean> {
  let result = false;
  await act(async () => {
    result = await hook.cancel(listingId);
  });
  return result;
}

describe("useCancelListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelListing.mockResolvedValue(true);
  });

  it("simulates + submits via cancelListing and raises a success toast", async () => {
    const { result } = renderHook(() => useCancelListing(ARTIST));

    await expect(runCancel(result.current)).resolves.toBe(true);

    expect(mockCancelListing).toHaveBeenCalledWith(ARTIST, LISTING_ID);
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        `Listing #${LISTING_ID} cancelled`,
        "success",
      ),
    );
  });

  it("refuses to run without a connected wallet and never builds a transaction", async () => {
    const { result } = renderHook(() => useCancelListing(null));

    await expect(runCancel(result.current)).resolves.toBe(false);

    expect(mockCancelListing).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith("Wallet not connected", "error"),
    );
  });

  it("surfaces a failed simulation as an error toast and returns false", async () => {
    mockCancelListing.mockRejectedValueOnce(
      new Error("Unable to simulate this transaction."),
    );
    const { result } = renderHook(() => useCancelListing(ARTIST));

    await expect(runCancel(result.current)).resolves.toBe(false);

    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Unable to simulate this transaction.",
        "error",
      ),
    );
    expect(mockPushToast).not.toHaveBeenCalledWith(expect.anything(), "success");
  });

  it("maps a contract rejection to its readable, cancel-specific message", async () => {
    mockCancelListing.mockRejectedValueOnce(
      new Error("HostError: Error(Contract, #5)"),
    );
    const { result } = renderHook(() => useCancelListing(ARTIST));

    await expect(runCancel(result.current)).resolves.toBe(false);

    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "You are not authorized to perform this action. (code 5)",
        "error",
      ),
    );
  });

  it("treats a declined wallet signature as a normal, non-error cancellation", async () => {
    mockCancelListing.mockRejectedValueOnce(new Error("User declined access"));
    const { result } = renderHook(() => useCancelListing(ARTIST));

    await expect(runCancel(result.current)).resolves.toBe(false);

    expect(mockPushToast).toHaveBeenCalledWith(
      "Listing cancellation dismissed.",
      "info",
    );
    expect(mockPushToast).not.toHaveBeenCalledWith(expect.anything(), "error");
    expect(result.current.error).toBeNull();
  });

  it("surfaces a submission failure as an error toast and returns false", async () => {
    mockCancelListing.mockRejectedValueOnce(
      new Error("Transaction submission failed."),
    );
    const { result } = renderHook(() => useCancelListing(ARTIST));

    await expect(runCancel(result.current)).resolves.toBe(false);

    await waitFor(() =>
      expect(mockPushToast).toHaveBeenCalledWith(
        "Transaction submission failed.",
        "error",
      ),
    );
  });
});
