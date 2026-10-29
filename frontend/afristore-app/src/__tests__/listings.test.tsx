import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ListingInteractiveArea from "@/app/listings/[id]/ListingInteractiveArea";
import { Listing, Auction } from "@/lib/contract";

const mockBuy = jest.fn();
const mockCancel = jest.fn();
const mockBid = jest.fn();
const mockMakeOffer = jest.fn();
const mockRefreshOffers = jest.fn();
const mockGetListing = jest.fn();
const mockGetAuction = jest.fn();
const mockPushToast = jest.fn();

let mockPublicKey: string | null = null;
let mockBuyError: string | null = null;
let mockCancelError: string | null = null;
let mockBidError: string | null = null;
let mockOfferError: string | null = null;

// Mock the dependencies
jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: mockPublicKey,
    isConnected: Boolean(mockPublicKey),
    isWrongNetwork: false,
  }),
}));

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "9999" }),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/contract", () => ({
  getListing: (...args: unknown[]) => mockGetListing(...args),
  getAuction: (...args: unknown[]) => mockGetAuction(...args),
  stroopsToXlm: (_s: unknown) => "100",
}));

jest.mock("@/hooks/useMarketplace", () => ({
  useBuyArtwork: () => ({
    buy: mockBuy,
    isBuying: false,
    error: mockBuyError,
  }),
  useCancelListing: () => ({
    cancel: mockCancel,
    isCancelling: false,
    error: mockCancelError,
  }),
}));

jest.mock("@/hooks/usePlaceBid", () => ({
  usePlaceBid: () => ({
    bid: mockBid,
    isBidding: false,
    error: mockBidError,
  }),
}));

jest.mock("@/hooks/useOffers", () => ({
  useListingOffers: () => ({
    offers: [],
    isLoading: false,
    refresh: mockRefreshOffers,
  }),
  useMakeOffer: () => ({
    make: mockMakeOffer,
    isOffering: false,
    error: mockOfferError,
  }),
}));

jest.mock("@/hooks/useUserActivity", () => ({
  useListingActivity: () => ({ activities: [], isLoading: false }),
}));

jest.mock("@/hooks/useSafeToast", () => ({
  useSafeToast: () => mockPushToast,
}));

const sampleListing: Listing = {
  listing_id: 1,
  artist: "GARTIST1234567890",
  collection: "CCOLLECTION",
  token_id: 1,
  metadata_cid: "QmSampleCid",
  price: 1000000000n,
  currency: "XLM",
  token: "CAS_XLM",
  recipients: [{ address: "GARTIST1234567890", percentage: 500 }],
  status: "Active",
  owner: null,
  created_at: 1700000000,
};

const sampleAuction: Auction = {
  auction_id: 2,
  creator: "GCREATOR1234567890",
  collection: "CCOLLECTION",
  token_id: 2,
  metadata_cid: "QmAuctionCid",
  reserve_price: 500000000n,
  highest_bid: 600000000n,
  highest_bidder: "GBIDDER",
  end_time: Math.floor(Date.now() / 1000) + 3600,
  token: "CAS_XLM",
  recipients: [{ address: "GCREATOR1234567890", percentage: 500 }],
  status: "Active",
  created_at: 1700000000,
};

describe("Regression Test: Invalid Listing IDs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicKey = null;
    mockBuyError = null;
    mockCancelError = null;
    mockBidError = null;
    mockOfferError = null;
    mockGetListing.mockRejectedValue(new Error("Not found"));
    mockGetAuction.mockRejectedValue(new Error("Not found"));
  });

  it("renders empty interactive area for null listing and auction", async () => {
    try {
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
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});

describe("ListingInteractiveArea Transaction Error Handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPublicKey = "GBUYER1234567890";
    mockBuyError = null;
    mockCancelError = null;
    mockBidError = null;
    mockOfferError = null;
  });

  it("catches rejected purchase transaction and displays readable error alert and toast", async () => {
    try {
      mockBuy.mockRejectedValueOnce(new Error("HostError: Error(Contract, #6)"));

      render(
        <ListingInteractiveArea
          id="1"
          listing={sampleListing}
          auction={null}
          metadata={null}
        />,
      );

      const buyButton = screen.getByRole("button", {
        name: /Purchase Artwork/i,
      });
      fireEvent.click(buyButton);

      await waitFor(() => {
        expect(mockBuy).toHaveBeenCalledWith(1);
      });

      const expectedMsg = "You cannot buy your own listing. (code 6)";
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(expectedMsg);
      });
      expect(mockPushToast).toHaveBeenCalledWith(expectedMsg, "error");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches rejected cancel listing transaction and displays readable error alert and toast", async () => {
    try {
      mockPublicKey = sampleListing.artist;
      mockCancel.mockRejectedValueOnce(new Error("Transaction rejected by user"));

      render(
        <ListingInteractiveArea
          id="1"
          listing={sampleListing}
          auction={null}
          metadata={null}
        />,
      );

      const cancelButton = screen.getByRole("button", {
        name: /Cancel Listing/i,
      });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith(1);
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Transaction rejected by user",
        );
      });
      expect(mockPushToast).toHaveBeenCalledWith(
        "Transaction rejected by user",
        "error",
      );
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches rejected bid transaction and displays readable error alert and toast", async () => {
    try {
      mockBid.mockRejectedValueOnce(new Error("HostError: Error(Contract, #11)"));

      render(
        <ListingInteractiveArea
          id="2"
          listing={null}
          auction={sampleAuction}
          metadata={null}
        />,
      );

      const bidInput = screen.getByPlaceholderText(/Bid amount/i);
      fireEvent.change(bidInput, { target: { value: "75" } });

      const buttons = screen.getAllByRole("button");
      const bidButton = buttons.find(
        (btn) => btn.querySelector("svg.lucide-gavel") !== null,
      );
      expect(bidButton).toBeDefined();
      fireEvent.click(bidButton!);

      await waitFor(() => {
        expect(mockBid).toHaveBeenCalledWith(2, 75);
      });

      const expectedMsg = "Your bid is too low for this auction. (code 11)";
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(expectedMsg);
      });
      expect(mockPushToast).toHaveBeenCalledWith(expectedMsg, "error");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("catches rejected makeOffer transaction and displays readable error alert and toast", async () => {
    try {
      mockMakeOffer.mockRejectedValueOnce(
        new Error("HostError: Error(Contract, #19)"),
      );

      render(
        <ListingInteractiveArea
          id="1"
          listing={sampleListing}
          auction={null}
          metadata={null}
        />,
      );

      const offerInput = screen.getByPlaceholderText(/Offer amount/i);
      fireEvent.change(offerInput, { target: { value: "50" } });

      const offerButton = screen.getByRole("button", { name: /Make Offer/i });
      fireEvent.click(offerButton);

      await waitFor(() => {
        expect(mockMakeOffer).toHaveBeenCalledWith(1, 50, "CAS_XLM");
      });

      const expectedMsg = "Offer amount is too low. (code 19)";
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(expectedMsg);
      });
      expect(mockPushToast).toHaveBeenCalledWith(expectedMsg, "error");
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });

  it("displays inline error banners when hooks report error states without throwing", async () => {
    try {
      mockBuyError = "Insufficient XLM balance";

      render(
        <ListingInteractiveArea
          id="1"
          listing={sampleListing}
          auction={null}
          metadata={null}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Insufficient XLM balance",
        );
      });
    } catch (error) {
      console.error("Test failed:", error);
      throw error;
    }
  });
});
