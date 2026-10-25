/**
 * Unit tests for useBorrowTransaction mutation hook
 * Issue #1102: Tests for error states and wallet rejections
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBorrowTransaction } from "@/hooks/useBorrowTransaction";

// Mock dependencies
const mockBorrow = jest.fn();
const mockPushToast = jest.fn();

jest.mock("@/lib/lending", () => ({
  borrow: (...args: unknown[]) => mockBorrow(...args),
}));

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

describe("useBorrowTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles user rejection in Freighter wallet", async () => {
    try {
      mockBorrow.mockRejectedValueOnce(
        new Error("User declined to sign transaction")
      );

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      await act(async () => {
        const res = await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
        expect(res).toBeNull();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBorrowing).toBe(false);
        expect(result.current.error).toContain(
          "User declined to sign transaction"
        );
      });
    } catch (error) {
      console.error("Failed to test user rejection:", error);
      throw error;
    }
  });

  it("handles RPC network timeout errors", async () => {
    try {
      mockBorrow.mockRejectedValueOnce(new Error("Network request timed out"));

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      await act(async () => {
        const res = await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
        expect(res).toBeNull();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toContain("Network request timed out");
      });
    } catch (error) {
      console.error("Failed to test RPC timeout:", error);
      throw error;
    }
  });

  it("handles simulation failure errors", async () => {
    try {
      mockBorrow.mockRejectedValueOnce(
        new Error("Transaction simulation failed")
      );

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      await act(async () => {
        const res = await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
        expect(res).toBeNull();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toContain(
          "Transaction simulation failed"
        );
      });
    } catch (error) {
      console.error("Failed to test simulation failure:", error);
      throw error;
    }
  });

  it("clears loading state after error", async () => {
    try {
      mockBorrow.mockRejectedValueOnce(new Error("Some unexpected error"));

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      await act(async () => {
        await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBorrowing).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test loading state clearing:", error);
      throw error;
    }
  });

  it("surfaces error toast on failure", async () => {
    try {
      mockBorrow.mockRejectedValueOnce(new Error("Contract execution failed"));

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      await act(async () => {
        await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(mockPushToast).toHaveBeenCalledWith(
          expect.stringContaining("Contract execution failed"),
          "error"
        );
      });
    } catch (error) {
      console.error("Failed to test error toast:", error);
      throw error;
    }
  });

  it("executes successful borrow transaction", async () => {
    try {
      mockBorrow.mockResolvedValueOnce(101);

      const { result } = renderHook(() =>
        useBorrowTransaction("GBORROWER_TEST")
      );

      let positionId: number | null = null;
      await act(async () => {
        positionId = await result.current.borrow({
          listingId: 1,
          collateralCurrency: "USDC",
          collateralAmount: "1000",
        });
      });

      await waitFor(() => {
        expect(positionId).toBe(101);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBorrowing).toBe(false);
        expect(result.current.error).toBeNull();
      });
    } catch (error) {
      console.error("Failed to test successful transaction:", error);
      throw error;
    }
  });
});
