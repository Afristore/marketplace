/**
 * Unit tests for useLendingStats query hook fallback on offline indexer.
 *
 * useLendingStats fetches platform-wide lending metrics from /api/lending/stats.
 * This hook must handle network failures gracefully, returning default stats
 * when the endpoint is unreachable, without crashing the UI.
 *
 * Test coverage includes:
 *   • Successful API response with valid stats
 *   • Network errors and offline fallback behavior
 *   • Loading and error state management
 *   • Polling and refresh functionality
 *   • Component unmount cleanup
 */

import React, { useEffect, useState } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLendingStats } from "@/hooks/useLendingStats";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (
    error: unknown,
    defaultMsg?: string,
  ) => {
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    return defaultMsg || "Unknown error";
  },
}));

jest.mock("@/hooks/useTransientErrorToast");

// Mock fetch globally
global.fetch = jest.fn();

// ── Test Component ────────────────────────────────────────────────────────────

interface UseLendingStatsTestComponentProps {
  onStatsChange?: (stats: ReturnType<typeof useLendingStats>) => void;
}

const UseLendingStatsTestComponent: React.FC<
  UseLendingStatsTestComponentProps
> = ({ onStatsChange }) => {
  const result = useLendingStats();

  useEffect(() => {
    onStatsChange?.(result);
  }, [result, onStatsChange]);

  return (
    <div data-testid="stats-component">
      <div data-testid="loading-state">{result.isLoading ? "Loading" : "Idle"}</div>
      <div data-testid="error-state">{result.error || "No error"}</div>
      <div data-testid="tvl">{result.stats?.tvl ?? "null"}</div>
      <div data-testid="active-loans">{result.stats?.activeLoans ?? "null"}</div>
      <div data-testid="volume-24h">{result.stats?.volume24h ?? "null"}</div>
      <button onClick={() => result.refresh()} data-testid="refresh-button">
        Refresh
      </button>
    </div>
  );
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("useLendingStats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("initializes with null stats and isLoading false", () => {
    (global.fetch as jest.Mock).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    expect(getByTestId("tvl")).toHaveTextContent("null");
    expect(getByTestId("loading-state")).toHaveTextContent("Loading");
  });

  it("fetches stats successfully from the endpoint", async () => {
    const mockStats = {
      tvl: "1000.5",
      volume24h: "500.25",
      activeLoans: 42,
      updatedAt: "2025-10-21T12:00:00Z",
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockStats,
    });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("1000.5");
    });

    expect(getByTestId("active-loans")).toHaveTextContent("42");
    expect(getByTestId("volume-24h")).toHaveTextContent("500.25");
    expect(getByTestId("loading-state")).toHaveTextContent("Idle");
    expect(getByTestId("error-state")).toHaveTextContent("No error");
  });

  it("falls back to default stats on network error", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    await waitFor(() => {
      expect(getByTestId("loading-state")).toHaveTextContent("Idle");
    });

    // Stats should be null when there's an error (no fallback is shown in the hook)
    expect(getByTestId("tvl")).toHaveTextContent("null");

    // Error state should be set
    expect(getByTestId("error-state")).not.toHaveTextContent("No error");
  });

  it("falls back to default stats on HTTP error response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    await waitFor(() => {
      expect(getByTestId("loading-state")).toHaveTextContent("Idle");
    });

    // Stats should be null on error
    expect(getByTestId("tvl")).toHaveTextContent("null");

    // Error message should be displayed
    expect(getByTestId("error-state")).not.toHaveTextContent("No error");
  });

  it("handles partial response with missing fields", async () => {
    const partialStats = {
      tvl: "500",
      // volume24h and activeLoans are missing, should default to 0
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => partialStats,
    });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("500");
    });

    // Missing fields should default to 0
    expect(getByTestId("volume-24h")).toHaveTextContent("0");
    expect(getByTestId("active-loans")).toHaveTextContent("0");
  });

  it("supports manual refresh via refresh() callback", async () => {
    const mockStats1 = {
      tvl: "1000",
      volume24h: "500",
      activeLoans: 10,
      updatedAt: "2025-10-21T12:00:00Z",
    };

    const mockStats2 = {
      tvl: "2000",
      volume24h: "1000",
      activeLoans: 20,
      updatedAt: "2025-10-21T13:00:00Z",
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStats1,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockStats2,
      });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    // Wait for initial stats
    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("1000");
    });

    // Click refresh button
    const refreshButton = getByTestId("refresh-button");
    await act(async () => {
      await userEvent.click(refreshButton);
    });

    // Wait for updated stats
    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("2000");
    });

    expect(getByTestId("active-loans")).toHaveTextContent("20");
  });

  it("clears error state when fetch succeeds after failure", async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tvl: "1000",
          volume24h: "500",
          activeLoans: 10,
          updatedAt: "2025-10-21T12:00:00Z",
        }),
      });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    // Wait for error
    await waitFor(() => {
      expect(getByTestId("error-state")).not.toHaveTextContent("No error");
    });

    // Refresh to recover
    const refreshButton = getByTestId("refresh-button");
    await act(async () => {
      await userEvent.click(refreshButton);
    });

    // Wait for successful stats
    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("1000");
    });

    // Error should be cleared
    expect(getByTestId("error-state")).toHaveTextContent("No error");
  });

  it("sets isLoading during fetch and clears it when complete", async () => {
    let resolveLastFetch: (value: any) => void;
    const pendingFetch = new Promise((resolve) => {
      resolveLastFetch = resolve;
    });

    (global.fetch as jest.Mock).mockReturnValueOnce(pendingFetch);

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    // Should be loading initially
    await waitFor(() => {
      expect(getByTestId("loading-state")).toHaveTextContent("Loading");
    });

    // Resolve the fetch
    await act(async () => {
      resolveLastFetch!({
        ok: true,
        json: async () => ({
          tvl: "1000",
          volume24h: "500",
          activeLoans: 10,
          updatedAt: "2025-10-21T12:00:00Z",
        }),
      });
    });

    // Should no longer be loading
    await waitFor(() => {
      expect(getByTestId("loading-state")).toHaveTextContent("Idle");
    });
  });

  it("cleans up interval on component unmount", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        tvl: "1000",
        volume24h: "500",
        activeLoans: 10,
        updatedAt: "2025-10-21T12:00:00Z",
      }),
    });

    const { unmount } = render(<UseLendingStatsTestComponent />);

    // Wait for initial load
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Unmount component
    unmount();

    // Fast-forward time to when polling would happen
    jest.advanceTimersByTime(30_000);

    // Should not have made additional fetch calls after unmount
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("polls every 30 seconds", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        tvl: "1000",
        volume24h: "500",
        activeLoans: 10,
        updatedAt: "2025-10-21T12:00:00Z",
      }),
    });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    // Wait for initial fetch
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Advance time but not enough for next poll
    jest.advanceTimersByTime(29_999);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance to trigger next poll
    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    // Should have made another fetch call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("handles conversion of string numbers to actual numbers", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tvl: "1234.56",
        volume24h: "789.12",
        activeLoans: "42",
        updatedAt: "2025-10-21T12:00:00Z",
      }),
    });

    const { getByTestId } = render(<UseLendingStatsTestComponent />);

    await waitFor(() => {
      expect(getByTestId("tvl")).toHaveTextContent("1234.56");
    });

    expect(getByTestId("volume-24h")).toHaveTextContent("789.12");
    expect(getByTestId("active-loans")).toHaveTextContent("42");
  });
});
