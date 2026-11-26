/**
 * Dashboard auctions tab (#1342): status, highest bid, countdown and the
 * Finalize / Cancel creator actions.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockRefresh = jest.fn();
const mockCancel = jest.fn();
const mockFinalize = jest.fn();
let mockAuctions: unknown[] = [];

jest.mock("@/hooks/useAuctions", () => ({
  useArtistAuctions: () => ({
    auctions: mockAuctions,
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  }),
  useCancelAuction: () => ({
    cancel: mockCancel,
    isCancelling: false,
    error: null,
  }),
  useFinalizeAuction: () => ({
    finalize: mockFinalize,
    isFinalizing: false,
    error: null,
  }),
}));

jest.mock("@/lib/contract", () => ({
  stroopsToXlm: (v: bigint) => (Number(v) / 10_000_000).toFixed(2),
}));

import {
  ArtistAuctionsList,
  canCancelAuction,
  canFinalizeAuction,
  formatTimeRemaining,
} from "@/components/ArtistAuctionsList";

const NOW = Math.floor(Date.now() / 1000);

function makeAuction(over: Record<string, unknown> = {}) {
  return {
    auction_id: 1,
    creator: "GARTIST",
    collection: "CCOLL",
    token_id: 1,
    amount: 1,
    token: "CTOKEN",
    reserve_price: BigInt(10_000_000),
    highest_bid: BigInt(0),
    highest_bidder: null,
    end_time: NOW + 3600,
    status: "Active",
    recipients: [],
    created_at: 0,
    ...over,
  };
}

describe("ArtistAuctionsList", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCancel.mockResolvedValue(true);
    mockFinalize.mockResolvedValue(true);
  });

  it("shows the empty state when the artist has no auctions", () => {
    mockAuctions = [];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    expect(screen.getByText("No auctions yet.")).toBeInTheDocument();
  });

  it("shows highest bid, countdown and Cancel for a live auction without bids", () => {
    mockAuctions = [makeAuction()];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    const row = screen.getByTestId("artist-auction-1");
    expect(within(row).getByTestId("highest-bid")).toHaveTextContent("No bids");
    expect(within(row).getByTestId("time-left").textContent).toMatch(/\d+[hm]/);
    expect(within(row).getByText("Cancel Auction")).toBeInTheDocument();
    expect(within(row).queryByText("Finalize Auction")).not.toBeInTheDocument();
  });

  it("hides Cancel once a bid exists and displays the bid", () => {
    mockAuctions = [
      makeAuction({ highest_bid: BigInt(25_000_000), highest_bidder: "GBIDDER" }),
    ];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    expect(screen.getByTestId("highest-bid")).toHaveTextContent("2.50");
    expect(screen.queryByText("Cancel Auction")).not.toBeInTheDocument();
  });

  it("offers Finalize for an expired auction and refreshes after success", async () => {
    mockAuctions = [
      makeAuction({
        auction_id: 7,
        end_time: NOW - 10,
        highest_bid: BigInt(25_000_000),
        highest_bidder: "GBIDDER",
      }),
    ];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByText("Cancel Auction")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("Finalize Auction"));
    expect(mockFinalize).toHaveBeenCalledWith(7);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("cancels an auction and refreshes", async () => {
    mockAuctions = [makeAuction({ auction_id: 3 })];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    await userEvent.click(screen.getByText("Cancel Auction"));
    expect(mockCancel).toHaveBeenCalledWith(3);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows no actions for finalized auctions", () => {
    mockAuctions = [makeAuction({ status: "Finalized", end_time: NOW - 100 })];
    render(<ArtistAuctionsList artistPublicKey="GARTIST" />);
    expect(screen.getByText("Finalized")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("auction action helpers", () => {
  const now = 1_000;
  it("canFinalizeAuction requires Active and expired", () => {
    expect(canFinalizeAuction(makeAuction({ end_time: 999 }) as never, now)).toBe(true);
    expect(canFinalizeAuction(makeAuction({ end_time: 1001 }) as never, now)).toBe(false);
    expect(
      canFinalizeAuction(makeAuction({ end_time: 999, status: "Cancelled" }) as never, now),
    ).toBe(false);
  });

  it("canCancelAuction requires Active, no bids, not expired", () => {
    expect(canCancelAuction(makeAuction({ end_time: 1001 }) as never, now)).toBe(true);
    expect(canCancelAuction(makeAuction({ end_time: 999 }) as never, now)).toBe(false);
    expect(
      canCancelAuction(
        makeAuction({ end_time: 1001, highest_bidder: "GB" }) as never,
        now,
      ),
    ).toBe(false);
  });

  it("formatTimeRemaining", () => {
    expect(formatTimeRemaining(0)).toBe("Ended");
    expect(formatTimeRemaining(45)).toBe("45s");
    expect(formatTimeRemaining(125)).toBe("2m 5s");
    expect(formatTimeRemaining(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatTimeRemaining(2 * 86400 + 4 * 3600)).toBe("2d 4h");
  });
});
