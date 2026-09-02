/**
 * Unit tests for lending UI components:
 * - ActiveListingsGrid (issue #763)
 * - LenderDashboardTable (issue #765)
 * - RepayLoanModal (issue #761)
 * - CreateListingModal (issue #758)
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActiveListingsGrid } from "@/components/lending/ActiveListingsGrid";
import {
  LenderDashboardTable,
  type LenderListingRow,
} from "@/components/lending/LenderDashboardTable";
import { RepayLoanModal } from "@/components/lending/RepayLoanModal";
import {
  CreateListingModal,
  step1Schema,
  step2Schema,
  step3Schema,
} from "@/components/lending/CreateListingModal";
import type { Position } from "@/lib/lending";

jest.mock("@/lib/lending", () => ({
  calculateReturnFees: jest.fn(() => ({
    principalUsd: 1000000000n,
    accruedInterestUsd: 30000000n,
    platformFeeUsd: 10300000n,
    totalRequiredUsd: 1040300000n,
  })),
}));


jest.mock("@/hooks/mutations/useReturnNFT", () => ({
  useReturnNFT: () => ({
    returnNFT: mockReturnNFT,
    executeReturnNFT: mockReturnNFT,
    isReturningNFT: false,
    isLoading: false,
    error: null,
  }),
}));

jest.mock("@/hooks/useMarketplace", () => ({
  useCreateListing: () => ({
    create: mockCreate,
    isCreating: false,
    progress: "",
    error: null,
  }),
}));

const mockReturnNFT = jest.fn().mockResolvedValue(true);
const mockCreate = jest.fn().mockResolvedValue(42);

const listing = (id: number) => ({
  id: BigInt(id),
  lender: "GAAA",
  nft_contract: `CONTRACT${id}`,
  token_id: BigInt(id),
  declared_price_usd: BigInt(250 * 10_000_000),
  interest_schedule_bps: [300, 350],
  max_duration_days: 90,
  min_collateral_buffer_bps: 12000,
  liquidation_threshold_bps: 11000,
  status: "Open" as const,
  created_at: 0,
});

const lenderRow = (overrides: Partial<LenderListingRow> = {}): LenderListingRow => ({
  id: 1,
  nftContract: "CONTRACT1",
  tokenId: 1,
  principalUsd: BigInt(250 * 10_000_000),
  earnedInterestUsd: BigInt(10 * 10_000_000),
  currency: "XLM",
  status: "Open",
  ...overrides,
});

const position = (overrides: Partial<Position> = {}): Position => ({
  id: 7,
  listing_id: 1,
  lender: "GLENDER",
  borrower: "GBORROWER",
  nft_contract: "CONTRACT",
  token_id: 1,
  declared_price_usd: BigInt(100 * 10_000_000),
  collateral_currency: "XLM",
  collateral_amount: BigInt(150 * 10_000_000),
  interest_schedule_bps: [300],
  liquidation_threshold_bps: 11000,
  start_time: Math.floor(Date.now() / 1000) - 86400,
  max_duration_secs: 90 * 86400,
  status: "Active",
  ...overrides,
});

// ── ActiveListingsGrid (#763) ─────────────────────────────────

describe("ActiveListingsGrid", () => {
  it("renders a card per listing in a responsive grid", () => {
    render(<ActiveListingsGrid listings={[listing(1), listing(2)]} />);
    expect(screen.getByTestId("active-listings-grid")).toBeInTheDocument();
    expect(screen.getAllByTestId("nft-collateral-card")).toHaveLength(2);
  });

  it("shows the empty state when there are no listings", () => {
    render(<ActiveListingsGrid listings={[]} />);
    expect(screen.getByText("No active listings found")).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    render(<ActiveListingsGrid listings={[]} isLoading />);
    expect(screen.getByTestId("active-listings-loading")).toBeInTheDocument();
  });
});

// ── LenderDashboardTable (#765) ───────────────────────────────

describe("LenderDashboardTable", () => {
  it("renders rows with status badges", () => {
    render(
      <LenderDashboardTable
        rows={[
          lenderRow({ id: 1, status: "Open" }),
          lenderRow({ id: 2, status: "Active Loan" }),
          lenderRow({ id: 3, status: "Repaid" }),
          lenderRow({ id: 4, status: "Liquidated" }),
        ]}
      />,
    );
    expect(screen.getByTestId("lender-dashboard-table")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Active Loan")).toBeInTheDocument();
    expect(screen.getByText("Repaid")).toBeInTheDocument();
    expect(screen.getByText("Liquidated")).toBeInTheDocument();
  });

  it("shows Cancel Listing only for Open rows", () => {
    render(
      <LenderDashboardTable
        rows={[
          lenderRow({ id: 1, status: "Open" }),
          lenderRow({ id: 2, status: "Active Loan" }),
        ]}
        onCancelListing={jest.fn()}
      />,
    );
    expect(screen.getByTestId("cancel-listing-1")).toBeInTheDocument();
    expect(screen.queryByTestId("cancel-listing-2")).not.toBeInTheDocument();
  });

  it("displays earned interest for Active Loan and Repaid rows only", () => {
    render(
      <LenderDashboardTable
        rows={[
          lenderRow({ id: 1, status: "Active Loan" }),
          lenderRow({ id: 2, status: "Repaid" }),
          lenderRow({ id: 3, status: "Open" }),
        ]}
      />,
    );
    expect(screen.getByTestId("earned-interest-1")).toBeInTheDocument();
    expect(screen.getByTestId("earned-interest-2")).toBeInTheDocument();
    expect(screen.queryByTestId("earned-interest-3")).not.toBeInTheDocument();
  });

  it("invokes onCancelListing with the row", async () => {
    const onCancel = jest.fn();
    render(
      <LenderDashboardTable rows={[lenderRow({ id: 9 })]} onCancelListing={onCancel} />,
    );
    await userEvent.click(screen.getByTestId("cancel-listing-9"));
    expect(onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 9, status: "Open" }),
    );
  });

  it("shows empty state when there are no rows", () => {
    render(<LenderDashboardTable rows={[]} />);
    expect(screen.getByTestId("lender-table-empty")).toBeInTheDocument();
  });
});


// ── RepayLoanModal (#761) ─────────────────────────────────────

describe("RepayLoanModal", () => {
  const base = {
    isOpen: true,
    onClose: jest.fn(),
    borrowerPublicKey: "GBORROWER",
  };

  it("renders the fee breakdown (principal, interest, platform fee, total)", () => {
    render(<RepayLoanModal {...base} position={position()} />);
    expect(screen.getByText("Principal")).toBeInTheDocument();
    expect(screen.getByText("Accrued Interest")).toBeInTheDocument();
    expect(screen.getByText(/Platform Fee/)).toBeInTheDocument();
    expect(screen.getByTestId("repay-total")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<RepayLoanModal {...base} isOpen={false} position={position()} />);
    expect(screen.queryByTestId("repay-loan-modal")).not.toBeInTheDocument();
  });

  it("executes useReturnNFT on confirm and shows success", async () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();
    render(
      <RepayLoanModal
        {...base}
        onClose={onClose}
        onSuccess={onSuccess}
        position={position()}
      />,
    );
    await userEvent.click(screen.getByTestId("repay-confirm"));
    await waitFor(() => {
      expect(mockReturnNFT).toHaveBeenCalledWith(7);
      expect(screen.getByText("Loan repaid successfully!")).toBeInTheDocument();
    });
    expect(onSuccess).toHaveBeenCalled();
  });
});

// ── CreateListingModal (#758) ─────────────────────────────────

describe("CreateListingModal Zod schemas", () => {
  it("step1 rejects empty or zero prices", () => {
    expect(
      step1Schema.safeParse({ declaredPriceUsd: "", maxDurationDays: "30" }).success,
    ).toBe(false);
    expect(
      step1Schema.safeParse({ declaredPriceUsd: "0", maxDurationDays: "30" }).success,
    ).toBe(false);
    expect(
      step1Schema.safeParse({ declaredPriceUsd: "250.5", maxDurationDays: "30" })
        .success,
    ).toBe(true);
  });

  it("step2 validates the interest schedule array", () => {
    expect(
      step2Schema.safeParse({ interestScheduleBps: "300, 350, 400" }).success,
    ).toBe(true);
    expect(step2Schema.safeParse({ interestScheduleBps: "300, -5" }).success).toBe(false);
    expect(step2Schema.safeParse({ interestScheduleBps: "abc" }).success).toBe(false);
    expect(step2Schema.safeParse({ interestScheduleBps: "" }).success).toBe(false);
  });

  it("step3 enforces buffer / threshold bounds and ordering", () => {
    expect(
      step3Schema.safeParse({
        minCollateralBufferBps: "12000",
        liquidationThresholdBps: "11000",
      }).success,
    ).toBe(true);
    expect(
      step3Schema.safeParse({
        minCollateralBufferBps: "11000",
        liquidationThresholdBps: "12000",
      }).success,
    ).toBe(false);
    expect(
      step3Schema.safeParse({
        minCollateralBufferBps: "5000",
        liquidationThresholdBps: "4000",
      }).success,
    ).toBe(false);
  });
});

describe("CreateListingModal", () => {
  const base = {
    isOpen: true,
    onClose: jest.fn(),
    lenderPublicKey: "GLENDER",
    collectionAddress: "CCOLLECTION",
    nftTokenId: 3,
  };

  it("renders step 1 and blocks Next with invalid input", async () => {
    render(<CreateListingModal {...base} />);
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("create-listing-next"));
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByTestId("error-declaredPriceUsd")).toBeInTheDocument();
  });

  it("advances through all steps and submits via useCreateListing", async () => {
    const onSuccess = jest.fn();
    const onClose = jest.fn();
    render(<CreateListingModal {...base} onClose={onClose} onSuccess={onSuccess} />);

    await userEvent.type(screen.getByLabelText(/Declared Price/i), "250.00");
    await userEvent.type(screen.getByLabelText(/Max Loan Duration/i), "90");
    await userEvent.click(screen.getByTestId("create-listing-next"));

    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText(/Monthly Interest Schedule/i),
      "300, 350",
    );
    await userEvent.click(screen.getByTestId("create-listing-next"));

    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Min Collateral Buffer/i), "12000");
    await userEvent.type(screen.getByLabelText(/Liquidation Threshold/i), "11000");
    await userEvent.click(screen.getByTestId("create-listing-submit"));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ nftTokenId: 3, price: 250 }),
      );
      expect(onSuccess).toHaveBeenCalledWith(42);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("does not render when closed", () => {
    render(<CreateListingModal {...base} isOpen={false} />);
    expect(screen.queryByTestId("create-listing-modal")).not.toBeInTheDocument();
  });
});

