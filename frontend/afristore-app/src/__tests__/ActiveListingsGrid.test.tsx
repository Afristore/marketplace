import React, { useState, useMemo } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ActiveListingsGrid, type ActiveListingsGridProps } from "@/components/lending/ActiveListingsGrid";
import type { LendingListing } from "@/lib/lending";

// Mock Lucide icons
jest.mock("lucide-react", () => ({
  Loader2: ({ className }: { className?: string }) => <svg data-testid="loader2-icon" className={className} />,
  PackageOpen: ({ size }: { size?: number }) => <svg data-testid="package-open-icon" width={size} />,
}));

const mockListing = (overrides: Partial<LendingListing> = {}): LendingListing => ({
  id: 1,
  lender: "GBVHG...123",
  nft_contract: "CDTESTNFTCONTRACT123",
  token_id: 101,
  declared_price_usd: BigInt(500 * 10_000_000), // $500
  interest_schedule_bps: [250], // 2.50% / mo
  max_duration_days: 30,
  min_collateral_buffer_bps: 12000,
  liquidation_threshold_bps: 11000,
  status: "Open",
  created_at: Math.floor(Date.now() / 1000),
  ...overrides,
});

// A wrapper component that exercises sorting and currency filter chips on top of ActiveListingsGrid
interface TestableFilterableGridProps {
  initialListings: (LendingListing & { currency?: string })[];
}

function FilterableActiveListingsView({ initialListings }: TestableFilterableGridProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"duration" | "rate" | "none">("none");

  const filteredAndSortedListings = useMemo(() => {
    let result = [...initialListings];

    if (selectedCurrency !== "All") {
      result = result.filter((l) => (l.currency || "XLM") === selectedCurrency);
    }

    if (sortBy === "duration") {
      result.sort((a, b) => a.max_duration_days - b.max_duration_days);
    } else if (sortBy === "rate") {
      result.sort((a, b) => {
        const rateA = a.interest_schedule_bps?.[0] ?? 0;
        const rateB = b.interest_schedule_bps?.[0] ?? 0;
        return rateA - rateB;
      });
    }


    return result;
  }, [initialListings, selectedCurrency, sortBy]);

  return (
    <div>
      {/* Currency Filter Chips */}
      <div data-testid="currency-filters" className="flex gap-2 mb-4">
        {["All", "XLM", "USDC", "yXLM"].map((currency) => (
          <button
            key={currency}
            data-testid={`currency-chip-${currency.toLowerCase()}`}
            className={selectedCurrency === currency ? "active" : ""}
            onClick={() => setSelectedCurrency(currency)}
          >
            {currency}
          </button>
        ))}
      </div>

      {/* Sorting options */}
      <div data-testid="sort-controls" className="flex gap-2 mb-4">
        <button
          data-testid="sort-duration-btn"
          onClick={() => setSortBy("duration")}
        >
          Sort by Duration
        </button>
        <button
          data-testid="sort-rate-btn"
          onClick={() => setSortBy("rate")}
        >
          Sort by Interest Rate
        </button>
      </div>

      <ActiveListingsGrid listings={filteredAndSortedListings} />
    </div>
  );
}

describe("ActiveListingsGrid Component", () => {
  it("renders active listings in the grid with token ID, price, and interest rate", () => {
    const listings = [
      mockListing({ id: 1, token_id: 101, max_duration_days: 14 }),
      mockListing({ id: 2, token_id: 202, max_duration_days: 30 }),
    ];

    render(<ActiveListingsGrid listings={listings} />);

    expect(screen.getByTestId("active-listings-grid")).toBeInTheDocument();
    const cards = screen.getAllByTestId("nft-collateral-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("#101")).toBeInTheDocument();
    expect(screen.getByText("#202")).toBeInTheDocument();
    expect(screen.getByText("Max 14 days")).toBeInTheDocument();
    expect(screen.getByText("Max 30 days")).toBeInTheDocument();
  });

  it("renders empty state illustration and message when 0 listings match", () => {
    render(<ActiveListingsGrid listings={[]} />);

    expect(screen.getByTestId("active-listings-empty")).toBeInTheDocument();
    expect(screen.getByTestId("package-open-icon")).toBeInTheDocument();
    expect(screen.getByText("No active listings found")).toBeInTheDocument();
    expect(
      screen.getByText(
        "There are currently no NFTs available for lending. Check back soon or create a listing to get started."
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId("active-listings-grid")).not.toBeInTheDocument();
  });

  it("renders loading indicator when isLoading is true", () => {
    render(<ActiveListingsGrid listings={[]} isLoading={true} />);

    expect(screen.getByTestId("active-listings-loading")).toBeInTheDocument();
    expect(screen.getByTestId("loader2-icon")).toBeInTheDocument();
    expect(screen.getByText("Loading active listings…")).toBeInTheDocument();
  });

  it("supports custom card renderer callback", () => {
    const listings = [mockListing({ id: 55, token_id: 999 })];

    render(
      <ActiveListingsGrid
        listings={listings}
        renderCard={(listing) => (
          <div key={listing.id} data-testid="custom-card">
            Custom Card Token #{listing.token_id.toString()}
          </div>
        )}
      />
    );

    expect(screen.getByTestId("custom-card")).toHaveTextContent("Custom Card Token #999");
    expect(screen.queryByTestId("nft-collateral-card")).not.toBeInTheDocument();
  });

  it("filters listings by currency filter chips and displays empty state when 0 match filter", () => {
    const listings = [
      { ...mockListing({ id: 1, token_id: 1 }), currency: "XLM" },
      { ...mockListing({ id: 2, token_id: 2 }), currency: "USDC" },
    ];

    render(<FilterableActiveListingsView initialListings={listings} />);

    // Initially shows both
    expect(screen.getAllByTestId("nft-collateral-card")).toHaveLength(2);

    // Click USDC filter chip
    fireEvent.click(screen.getByTestId("currency-chip-usdc"));
    expect(screen.getAllByTestId("nft-collateral-card")).toHaveLength(1);
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.queryByText("#1")).not.toBeInTheDocument();

    // Click yXLM filter chip (which matches 0 listings)
    fireEvent.click(screen.getByTestId("currency-chip-yxlm"));
    expect(screen.getByTestId("active-listings-empty")).toBeInTheDocument();
    expect(screen.getByText("No active listings found")).toBeInTheDocument();

    // Reset back to All
    fireEvent.click(screen.getByTestId("currency-chip-all"));
    expect(screen.getAllByTestId("nft-collateral-card")).toHaveLength(2);
  });

  it("sorts listings by duration and interest rate correctly", () => {
    const listings = [
      mockListing({ id: 1, token_id: 1, max_duration_days: 60, interest_schedule_bps: [500] }),
      mockListing({ id: 2, token_id: 2, max_duration_days: 15, interest_schedule_bps: [200] }),
      mockListing({ id: 3, token_id: 3, max_duration_days: 30, interest_schedule_bps: [350] }),
    ];

    render(<FilterableActiveListingsView initialListings={listings} />);

    // Sort by duration (ascending: 15, 30, 60)
    fireEvent.click(screen.getByTestId("sort-duration-btn"));
    let cards = screen.getAllByTestId("nft-collateral-card");
    expect(cards[0]).toHaveTextContent("#2");
    expect(cards[1]).toHaveTextContent("#3");
    expect(cards[2]).toHaveTextContent("#1");

    // Sort by interest rate (ascending: 200, 350, 500)
    fireEvent.click(screen.getByTestId("sort-rate-btn"));
    cards = screen.getAllByTestId("nft-collateral-card");
    expect(cards[0]).toHaveTextContent("#2");
    expect(cards[1]).toHaveTextContent("#3");
    expect(cards[2]).toHaveTextContent("#1");
  });
});
