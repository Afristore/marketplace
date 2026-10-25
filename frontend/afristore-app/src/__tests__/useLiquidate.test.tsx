/**
 * Unit tests for useLiquidate mutation hook
 * Issue #1103: Tests for validation and state transitions
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLiquidate } from "@/hooks/useLiquidate";

// Mock dependencies
const mockLiquidate = jest.fn();
const mockPushToast = jest.fn();

jest.mock("@/lib/lending", () => ({
  liquidate: (...args: unknown[]) => mockLiquidate(...args),
}));

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

describe("useLiquidate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles contract panic when liquidating healthy loan", async () => {
    try {
      mockLiquidate.mockRejectedValueOnce(
        new Error("Contract panic: Loan is not liquidatable")
      );

      const { result } = renderHook(() =>
        useLiquidate("GLIQUIDATOR_TEST")
      );

      await act(async () => {
        const res = await result.current.liquidate(1);
        expect(res).toBeNull();
      });

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toContain("Loan is not liquidatable");
        expect(mockPushToast).toHaveBeenCalledWith(
          expect.stringContaining("Loan is not liquidatable"),
          "error"
        );
      });
    } catch (error) {
      console.error("Failed to test healthy loan liquidation:", error);
      throw error;
    }
  });

  it("successfully liquidates expired loan", async () => {
    try {
      mockLiquidate.mockResolvedValueOnce({
        bountyEarned: 50000000n,
      });

      const { result } = renderHook(() =>
        useLiquidate("GLIQUIDATOR_TEST")
      );

      let earned: bigint | null = null;
      await act(async () => {
        earned = await result.current.liquidate(1);
      });

      await waitFor(() => {
        expect(earned).toBe(50000000n);
        expect(result.current.bountyEarned).toBe(50000000n);
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.error).toBeNull();
        expect(mockPushToast).toHaveBeenCalledWith(
          expect.stringContaining("liquidated successfully"),
          "success"
        );
      });
    } catch (error) {
      console.error("Failed to test successful liquidation:", error);
      throw error;
    }
  });

  it("sets isLiquidating flag to true during execution", async () => {
    try {
      let resolvePromise: (value: { bountyEarned: bigint }) => void;
      mockLiquidate.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          })
      );

      const { result } = renderHook(() =>
        useLiquidate("GLIQUIDATOR_TEST")
      );

      expect(result.current.isLiquidating).toBe(false);

      let promise: Promise<bigint | null>;
      act(() => {
        promise = result.current.liquidate(1);
      });

      expect(result.current.isLiquidating).toBe(true);

      await act(async () => {
        resolvePromise!({ bountyEarned: 1000000n });
        await promise!;
      });

      expect(result.current.isLiquidating).toBe(false);
    } catch (error) {
      console.error("Failed to test isLiquidating flag:", error);
      throw error;
    }
  });

  it("clears isLiquidating flag after error", async () => {
    try {
      mockLiquidate.mockRejectedValueOnce(new Error("Operation failed"));

      const { result } = renderHook(() =>
        useLiquidate("GLIQUIDATOR_TEST")
      );

      await act(async () => {
        await result.current.liquidate(1);
      });

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.isLoading).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test error state cleanup:", error);
      throw error;
    }
  });

  it("displays error message for missing wallet connection", async () => {
    try {
      const { result } = renderHook(() => useLiquidate(null));

      await act(async () => {
        const res = await result.current.liquidate(1);
        expect(res).toBeNull();
      });

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.error).toBe("Wallet not connected");
      });
    } catch (error) {
      console.error("Failed to test missing wallet connection:", error);
      throw error;
    }
  });

  it("handles network errors gracefully", async () => {
    try {
      mockLiquidate.mockRejectedValueOnce(
        new Error("Network request failed")
      );

      const { result } = renderHook(() =>
        useLiquidate("GLIQUIDATOR_TEST")
      );

      await act(async () => {
        await result.current.liquidate(1);
      });

      await waitFor(() => {
        expect(result.current.isLiquidating).toBe(false);
        expect(result.current.error).toContain("Network request failed");
        expect(mockPushToast).toHaveBeenCalledWith(
          expect.stringContaining("Network request failed"),
          "error"
        );
      });
    } catch (error) {
      console.error("Failed to test network error handling:", error);
      throw error;
    }
  });
});
