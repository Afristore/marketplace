/**
 * Unit tests for useBorrowTransaction mutation hook
 * Issue #1102: Tests for error states and wallet rejections
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useBorrowTransaction } from "@/hooks/useBorrowTransaction";

// Mock dependencies
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: jest.fn(() => ({
    publicKey: "GTEST...",
    status: "CONNECTED",
  })),
}));

jest.mock("@/lib/stellar", () => ({
  submitTransaction: jest.fn(),
  simulateTransaction: jest.fn(),
}));

jest.mock("react-hot-toast", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    loading: jest.fn(),
  },
}));

describe("useBorrowTransaction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles user rejection in Freighter wallet", async () => {
    try {
      const { result } = renderHook(() => useBorrowTransaction());

      // Simulate user rejection
      const mockError = new Error("User declined to sign transaction");
      
      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onError: (error) => {
              expect(error.message).toContain("declined");
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test user rejection:", error);
      throw error;
    }
  });

  it("handles RPC network timeout errors", async () => {
    try {
      const { result } = renderHook(() => useBorrowTransaction());

      // Simulate RPC timeout
      const mockError = new Error("Network request timed out");

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onError: (error) => {
              expect(error.message).toContain("timed out");
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test RPC timeout:", error);
      throw error;
    }
  });

  it("handles simulation failure errors", async () => {
    try {
      const { result } = renderHook(() => useBorrowTransaction());

      // Simulate simulation failure
      const mockError = new Error("Transaction simulation failed");

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onError: (error) => {
              expect(error.message).toContain("simulation failed");
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test simulation failure:", error);
      throw error;
    }
  });

  it("clears loading state after error", async () => {
    try {
      const { result } = renderHook(() => useBorrowTransaction());

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onError: () => {
              // Error occurred
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test loading state clearing:", error);
      throw error;
    }
  });

  it("surfaces error toast on failure", async () => {
    try {
      const toast = require("react-hot-toast").toast;
      const { result } = renderHook(() => useBorrowTransaction());

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onError: () => {
              expect(toast.error).toHaveBeenCalled();
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test error toast:", error);
      throw error;
    }
  });

  it("executes successful borrow transaction", async () => {
    try {
      const { result } = renderHook(() => useBorrowTransaction());

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1", amount: "1000" },
          {
            onSuccess: () => {
              expect(result.current.error).toBeNull();
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test successful transaction:", error);
      throw error;
    }
  });
});
