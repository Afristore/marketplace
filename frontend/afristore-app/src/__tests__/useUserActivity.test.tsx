/**
 * Unit tests for useUserActivity.ts
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockGetWalletActivity = jest.fn();
const mockGetRoyaltyStats = jest.fn();
const mockGetListingActivity = jest.fn();

jest.mock("@/lib/indexer", () => ({
  getWalletActivity: (...args: unknown[]) => mockGetWalletActivity(...args),
  getRoyaltyStats: (...args: unknown[]) => mockGetRoyaltyStats(...args),
  getListingActivity: (...args: unknown[]) => mockGetListingActivity(...args),
}));

import { useUserActivity, useListingActivity } from "@/hooks/useUserActivity";

function makeActivity(id: string) {
  return {
    id,
    type: "PURCHASE" as const,
    listing_id: 1,
    title: "Test",
    price: "10",
    timestamp: 1000,
    from: "GA",
    to: "GB",
    tx_hash: "0xabc",
  };
}

// ── useUserActivity ───────────────────────────────────────────────────────────

describe("useUserActivity", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when publicKey is null", () => {
    function Comp() {
      const { activities, isLoading } = useUserActivity(null);
      return (
        <div>
          <span data-testid="count">{activities.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("loads activities and royalty stats", async () => {
    try {
      mockGetWalletActivity.mockResolvedValueOnce([
        makeActivity("1"),
        makeActivity("2"),
      ]);
      mockGetRoyaltyStats.mockResolvedValueOnce({
        totalEarned: "500",
        payoutCount: 3,
        lastPayout: 9999,
      });

      function Comp() {
        const { activities, royaltyStats } = useUserActivity("GPUBKEY");
        return (
          <div>
            <span data-testid="count">{activities.length}</span>
            <span data-testid="earned">
              {royaltyStats?.totalEarned ?? "null"}
            </span>
            <span data-testid="payouts">{royaltyStats?.payoutCount ?? 0}</span>
          </div>
        );
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("2"),
      );
      expect(screen.getByTestId("earned").textContent).toBe("500");
      expect(screen.getByTestId("payouts").textContent).toBe("3");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("sets error when fetch fails", async () => {
    try {
      mockGetWalletActivity.mockRejectedValueOnce(new Error("network error"));
      mockGetRoyaltyStats.mockRejectedValueOnce(new Error("network error"));

      function Comp() {
        const { error } = useUserActivity("GPUBKEY");
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).not.toBe("none"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("refresh re-fetches data", async () => {
    try {
      mockGetWalletActivity
        .mockResolvedValueOnce([makeActivity("a")])
        .mockResolvedValueOnce([makeActivity("a"), makeActivity("b")]);
      mockGetRoyaltyStats.mockResolvedValue({
        totalEarned: "100",
        payoutCount: 1,
        lastPayout: 0,
      });

      let refreshFn: () => void;
      function Comp() {
        const { activities, refresh } = useUserActivity("GPUBKEY");
        refreshFn = refresh;
        return <span data-testid="count">{activities.length}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("1"),
      );

      await act(async () => {
        refreshFn();
      });
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("2"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

// ── useListingActivity ────────────────────────────────────────────────────────

describe("useListingActivity", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing when listingId is null", () => {
    function Comp() {
      const { activities, isLoading } = useListingActivity(null);
      return (
        <div>
          <span data-testid="count">{activities.length}</span>
          <span data-testid="loading">{String(isLoading)}</span>
        </div>
      );
    }
    render(<Comp />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("loads activities for a listing", async () => {
    try {
      mockGetListingActivity.mockResolvedValueOnce([
        makeActivity("ev1"),
        makeActivity("ev2"),
        makeActivity("ev3"),
      ]);

      function Comp() {
        const { activities } = useListingActivity(5);
        return <span data-testid="count">{activities.length}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("3"),
      );
      expect(mockGetListingActivity).toHaveBeenCalledWith(5);
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("sets error when fetch fails", async () => {
    try {
      mockGetListingActivity.mockRejectedValueOnce(new Error("fail"));

      function Comp() {
        const { error } = useListingActivity(7);
        return <span data-testid="error">{error ?? "none"}</span>;
      }
      render(<Comp />);
      await waitFor(() =>
        expect(screen.getByTestId("error").textContent).not.toBe("none"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("re-fetches when listingId changes", async () => {
    try {
      mockGetListingActivity
        .mockResolvedValueOnce([makeActivity("a")])
        .mockResolvedValueOnce([makeActivity("b"), makeActivity("c")]);

      function Comp({ id }: { id: number }) {
        const { activities } = useListingActivity(id);
        return <span data-testid="count">{activities.length}</span>;
      }
      const { rerender } = render(<Comp id={1} />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("1"),
      );

      rerender(<Comp id={2} />);
      await waitFor(() =>
        expect(screen.getByTestId("count").textContent).toBe("2"),
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
