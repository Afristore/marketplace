/**
 * Profile "Purchased" tab (#1341): owned listings come from an owner-scoped
 * indexer query that includes Sold listings, not the Active-only feed.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const mockFetchOwnedListings = jest.fn();

jest.mock("@/lib/indexer", () => ({
  fetchListings: jest.fn().mockResolvedValue({ listings: [] }),
  fetchArtistListings: jest.fn().mockResolvedValue([]),
  fetchOwnedListings: (...a: unknown[]) => mockFetchOwnedListings(...a),
}));
jest.mock("@/lib/contract", () => ({
  getAllListings: jest.fn(),
  getListing: jest.fn(),
  getArtistListings: jest.fn(),
  buyArtwork: jest.fn(),
  updateListing: jest.fn(),
  stroopsToXlm: () => "1",
}));
jest.mock("@/lib/config", () => ({ config: { indexerUrl: "" } }));
jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));
jest.mock("@/providers/PostHogProvider", () => ({ trackEvent: jest.fn() }));

import { useOwnedListings } from "@/hooks/useMarketplace";

function Probe({ owner }: { owner: string | null }) {
  const { listings, error, isLoading } = useOwnedListings(owner);
  return (
    <div>
      <span data-testid="ids">{listings.map((l) => l.listing_id).join(",")}</span>
      <span data-testid="statuses">{listings.map((l) => l.status).join(",")}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="loading">{String(isLoading)}</span>
    </div>
  );
}

describe("useOwnedListings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("does nothing without a wallet", () => {
    render(<Probe owner={null} />);
    expect(mockFetchOwnedListings).not.toHaveBeenCalled();
    expect(screen.getByTestId("ids").textContent).toBe("");
  });

  it("returns Sold listings owned by the wallet, newest first", async () => {
    mockFetchOwnedListings.mockResolvedValue([
      { listing_id: 1, owner: "GBUYER", artist: "GART", status: "Sold", created_at: 10 },
      { listing_id: 2, owner: "GBUYER", artist: "GART", status: "Sold", created_at: 20 },
    ]);
    render(<Probe owner="GBUYER" />);
    await waitFor(() =>
      expect(screen.getByTestId("ids").textContent).toBe("2,1"),
    );
    expect(mockFetchOwnedListings).toHaveBeenCalledWith("GBUYER");
    expect(screen.getByTestId("statuses").textContent).toBe("Sold,Sold");
  });

  it("surfaces an error when the indexer fails", async () => {
    mockFetchOwnedListings.mockRejectedValue(new Error("down"));
    render(<Probe owner="GBUYER" />);
    await waitFor(() =>
      expect(screen.getByTestId("error").textContent).toBe(
        "Failed to load owned artworks",
      ),
    );
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
