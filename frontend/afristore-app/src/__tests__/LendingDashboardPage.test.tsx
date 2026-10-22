import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@/i18n";
import LendingDashboardPage from "@/app/lending/dashboard/page";
import type { IndexedLendingPosition } from "@/hooks/useLendingPositions";

const mockConnect = jest.fn();
let mockWallet = {
  isConnected: true,
  publicKey: "GBORROWER" as string | null,
  connect: mockConnect,
};
const mockFetch = jest.fn();
const originalFetch = global.fetch;

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockWallet,
}));

const position: IndexedLendingPosition = {
  positionId: "7",
  listingId: "3",
  nftContract: "CMASK",
  tokenId: "42",
  declaredPriceUsd: "100000000.0000000",
  collateralCurrency: "CUSDC",
  interestScheduleBps: [500],
  liquidationThresholdBps: 11000,
  startTime: String(Math.floor(Date.now() / 1000) - 30 * 86400),
  status: "Active",
  healthFactor: "1.5",
};

function respond(data: unknown) {
  return { ok: true, json: async () => data };
}

describe("LendingDashboardPage", () => {
  beforeAll(() => {
    global.fetch = mockFetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet = {
      isConnected: true,
      publicKey: "GBORROWER",
      connect: mockConnect,
    };
    mockFetch.mockReset().mockImplementation(async (url: string) =>
      respond(
        url.includes("/positions/lender/")
          ? [
              {
                ...position,
                positionId: "8",
                tokenId: "99",
                nftContract: "CBRONZE",
              },
            ]
          : [
              position,
              {
                ...position,
                positionId: "9",
                tokenId: "55",
                status: "Returned",
              },
            ],
      ),
    );
  });

  it("asks a disconnected user to connect without fetching private positions", async () => {
    mockWallet.isConnected = false;
    mockWallet.publicKey = null;
    render(<LendingDashboardPage />);
    expect(
      screen.getByRole("heading", { name: "Connect Your Wallet" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Connect Wallet" }),
    );
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("tablist", { name: "Dashboard view" }),
    ).not.toBeInTheDocument();
  });

  it("defaults to the real borrower table, showing only active loans and the indexed health factor", async () => {
    render(<LendingDashboardPage />);
    const table = await screen.findByRole("table");
    expect(screen.getByRole("tab", { name: "Borrower" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(table).getByText("NFT #42")).toBeInTheDocument();
    expect(within(table).getByText("$10.50")).toBeInTheDocument();
    expect(within(table).getByText("150.00%")).toBeInTheDocument();
    expect(within(table).queryByText("NFT #55")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("lender-dashboard-table"),
    ).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/lending/positions/GBORROWER"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("switches to the real lender table and back, updating which table is mounted", async () => {
    render(<LendingDashboardPage />);
    await screen.findByText("150.00%");
    await userEvent.click(screen.getByRole("tab", { name: "Lender" }));
    const lender = await screen.findByTestId("lender-dashboard-table");
    expect(within(lender).getByText("CBRONZE")).toBeInTheDocument();
    expect(within(lender).getByText("Active Loan")).toBeInTheDocument();
    expect(within(lender).getByText("+$0.50")).toBeInTheDocument();
    expect(within(lender).getByText("#99")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Lender" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Borrower" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.queryByTestId("borrower-debts-table"),
    ).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/lending/positions/lender/GBORROWER"),
      expect.any(Object),
    );
    await userEvent.click(screen.getByRole("tab", { name: "Borrower" }));
    expect(await screen.findByText("150.00%")).toBeInTheDocument();
    expect(
      screen.queryByTestId("lender-dashboard-table"),
    ).not.toBeInTheDocument();
  });

  it("supports keyboard navigation between the borrower and lender tabs", async () => {
    render(<LendingDashboardPage />);
    await screen.findByText("150.00%");
    screen.getByRole("tab", { name: "Borrower" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Lender" })).toHaveFocus();
    expect(
      await screen.findByTestId("lender-dashboard-table"),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Borrower" })).toHaveFocus();
    expect(await screen.findByText("150.00%")).toBeInTheDocument();
  });

  it("accepts joined position responses and shows an unavailable oracle quote without inventing a health factor", async () => {
    mockFetch.mockResolvedValue(
      respond([
        { position: { ...position, healthFactor: null }, listing: null },
      ]),
    );
    render(<LendingDashboardPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("NFT #42")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument();
    expect(within(table).queryByText("0.00%")).not.toBeInTheDocument();
  });

  it("renders loading followed by the borrower and lender empty states", async () => {
    mockFetch.mockResolvedValue(respond([]));
    render(<LendingDashboardPage />);
    expect(screen.getByText("Loading your active debts…")).toBeInTheDocument();
    expect(await screen.findByText("No Active Debts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Lender" }));
    expect(await screen.findByText("No Listings Yet")).toBeInTheDocument();
  });

  it("retries a failed position request instead of showing an empty portfolio", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    render(<LendingDashboardPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(screen.queryByText("No Active Debts")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("150.00%")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("clears the old wallet's table on disconnect and requests the new wallet after reconnecting", async () => {
    const { rerender } = render(<LendingDashboardPage />);
    await screen.findByText("150.00%");
    mockWallet = { ...mockWallet, isConnected: false, publicKey: null };
    rerender(<LendingDashboardPage />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    mockFetch.mockResolvedValue(respond([]));
    mockWallet = { ...mockWallet, isConnected: true, publicKey: "GNEW_WALLET" };
    rerender(<LendingDashboardPage />);
    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/positions/GNEW_WALLET"),
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("No Active Debts")).toBeInTheDocument();
    expect(screen.queryByText("NFT #42")).not.toBeInTheDocument();
  });
});
