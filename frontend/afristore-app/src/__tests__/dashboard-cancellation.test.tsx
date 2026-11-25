import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DashboardPage from "@/app/dashboard/page";

const mockCancel = jest.fn();
const mockRefresh = jest.fn();
const mockPushToast = jest.fn();

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({
    publicKey: "GARTIST1234567890",
  }),
}));

jest.mock("@/components/WalletGuard", () => ({
  WalletGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/hooks/useSafeToast", () => ({
  useSafeToast: () => mockPushToast,
}));

jest.mock("@/hooks/useMarketplace", () => ({
  useArtistListings: () => ({
    listings: [
      {
        listing_id: 42,
        artist: "GARTIST1234567890",
        token_id: 101,
        price: 50_000_000n, // 5 XLM
        token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        status: "Active",
        metadata_cid: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      },
    ],
    isLoading: false,
    refresh: mockRefresh,
  }),
  useCancelListing: () => ({
    cancel: mockCancel,
    isCancelling: false,
  }),
}));

jest.mock("@/components/ListingForm", () => ({
  ListingForm: () => <div>ListingForm</div>,
}));
jest.mock("@/components/AuctionForm", () => ({
  AuctionForm: () => <div>AuctionForm</div>,
}));
jest.mock("@/components/ArtistAuctionsList", () => ({
  ArtistAuctionsList: () => <div>ArtistAuctionsList</div>,
}));
jest.mock("@/components/OwnedNFTGallery", () => ({
  OwnedNFTGallery: () => <div>OwnedNFTGallery</div>,
}));

describe("DashboardPage - Listing Cancellation Confirmation (#1343)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not immediately cancel listing on button click; opens confirmation modal", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    expect(cancelButton).toBeInTheDocument();

    await user.click(cancelButton);

    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();

    // Modal dialog must be visible with listing summary
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Confirm on-chain listing cancellation/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("#42")).toBeInTheDocument();
    expect(within(dialog).getByText("#101")).toBeInTheDocument();
  });

  it("dismisses modal when 'Keep Listing' is clicked without cancelling", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const keepButton = screen.getByRole("button", { name: /keep listing/i });
    await user.click(keepButton);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("calls cancel and refreshes only after successful confirmation", async () => {
    mockCancel.mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const confirmButton = screen.getByRole("button", { name: /confirm cancel/i });

    await user.click(confirmButton);

    expect(mockCancel).toHaveBeenCalledWith(42);
    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringContaining("cancelled successfully"),
        "success",
      );
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("handles cancellation failure and does not refresh on failure", async () => {
    mockCancel.mockResolvedValueOnce(false);
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    const confirmButton = screen.getByRole("button", { name: /confirm cancel/i });

    await user.click(confirmButton);

    expect(mockCancel).toHaveBeenCalledWith(42);
    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to cancel listing #42"),
        "error",
      );
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});
