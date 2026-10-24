/**
 * Unit tests for useBorrowerPositions query hook
 * Issue #1105: Tests for pagination and network error fallback
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useBorrowerPositions } from "@/hooks/useBorrowerPositions";

// Mock fetch
global.fetch = jest.fn();

// Mock dependencies
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: jest.fn(() => ({
    publicKey: "GTEST...",
    status: "CONNECTED",
  })),
}));

describe("useBorrowerPositions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  it("shows initial loading state", async () => {
    try {
      (global.fetch as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: true, json: () => [] }), 100)
          )
      );

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    } catch (error) {
      console.error("Failed to test initial loading state:", error);
      throw error;
    }
  });

  it("successfully parses positions from 200 response", async () => {
    try {
      const mockPositions = [
        {
          id: "1",
          borrower: "GTEST...",
          amount: "1000",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPositions,
      });

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toEqual(mockPositions);
        expect(result.current.error).toBeNull();
      });
    } catch (error) {
      console.error("Failed to test successful parsing:", error);
      throw error;
    }
  });

  it("handles empty array response gracefully", async () => {
    try {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toEqual([]);
        expect(result.current.error).toBeNull();
      });
    } catch (error) {
      console.error("Failed to test empty array handling:", error);
      throw error;
    }
  });

  it("handles 404 not found error gracefully", async () => {
    try {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Not found" }),
      });

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
        expect(result.current.data).toBeUndefined();
      });
    } catch (error) {
      console.error("Failed to test 404 error handling:", error);
      throw error;
    }
  });

  it("handles 500 server error with fallback", async () => {
    try {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
        // Should gracefully degrade - no crash
        expect(result.current.data).toBeUndefined();
      });
    } catch (error) {
      console.error("Failed to test 500 error handling:", error);
      throw error;
    }
  });

  it("handles network failure gracefully", async () => {
    try {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error("Network request failed")
      );

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...")
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeTruthy();
        expect(result.current.data).toBeUndefined();
      });
    } catch (error) {
      console.error("Failed to test network failure:", error);
      throw error;
    }
  });

  it("supports pagination parameters", async () => {
    try {
      const mockPositions = Array.from({ length: 10 }, (_, i) => ({
        id: `${i + 1}`,
        borrower: "GTEST...",
        amount: "1000",
      }));

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockPositions,
      });

      const { result } = renderHook(() =>
        useBorrowerPositions("GTEST...", { page: 1, limit: 10 })
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toHaveLength(10);
      });
    } catch (error) {
      console.error("Failed to test pagination:", error);
      throw error;
    }
  });

  it("refetches when borrower address changes", async () => {
    try {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const { result, rerender } = renderHook(
        ({ address }) => useBorrowerPositions(address),
        { initialProps: { address: "GTEST1..." } }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const firstCallCount = (global.fetch as jest.Mock).mock.calls.length;

      // Change address
      rerender({ address: "GTEST2..." });

      await waitFor(() => {
        const secondCallCount = (global.fetch as jest.Mock).mock.calls.length;
        expect(secondCallCount).toBeGreaterThan(firstCallCount);
      });
    } catch (error) {
      console.error("Failed to test address change refetch:", error);
      throw error;
    }
  });
});
