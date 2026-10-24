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
  try {
    await act(async () => {
      result = await hook.cancel(listingId);
    });
  } catch (error) {
    console.error("Cancel listing error:", error);
    result = false;
  }
  return result;
}

describe("useCancelListing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelListing.mockResolvedValue(true);
  });

  it("simulates + submits via cancelListing and raises a success toast", async () => {
    try {
      const { result } = renderHook(() => useCancelListing(ARTIST));

      await expect(runCancel(result.current)).resolves.toBe(true);

      expect(mockCancelListing).toHaveBeenCalledWith(ARTIST, LISTING_ID);
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith(
          `Listing #${LISTING_ID} cancelled`,
          "success",
        ),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("refuses to run without a connected wallet and never builds a transaction", async () => {
    try {
      const { result } = renderHook(() => useCancelListing(null));

      await expect(runCancel(result.current)).resolves.toBe(false);

      expect(mockCancelListing).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockPushToast).toHaveBeenCalledWith("Wallet not connected", "error"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces a failed simulation as an error toast and returns false", async () => {
    try {
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
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("maps a contract rejection to its readable, cancel-specific message", async () => {
    try {
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
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("treats a declined wallet signature as a normal, non-error cancellation", async () => {
    try {
      mockCancelListing.mockRejectedValueOnce(new Error("User declined access"));
      const { result } = renderHook(() => useCancelListing(ARTIST));

      await expect(runCancel(result.current)).resolves.toBe(false);

      expect(mockPushToast).toHaveBeenCalledWith(
        "Listing cancellation dismissed.",
        "info",
      );
      expect(mockPushToast).not.toHaveBeenCalledWith(expect.anything(), "error");
      expect(result.current.error).toBeNull();
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("surfaces a submission failure as an error toast and returns false", async () => {
    try {
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
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  describe("async error handling & edge cases", () => {
    it("handles non-Error rejection and surfaces fallback error message", async () => {
      try {
        mockCancelListing.mockRejectedValueOnce({ status: 500 });
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await expect(runCancel(result.current)).resolves.toBe(false);
        await waitFor(() =>
          expect(mockPushToast).toHaveBeenCalledWith(
            "Failed to cancel listing",
            "error",
          ),
        );
        expect(result.current.isCancelling).toBe(false);
        expect(result.current.error).toBe("Failed to cancel listing");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles string rejections directly as error toast", async () => {
      try {
        mockCancelListing.mockRejectedValueOnce("raw network error string");
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await expect(runCancel(result.current)).resolves.toBe(false);
        await waitFor(() =>
          expect(mockPushToast).toHaveBeenCalledWith(
            "raw network error string",
            "error",
          ),
        );
        expect(result.current.isCancelling).toBe(false);
        expect(result.current.error).toBe("raw network error string");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles synchronous error thrown in cancelListing", async () => {
      try {
        mockCancelListing.mockImplementationOnce(() => {
          throw new Error("Immediate synchronous contract failure");
        });
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await expect(runCancel(result.current)).resolves.toBe(false);
        await waitFor(() =>
          expect(mockPushToast).toHaveBeenCalledWith(
            "Immediate synchronous contract failure",
            "error",
          ),
        );
        expect(result.current.isCancelling).toBe(false);
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("resets isCancelling to false and exposes error state after failure", async () => {
      try {
        mockCancelListing.mockRejectedValueOnce(new Error("Simulation timeout"));
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await runCancel(result.current);
        expect(result.current.isCancelling).toBe(false);
        expect(result.current.error).toBe("Simulation timeout");
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("clears the previous error when a retry succeeds", async () => {
      try {
        mockCancelListing
          .mockRejectedValueOnce(new Error("First attempt failed"))
          .mockResolvedValueOnce(true);
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await expect(runCancel(result.current)).resolves.toBe(false);
        expect(result.current.error).toBe("First attempt failed");

        await expect(runCancel(result.current)).resolves.toBe(true);
        expect(result.current.error).toBeNull();
        expect(mockPushToast).toHaveBeenCalledWith(
          `Listing #${LISTING_ID} cancelled`,
          "success",
        );
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });

    it("handles various signature rejection phrases quietly without error toast", async () => {
      try {
        mockCancelListing.mockRejectedValueOnce(
          new Error("Request was rejected by user"),
        );
        const { result } = renderHook(() => useCancelListing(ARTIST));

        await expect(runCancel(result.current)).resolves.toBe(false);
        expect(mockPushToast).toHaveBeenCalledWith(
          "Listing cancellation dismissed.",
          "info",
        );
        expect(mockPushToast).not.toHaveBeenCalledWith(
          expect.anything(),
          "error",
        );
        expect(result.current.error).toBeNull();
      } catch (error) {
        console.error("Test failed:", error);
        throw error;
      }
    });
  });
});
