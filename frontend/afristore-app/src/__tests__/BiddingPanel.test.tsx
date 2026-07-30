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
  useWalletContext: () => ({ publicKey: "GBIDDER123" }),
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
  }: {
    children: React.ReactNode;
    onAction: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onAction} disabled={disabled}>
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
  // ── Issue #603 ──────────────────────────────────────────────────────────────
  it("disables Place Bid button when input is below the minimum increment", async () => {
    const user = userEvent.setup();
    const auction = makeAuction(); // reserve = 1 XLM

    render(<BiddingPanel auction={auction} />);

    const input = screen.getByPlaceholderText(/min/i);
    const button = screen.getByRole("button", { name: /place bid/i });

    // Button should be disabled when input is empty
    expect(button).toBeDisabled();

    // Type an amount well above reserve — button should enable
    await user.type(input, "5");
    expect(button).toBeEnabled();

    // Clear and type amount below reserve — button should disable
    await user.clear(input);
    await user.type(input, "0.1");
    expect(button).toBeDisabled();

    // Type amount equal to reserve — button should enable
    await user.clear(input);
    await user.type(input, "1");
    expect(button).toBeEnabled();
  });

});