import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LendingBorrowPage from "@/app/lending/borrow/page";
import type { IndexedLendingListing } from "@/hooks/useActiveListings";

const mockFetch = jest.fn();
const originalFetch = global.fetch;
let mockWallet = {
  publicKey: "GBORROWER",
  isConnected: true,
  isWrongNetwork: false,
};

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockWallet,
}));
jest.mock("@/hooks/useLendingStats", () => ({
  useLendingStats: () => ({
    stats: { tvl: 1200, volume24h: 50, activeLoans: 2 },
    isLoading: false,
  }),
}));
// Keep the real GuardButton so disconnected and wrong-network clicks exercise its guard.
jest.mock("@/components/ConnectWalletModal", () => ({
  ConnectWalletModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? (
      <div role="dialog" aria-label="Connect wallet">
        Connect your wallet
      </div>
    ) : null,
}));

const listings: IndexedLendingListing[] = [
  {
    listingId: "3",
    lender: "GLENDER_MASK",
    nftContract: "CMASK",
    tokenId: "42",
    name: "Savanna Mask",
    declaredPriceUsd: "100000000.0000000",
    interestScheduleBps: [500],
    maxDurationDays: 30,
    minCollateralBufferBps: 12000,
    liquidationThresholdBps: 11000,
    status: "Open",
  },
  {
    listingId: "4",
    lender: "GLENDER_BRONZE",
    nftContract: "CBRONZE",
    tokenId: "99",
    name: "Benin Bronze",
    declaredPriceUsd: "200000000",
    interestScheduleBps: [300],
    maxDurationDays: 90,
    minCollateralBufferBps: 13000,
    liquidationThresholdBps: 11000,
    status: "Open",
  },
];

function response(data = listings, total = data.length) {
  return { ok: true, json: async () => ({ listings: data, total }) };
}

describe("LendingBorrowPage", () => {
  beforeAll(() => {
    global.fetch = mockFetch;
    // jsdom has no native dialog methods. Preserve native open/close semantics.
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      fireEvent(this, new Event("close"));
    };
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = {
      publicKey: "GBORROWER",
      isConnected: true,
      isWrongNetwork: false,
    };
    mockFetch.mockReset().mockResolvedValue(response());
  });

  it("renders the page, platform stats and only open lending offers", async () => {
    mockFetch.mockResolvedValue(
      response([
        ...listings,
        {
          ...listings[0],
          listingId: "5",
          name: "Filled Offer",
          status: "Filled",
        },
      ]),
    );
    render(<LendingBorrowPage />);
    expect(
      screen.getByRole("heading", { name: "Borrow against NFTs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading lending offers" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Savanna Mask" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Benin Bronze" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("1.2K XLM")).toBeInTheDocument();
    expect(screen.queryByText("Filled Offer")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/lending/listings?limit=20&offset=0"),
      expect.any(Object),
    );
  });

  it("filters listing names case-insensitively, handles no matches and restores results", async () => {
    render(<LendingBorrowPage />);
    await screen.findByText("Savanna Mask");
    const search = screen.getByRole("searchbox", {
      name: "Search listings by name",
    });
    await userEvent.type(search, "MASK");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Savanna Mask")).toBeInTheDocument();
    expect(screen.queryByText("Benin Bronze")).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "missing");
    expect(screen.getByRole("status")).toHaveTextContent(
      "No lending offers match your search.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("opens the selected offer's details and closes them without creating a loan", async () => {
    render(<LendingBorrowPage />);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "View loan details for Benin Bronze",
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Loan details: Benin Bronze",
    });
    expect(within(dialog).getByText("CBRONZE")).toBeInTheDocument();
    expect(within(dialog).getByText("$20")).toBeInTheDocument();
    expect(within(dialog).getByText("90 days")).toBeInTheDocument();
    expect(within(dialog).getByText("3%")).toBeInTheDocument();
    expect(within(dialog).getByText("130%")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Close details" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnected", "wrong network"])(
    "guards the loan details action when the wallet is %s",
    async (state) => {
      mockWallet.isConnected = state !== "disconnected";
      mockWallet.isWrongNetwork = state === "wrong network";
      render(<LendingBorrowPage />);
      await userEvent.click(
        await screen.findByRole("button", {
          name: "View loan details for Savanna Mask",
        }),
      );
      expect(
        screen.getByRole("dialog", { name: "Connect wallet" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("dialog", { name: /Loan details:/ }),
      ).not.toBeInTheDocument();
    },
  );

  it("uses an NFT name fallback for offers without metadata", async () => {
    mockFetch.mockResolvedValue(
      response([{ ...listings[0], name: undefined }]),
    );
    render(<LendingBorrowPage />);
    expect(
      await screen.findByRole("heading", { name: "NFT #42" }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox"), "#42");
    expect(
      screen.getByRole("button", { name: "View loan details for NFT #42" }),
    ).toBeInTheDocument();
  });

  it("shows a genuine empty state when there are no open offers", async () => {
    mockFetch.mockResolvedValue(response([]));
    render(<LendingBorrowPage />);
    expect(
      await screen.findByText("No active lending offers found."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("shows request failures and retries the lending request", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    render(<LendingBorrowPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Savanna Mask")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("requests subsequent pages and disables navigation at the page boundaries", async () => {
    mockFetch.mockResolvedValue(response(listings, 21));
    render(<LendingBorrowPage />);
    const previous = await screen.findByRole("button", { name: "← Prev" });
    expect(previous).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next →" }));
    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("offset=20"),
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("Page 2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "← Prev" }));
    expect(await screen.findByText("Page 1 / 2")).toBeInTheDocument();
  });
});
