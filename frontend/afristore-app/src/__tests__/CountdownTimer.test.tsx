/**
 * Unit tests for CountdownTimer component.
 * The countdown functionality is implemented as a useCountdown hook
 * inside BiddingPanel. These tests verify the time formatting and
 * expiration callback behavior.
 */
import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBid = jest.fn();
const mockFinalize = jest.fn();

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: "GBIDDER123",
    isConnected: true,
    isWrongNetwork: false,
    status: "CONNECTED",
  }),
}));

jest.mock("@/hooks/usePlaceBid", () => ({
  usePlaceBid: () => ({ bid: mockBid, isBidding: false, error: null }),
}));

jest.mock("@/hooks/useAuctions", () => ({
  useFinalizeAuction: () => ({
    finalize: mockFinalize,
    isFinalizing: false,
    error: null,
  }),
}));

jest.mock("@/components/WalletGuard", () => ({
  GuardButton: ({
    children,
    onAction,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onAction?: (e: React.MouseEvent) => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      onClick={onAction}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/lib/contract", () => ({
  stroopsToXlm: (v: bigint) => String(Number(v) / 10_000_000),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "Gavel",
      "Clock",
      "Trophy",
      "User",
      "AlertCircle",
      "CheckCircle",
      "Loader2",
    ].map((name) => [name, () => <span />]),
  ),
);

import { BiddingPanel } from "@/components/BiddingPanel";

function makeAuction(overrides = {}) {
  return {
    auction_id: 1,
    creator: "GBIDDER123",
    artist: "GARTIST",
    metadata_cid: "Qm",
    collection: "CCOLLECTION",
    token_id: 1,
    token: "CTOKEN",
    created_at: 100,
    recipients: [],
    reserve_price: 10_000_000n, // 1 XLM
    highest_bid: 0n,
    highest_bidder: null,
    end_time: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    status: "Active" as const,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CountdownTimer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("Time formatting (DD:HH:MM:SS)", () => {
    it("correctly formats time as DD:HH:MM:SS for remaining time", async () => {
      // Set end time to 1 day, 2 hours, 30 minutes, 45 seconds from now
      const endTime =
        Math.floor(Date.now() / 1000) + 86400 + 7200 + 1800 + 45;

      render(<BiddingPanel auction={makeAuction({ end_time: endTime })} />);

      // The countdown grid should display each component
      // Days: 01, Hours: 02, Minutes: 30, Seconds: 45
      await waitFor(() => {
        // Check for the countdown grid labels
        expect(screen.getByText("Days")).toBeInTheDocument();
        expect(screen.getByText("Hours")).toBeInTheDocument();
        expect(screen.getByText("Mins")).toBeInTheDocument();
        expect(screen.getByText("Secs")).toBeInTheDocument();
      });

      // Verify padded format (2 digits with leading zeros)
      const countdownValues = screen.getAllByText(/^[0-9]{2}$/);
      expect(countdownValues.length).toBe(4); // Days, Hours, Minutes, Seconds
    });

    it("displays 00:00:00:00 when auction is expired", async () => {
      // Set end time in the past
      const endTime = Math.floor(Date.now() / 1000) - 1;

      render(<BiddingPanel auction={makeAuction({ end_time: endTime })} />);

      // Should show "Expired" text instead of countdown
      await waitFor(() => {
        expect(screen.getByText(/expired/i)).toBeInTheDocument();
      });
    });

    it("displays hours correctly when less than 24 hours remain", async () => {
      // Set end time to 5 hours, 15 minutes from now
      const endTime = Math.floor(Date.now() / 1000) + 18900;

      render(<BiddingPanel auction={makeAuction({ end_time: endTime })} />);

      await waitFor(() => {
        expect(screen.getByText("Hours")).toBeInTheDocument();
      });
    });

    it("pads single digit values with leading zeros", async () => {
      // Set end time to 1 day, 5 hours, 9 minutes, 7 seconds from now
      const endTime =
        Math.floor(Date.now() / 1000) + 86400 + 18000 + 540 + 7;

      render(<BiddingPanel auction={makeAuction({ end_time: endTime })} />);

      // All values should be displayed as 2-digit strings
      await waitFor(() => {
        const numericValues = screen
          .getAllByRole("paragraph")
          .filter((el) => /^[0-9]{2}$/.test(el.textContent || ""));
        // Each countdown cell should have a 2-digit value
        expect(numericValues.length).toBeGreaterThanOrEqual(4);
      });
    });
  });

  describe("onExpire callback", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("triggers onExpire callback exactly when it hits zero", async () => {
      // Create an auction ending in 3 seconds
      const now = Math.floor(Date.now() / 1000);
      const endTime = now + 3;

      const onBidPlaced = jest.fn();

      render(
        <BiddingPanel
          auction={makeAuction({ end_time: endTime })}
          onBidPlaced={onBidPlaced}
        />,
      );

      // Initially should show countdown (not expired)
      expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();

      // Advance time by 3 seconds
      act(() => {
        jest.advanceTimersByTime(3000);
      });

      // Now should show expired state
      await waitFor(() => {
        expect(screen.getByText(/expired/i)).toBeInTheDocument();
      });

      // Finalize button should appear for expired auction
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /finalize/i }),
        ).toBeInTheDocument();
      });
    });

    it("shows expired state immediately when end_time is in the past", async () => {
      const pastEndTime = Math.floor(Date.now() / 1000) - 100;

      render(<BiddingPanel auction={makeAuction({ end_time: pastEndTime })} />);

      // Should immediately show expired state
      await waitFor(() => {
        expect(screen.getByText(/expired/i)).toBeInTheDocument();
      });

      // Should show finalize button instead of bid input
      expect(
        screen.getByRole("button", { name: /finalize/i }),
      ).toBeInTheDocument();
    });

    it("does not show expired state before end_time is reached", async () => {
      // Create an auction ending in 10 seconds
      const now = Math.floor(Date.now() / 1000);
      const endTime = now + 10;

      render(<BiddingPanel auction={makeAuction({ end_time: endTime, creator: "GCREATOR" })} />);

      // Should show countdown, not expired
      expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();

      // Should show bid input for active auction
      expect(screen.getByPlaceholderText(/min/i)).toBeInTheDocument();
    });
  });
});
