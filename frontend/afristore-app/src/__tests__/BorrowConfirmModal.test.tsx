/**
 * Component tests for BorrowConfirmModal.
 * Wallet context, the borrow hook and the embedded InterestScheduleChart
 * are mocked so the suite runs deterministically without Recharts or a
 * wallet provider.
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BorrowConfirmModal } from "@/components/lending/BorrowConfirmModal";
import type { LendingOffer } from "@/components/lending/types";

// ── Mocks ─────────────────────────────────────────────────────

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    const {
      fill: _fill,
      unoptimized: _unoptimized,
      priority: _priority,
      quality: _quality,
      alt,
      ...rest
    } = props;
    return <img alt={alt || ""} {...rest} />;
  },
}));

jest.mock("@/lib/ipfs", () => ({
  cidToGatewayUrl: (cid: string) => cid,
}));

jest.mock("@/components/lending/InterestScheduleChart", () => ({
  InterestScheduleChart: () => <div data-testid="schedule-chart-mock" />,
}));

jest.mock("@/config/tokens", () => ({
  getTokenConfigByAddress: () => ({
    symbol: "USDC",
    name: "USDC",
    address: "CUSDC123",
    decimals: 7,
  }),
}));

const mockBorrow = jest.fn();
let mockIsBorrowing = false;
let mockBorrowError: string | null = null;

jest.mock("@/hooks/mutations/useBorrowTransaction", () => ({
  useBorrowTransaction: () => ({
    borrow: (...args: unknown[]) => mockBorrow(...args),
    executeBorrow: (args: unknown) => mockBorrow(args),
    isBorrowing: mockIsBorrowing,
    isLoading: mockIsBorrowing,
    error: mockBorrowError,
  }),
}));

let mockWallet = {
  publicKey: "GBORROWER123",
  isConnected: true,
};

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => mockWallet,
}));

// ── Helpers ───────────────────────────────────────────────────

const USDC = "CUSDC123";

function makeOffer(overrides: Partial<LendingOffer> = {}): LendingOffer {
  return {
    id: 5,
    lender: "GLENDER123",
    nft_contract: "CCOLLECTIONCONTRACT123456789",
    token_id: 3,
    nftName: "Golden Benin Bronze",
    declared_price_usd: 100_000_000n, // $10.00
    interest_schedule_bps: [500, 1000],
    max_duration_days: 30,
    min_collateral_buffer_bps: 12000, // 120% => $12.00
    liquidation_threshold_bps: 11000, // 110%
    status: "Open",
    created_at: 0,
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  isOpen: true,
  listing: makeOffer(),
  collateralCurrency: USDC,
  collateralAmount: 1_500_000_000n, // 150.0000000 USDC
  onClose: jest.fn(),
};

function renderModal(props: Partial<typeof DEFAULT_PROPS> = {}) {
  return render(<BorrowConfirmModal {...DEFAULT_PROPS} {...props} />);
}

describe("BorrowConfirmModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBorrow.mockResolvedValue(202);
    mockIsBorrowing = false;
    mockBorrowError = null;
    mockWallet = { publicKey: "GBORROWER123", isConnected: true };
  });

  it("renders nothing when closed or with no listing", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();

    const { container: empty } = renderModal({ listing: null, isOpen: true });
    expect(empty.firstChild).toBeNull();
  });

  it("displays the exact collateral required for the selected NFT", () => {
    renderModal();

    expect(screen.getByTestId("borrow-confirm-modal")).toBeInTheDocument();
    expect(screen.getByText("Golden Benin Bronze")).toBeInTheDocument();
    // 1_500_000_000 smallest units / 1e7 = "150" USDC
    expect(screen.getByTestId("collateral-exact-amount")).toHaveTextContent(
      "150 USDC",
    );
    // USD equivalent: $10.00 * 120% = $12.00
    expect(screen.getByText(/\$12\.00/)).toBeInTheDocument();
  });

  it("warns the user about liquidation risks", () => {
    renderModal();

    expect(screen.getByText("Liquidation Risk")).toBeInTheDocument();
    expect(
      screen.getByText(/position can be liquidated/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/110%/)).toBeInTheDocument();
  });

    it("executes the borrow transaction with the exact collateral on submit", async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();
    renderModal({ onSuccess, onClose });

    fireEvent.click(screen.getByTestId("confirm-borrow"));

    expect(mockBorrow).toHaveBeenCalledWith({
      listingId: 5,
      collateralCurrency: USDC,
      collateralAmount: 1_500_000_000n,
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(202);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("disables submit while the transaction is in flight", () => {
    mockIsBorrowing = true;
    renderModal();

    const confirm = screen.getByTestId("confirm-borrow");
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/Signing transaction\.\.\./)).toBeInTheDocument();
  });

  it("disables submit and prompts to connect when no wallet is connected", () => {
    mockWallet = { publicKey: null, isConnected: false };
    renderModal();

    expect(screen.getByTestId("confirm-borrow")).toBeDisabled();
    expect(
      screen.getByText(/Connect your wallet to borrow against this NFT\./),
    ).toBeInTheDocument();
  });

  it("surfaces errors returned by the borrow hook", () => {
    mockBorrowError = "Insufficient balance for collateral requirement";
    renderModal();

    expect(screen.getByTestId("borrow-error")).toHaveTextContent(
      "Insufficient balance for collateral requirement",
    );
  });

  it("closes via the close button", () => {
    const onClose = jest.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});