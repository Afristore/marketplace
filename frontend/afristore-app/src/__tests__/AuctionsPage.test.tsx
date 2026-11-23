/**
 * Component tests for AuctionsPage (app/auctions/page.tsx).
 */
import React from "react";
import { render, screen } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockAuctions: unknown[] = [];
let mockIsLoading = true;
let mockError: string | null = null;
const mockRefresh = jest.fn();

jest.mock("@/hooks/useAuctions", () => ({
  useAuctions: () => ({
    auctions: mockAuctions,
    isLoading: mockIsLoading,
    error: mockError,
    refresh: mockRefresh,
  }),
}));

jest.mock("@/lib/ipfs", () => ({
  getCachedMetadata: jest.fn().mockResolvedValue({
    title: "Artwork 1",
    image: "ipfs://test",
  }),
  cidToGatewayUrl: (uri: string) => uri,
}));

jest.mock("@/lib/contract", () => ({
  stroopsToXlm: (v: bigint) => String(Number(v) / 10_000_000),
}));

jest.mock("next/image", () => {
  return function MockImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  };
});

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "Gavel",
      "Clock",
      "Trophy",
      "Package",
      "RefreshCw",
      "AlertCircle",
    ].map((name) => [name, () => <span />]),
  ),
);

import AuctionsPage from "@/app/auctions/page";

describe("AuctionsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuctions = [];
    mockIsLoading = true;
    mockError = null;
  });

  it("renders animated pulse skeleton cards while isLoading is true", () => {
    mockIsLoading = true;
    render(<AuctionsPage />);

    const skeletonContainer = screen.getByTestId("auction-skeletons");
    expect(skeletonContainer).toBeInTheDocument();

    const skeletons = screen.getAllByTestId("auction-skeleton-card");
    expect(skeletons.length).toBe(8);
    skeletons.forEach((skeleton) => {
      expect(skeleton.className).toContain("animate-pulse");
    });
  });

  it("renders auction cards when isLoading is false and auctions are present", () => {
    mockIsLoading = false;
    mockAuctions = [
      {
        auction_id: 1,
        artist: "GARTIST1",
        metadata_cid: "Qm1",
        reserve_price: 10_000_000n,
        highest_bid: 20_000_000n,
        highest_bidder: "GBIDDER1",
        end_time: Math.floor(Date.now() / 1000) + 3600,
        status: "Active",
      },
    ];

    render(<AuctionsPage />);
    expect(screen.queryByTestId("auction-skeletons")).not.toBeInTheDocument();
    expect(screen.getByText("Auction #1")).toBeInTheDocument();
  });

  it("renders empty state when not loading and auctions list is empty", () => {
    mockIsLoading = false;
    mockAuctions = [];

    render(<AuctionsPage />);
    expect(screen.queryByTestId("auction-skeletons")).not.toBeInTheDocument();
    expect(screen.getByText(/no auctions found/i)).toBeInTheDocument();
  });

  it("renders error state when error is present", () => {
    mockIsLoading = false;
    mockError = "Indexer offline";

    render(<AuctionsPage />);
    expect(screen.getByText("Failed to load auctions")).toBeInTheDocument();
    expect(screen.getByText("Indexer offline")).toBeInTheDocument();
  });
});
