import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  BorrowerDashboardTable,
  BorrowerDebt,
} from "@/components/lending/BorrowerDashboardTable";

const CURRENCY = "CBGHIJKLMNOPQRSTUVWXYZABC1234567890123456789012345678901234";

const debtA: BorrowerDebt = {
  positionId: 1,
  nftName: "Savanna Mask #1",
  tokenId: 1,
  declaredPriceUsd: 100_000_000n, // $10.00 principal
  collateralCurrency: CURRENCY,
  collateralUsdValue: 150_000_000n, // $15.00 collateral
  interestScheduleBps: [500], // 5% per month
  elapsedMonths: 1, // accrued $0.50
  liquidationThresholdBps: 11000,
};

const debtB: BorrowerDebt = {
  positionId: 2,
  nftName: "Golden Benin Bronze #2",
  tokenId: 2,
  declaredPriceUsd: 100_000_000n, // $10.00 principal
  collateralCurrency: CURRENCY,
  collateralUsdValue: 120_000_000n, // $12.00 collateral
  interestScheduleBps: [1000], // 10% per month
  elapsedMonths: 2, // accrued $2.00
  liquidationThresholdBps: 11000,
};

describe("BorrowerDashboardTable", () => {
  it("renders the table with Current Debt, Health Factor and actions", () => {
    render(<BorrowerDashboardTable debts={[debtA, debtB]} />);

    expect(screen.getByTestId("borrower-debts-table")).toBeInTheDocument();
    expect(screen.getByText("Current Debt")).toBeInTheDocument();
    expect(screen.getByText("Health Factor")).toBeInTheDocument();
    expect(screen.getAllByText("Manage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Top Up").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Repay").length).toBeGreaterThan(0);
  });

  it("computes current debt and health factor from the contract math", () => {
    render(<BorrowerDashboardTable debts={[debtA]} />);

    // A: principal $10.00 + 5% one month = $10.50; HF = 15/10.5 = 142.85%
    expect(screen.getByText("$10.50")).toBeInTheDocument();
    expect(screen.getByText("142.85%")).toBeInTheDocument();

    // B is not rendered here.
    expect(screen.queryByText("$12.00")).not.toBeInTheDocument();
  });

  it("includes Top Up and Repay action buttons in each row", () => {
    render(<BorrowerDashboardTable debts={[debtA, debtB]} />);

    expect(screen.getByTestId("top-up-1")).toBeInTheDocument();
    expect(screen.getByTestId("repay-1")).toBeInTheDocument();
    expect(screen.getByTestId("top-up-2")).toBeInTheDocument();
    expect(screen.getByTestId("repay-2")).toBeInTheDocument();
  });

  it("sorts ascending by health factor by default (highest risk first)", () => {
    render(<BorrowerDashboardTable debts={[debtA, debtB]} />);

    const rowOrder = () =>
      screen
        .getAllByTestId(/^debt-row-\d+$/)
        .map((el) => el.getAttribute("data-testid"));

    // B has 100.00% health, A has 142.85% health.
    expect(rowOrder()).toEqual(["debt-row-2", "debt-row-1"]);
  });

  it("toggles to descending health-factor order on click", () => {
    render(<BorrowerDashboardTable debts={[debtA, debtB]} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Sort by health factor/i }),
    );

    const rowOrder = () =>
      screen
        .getAllByTestId(/^debt-row-\d+$/)
        .map((el) => el.getAttribute("data-testid"));

    expect(rowOrder()).toEqual(["debt-row-1", "debt-row-2"]);
  });

  it("reveals position details via the Manage button", () => {
    render(<BorrowerDashboardTable debts={[debtA]} />);

    expect(screen.queryByTestId("manage-detail-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("manage-1"));

    expect(screen.getByTestId("manage-detail-1")).toBeInTheDocument();
    expect(screen.getByText("Principal")).toBeInTheDocument();
    expect(screen.getByText("Accrued Interest")).toBeInTheDocument();
    expect(screen.getByText("Liquidation Threshold")).toBeInTheDocument();
    expect(screen.getByText("Interest Schedule")).toBeInTheDocument();
  });

  it("fires Top Up and Repay callbacks with the debt row", () => {
    const onTopUp = jest.fn();
    const onRepay = jest.fn();

    render(
      <BorrowerDashboardTable
        debts={[debtA, debtB]}
        onTopUp={onTopUp}
        onRepay={onRepay}
      />,
    );

    fireEvent.click(screen.getByTestId("top-up-2"));
    expect(onTopUp).toHaveBeenCalledWith(debtB);

    fireEvent.click(screen.getByTestId("repay-1"));
    expect(onRepay).toHaveBeenCalledWith(debtA);
  });

  it("disables action buttons when no handlers are provided", () => {
    render(<BorrowerDashboardTable debts={[debtA]} />);

    expect(screen.getByTestId("top-up-1")).toBeDisabled();
    expect(screen.getByTestId("repay-1")).toBeDisabled();
    expect(screen.getByTestId("manage-1")).toBeEnabled();
  });

  it("renders an empty state when there are no debts", () => {
    render(<BorrowerDashboardTable debts={[]} />);

    expect(screen.getByText("No Active Debts")).toBeInTheDocument();
  });

  it("renders a loading state while loading", () => {
    render(<BorrowerDashboardTable debts={[]} isLoading={true} />);

    expect(screen.getByText(/Loading your active debts/)).toBeInTheDocument();
  });

  it("marks an unhealthy debt in red", () => {
    const underwater: BorrowerDebt = {
      ...debtA,
      collateralUsdValue: 100_000_000n, // HF = 10/10.5 = 95% < 110% threshold
    };
    const { container } = render(
      <BorrowerDashboardTable debts={[underwater]} />,
    );

    const badge = screen.getByText("95.23%");
    expect(badge.className).toContain("text-red-300");
    expect(container).not.toBeNull();
  });
});