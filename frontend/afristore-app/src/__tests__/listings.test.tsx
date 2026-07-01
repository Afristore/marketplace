import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import ListingInteractiveArea from "@/app/listings/[id]/ListingInteractiveArea";

// Mock the dependencies
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({ publicKey: null }),
}));

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "9999" }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/contract", () => ({
  getListing: jest.fn(() => Promise.reject(new Error("Not found"))),
  getAuction: jest.fn(() => Promise.reject(new Error("Not found"))),
  stroopsToXlm: (_s: unknown) => "0",
}));

jest.mock("@/hooks/useMarketplace", () => ({
  useBuyArtwork: () => ({ buy: jest.fn(), isBuying: false, error: null }),
}));

jest.mock("@/hooks/usePlaceBid", () => ({
  usePlaceBid: () => ({ bid: jest.fn(), isBidding: false, error: null }),
}));

jest.mock("@/hooks/useOffers", () => ({
  useListingOffers: () => ({
    offers: [],
    isLoading: false,
    refresh: jest.fn(),
  }),
  useMakeOffer: () => ({ make: jest.fn(), isOffering: false, error: null }),
}));

jest.mock("@/hooks/useUserActivity", () => ({
  useListingActivity: () => ({ activities: [], isLoading: false }),
}));

describe("Regression Test: Invalid Listing IDs", () => {
  it("renders empty interactive area for null listing and auction", async () => {
    render(
      <ListingInteractiveArea
        id="9999"
        listing={null}
        auction={null}
        metadata={null}
      />,
    );

    // With no listing/auction the interactive area renders without crashing
    await waitFor(() => {
      expect(screen.getByText(/details/i)).toBeInTheDocument();
    });
  });
});
