/**
 * Component tests for BiddingPanel.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

jest.mock("@/components/ConnectWalletModal", () => ({
  ConnectWalletModal: () => null,
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
    creator: "GCREATOR",
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

describe("BiddingPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the reserve price label", () => {
    render(<BiddingPanel auction={makeAuction()} />);
    expect(screen.getByText(/reserve price/i)).toBeInTheDocument();
  });

  it("renders the bid input field for active auctions", () => {
    render(<BiddingPanel auction={makeAuction()} />);
    expect(screen.getByPlaceholderText(/min/i)).toBeInTheDocument();
  });

  it("calls bid with correct amount when Place Bid is clicked", async () => {
    mockBid.mockResolvedValueOnce(true);
    const onBidPlaced = jest.fn();
    const user = userEvent.setup();

    render(<BiddingPanel auction={makeAuction()} onBidPlaced={onBidPlaced} />);
    await user.clear(screen.getByPlaceholderText(/min/i));
    await user.type(screen.getByPlaceholderText(/min/i), "2");
    await user.click(screen.getByRole("button", { name: /place bid/i }));

    await waitFor(() => expect(mockBid).toHaveBeenCalledWith(1, 2));
    await waitFor(() => expect(onBidPlaced).toHaveBeenCalled());
  });

  it("shows current highest bid label when one exists", () => {
    render(
      <BiddingPanel
        auction={makeAuction({
          highest_bid: 20_000_000n,
          highest_bidder: "GBIDDER",
        })}
      />,
    );
    expect(screen.getByText(/highest bid/i)).toBeInTheDocument();
  });

  it("shows Finalize button for expired auctions when user is creator", () => {
    render(
      <BiddingPanel auction={makeAuction({ end_time: 1, status: "Active", creator: "GBIDDER123" })} />,
    );
    expect(
      screen.getByRole("button", { name: /finalize/i }),
    ).toBeInTheDocument();
  });

  it("calls finalize when Finalize Auction is clicked", async () => {
    mockFinalize.mockResolvedValueOnce(true);
    const onFinalized = jest.fn();
    const user = userEvent.setup();

    render(
      <BiddingPanel
        auction={makeAuction({ end_time: 1, creator: "GBIDDER123" })}
        onFinalized={onFinalized}
      />,
    );
    await user.click(screen.getByRole("button", { name: /finalize/i }));
    await waitFor(() => expect(mockFinalize).toHaveBeenCalledWith(1));
    await waitFor(() => expect(onFinalized).toHaveBeenCalled());
  });

  it("shows Finalized badge for completed auctions", () => {
    render(<BiddingPanel auction={makeAuction({ status: "Finalized" })} />);
    expect(screen.getByText(/finalized/i)).toBeInTheDocument();
  });

  it("disables the 'Place Bid' button if the input is below the minimum increment", async () => {
    const user = userEvent.setup();

    // Auction with reserve price of 1 XLM and no existing bids
    render(
      <BiddingPanel
        auction={makeAuction({
          reserve_price: 10_000_000n, // 1 XLM
          highest_bid: 0n,
        })}
      />,
    );

    const bidInput = screen.getByPlaceholderText(/min/i);
    const placeBidButton = screen.getByRole("button", { name: /place bid/i });

    // Button should be disabled initially (no input)
    expect(placeBidButton).toBeDisabled();

    // Enter an amount below the minimum (0.5 XLM < 1 XLM reserve)
    await user.clear(bidInput);
    await user.type(bidInput, "0.5");

    // Verify validation message appears
    await waitFor(() => {
      expect(screen.getByText(/bid must be at least/i)).toBeInTheDocument();
    });

    // Button should still be disabled
    expect(placeBidButton).toBeDisabled();

    // Enter a valid amount (2 XLM > 1 XLM reserve)
    await user.clear(bidInput);
    await user.type(bidInput, "2");

    // Button should now be enabled
    await waitFor(() => {
      expect(placeBidButton).not.toBeDisabled();
    });
  });

  it("disables Place Bid when bid is not higher than current highest bid", async () => {
    const user = userEvent.setup();

    // Auction with existing bid of 2 XLM
    render(
      <BiddingPanel
        auction={makeAuction({
          reserve_price: 10_000_000n, // 1 XLM reserve
          highest_bid: 20_000_000n, // 2 XLM current bid
          highest_bidder: "GBIDDER",
        })}
      />,
    );

    const bidInput = screen.getByPlaceholderText(/min/i);
    const placeBidButton = screen.getByRole("button", { name: /place bid/i });

    // Enter amount equal to current bid (should be disabled)
    await user.clear(bidInput);
    await user.type(bidInput, "2");

    await waitFor(() => {
      expect(
        screen.getByText(/bid must be higher than current bid/i),
      ).toBeInTheDocument();
    });
    expect(placeBidButton).toBeDisabled();

    // Enter amount below current bid (should be disabled)
    await user.clear(bidInput);
    await user.type(bidInput, "1.5");

    await waitFor(() => {
      expect(placeBidButton).toBeDisabled();
    });

    // Enter amount above current bid (should be enabled)
    await user.clear(bidInput);
    await user.type(bidInput, "3");

    await waitFor(() => {
      expect(placeBidButton).not.toBeDisabled();
    });
  });
});
