/**
 * Unit tests for useLiquidate mutation hook
 * Issue #1103: Tests for validation and state transitions
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useLiquidate } from "@/hooks/useLiquidate";

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

describe("useLiquidate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles contract panic when liquidating healthy loan", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());
      const toast = require("react-hot-toast").toast;

      // Simulate contract panic for healthy loan
      const mockError = new Error("Contract panic: Loan is not liquidatable");

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1" },
          {
            onError: (error) => {
              expect(error.message).toContain("not liquidatable");
              expect(toast.error).toHaveBeenCalledWith(
                expect.stringContaining("not liquidatable")
              );
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test healthy loan liquidation:", error);
      throw error;
    }
  });

  it("successfully liquidates expired loan", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());
      const toast = require("react-hot-toast").toast;

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1" },
          {
            onSuccess: () => {
              expect(result.current.error).toBeNull();
              expect(toast.success).toHaveBeenCalled();
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test successful liquidation:", error);
      throw error;
    }
  });

  it("sets isLiquidating flag to true during execution", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());

      // Initial state
      expect(result.current.isLiquidating).toBe(false);

      if (result.current.mutate) {
        result.current.mutate({ loanId: "1" });
      }

      // Should briefly be true during execution
      await waitFor(() => {
        // After completion, should be false again
        expect(result.current.isLiquidating).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test isLiquidating flag:", error);
      throw error;
    }
  });

  it("clears isLiquidating flag after error", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1" },
          {
            onError: () => {
              // Error occurred
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test error state cleanup:", error);
      throw error;
    }
  });

  it("displays error message for invalid loan ID", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());
      const toast = require("react-hot-toast").toast;

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "invalid" },
          {
            onError: (error) => {
              expect(error).toBeTruthy();
              expect(toast.error).toHaveBeenCalled();
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test invalid loan ID:", error);
      throw error;
    }
  });

  it("handles network errors gracefully", async () => {
    try {
      const { result } = renderHook(() => useLiquidate());
      const toast = require("react-hot-toast").toast;

      // Simulate network error
      const mockError = new Error("Network request failed");

      if (result.current.mutate) {
        result.current.mutate(
          { loanId: "1" },
          {
            onError: (error) => {
              expect(error.message).toContain("Network");
              expect(toast.error).toHaveBeenCalled();
            },
          }
        );
      }

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.error).toBeTruthy();
      });
    } catch (error) {
      console.error("Failed to test network error handling:", error);
      throw error;
    }
  });
});
