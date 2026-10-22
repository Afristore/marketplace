/**
 * Component tests for TopUpCollateralModal (issue #1117).
 *
 * Covers:
 *  - input validation (empty, non-numeric, zero, negative amounts)
 *  - health-factor preview updates
 *  - submission through useAddCollateral with 7-decimal conversion
 *  - loading state during transaction signing
 *  - success / failure handling and modal dismissal
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("@/hooks/mutations/useAddCollateral", () => ({
  useAddCollateral: jest.fn(),
}));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    ["X", "Loader2", "Plus", "ArrowRight"].map((name) => [name, () => null]),
  ),
);

import { useAddCollateral } from "@/hooks/mutations/useAddCollateral";
import { TopUpCollateralModal } from "@/components/lending/TopUpCollateralModal";
import type { BorrowerDebt } from "@/components/lending/BorrowerDashboardTable";

const useAddCollateralMock = useAddCollateral as unknown as jest.Mock;

const addCollateralMock = jest.fn();

const debt: BorrowerDebt = {
  positionId: 42,
  declaredPriceUsd: BigInt(100 * 10_000_000), // 100 USD principal
  collateralCurrency: "CCOLLATERAL",
  collateralUsdValue: BigInt(150 * 10_000_000), // 150 USD collateral
  interestScheduleBps: [300],
  elapsedMonths: 0,
  liquidationThresholdBps: 11000,
};

const borrowerPublicKey = "GBORROWER";

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    addCollateral: addCollateralMock,
    executeAddCollateral: addCollateralMock,
    isAddingCollateral: false,
    isLoading: false,
    error: null,
    ...overrides,
  };
}

function renderModal(
  props: Partial<React.ComponentProps<typeof TopUpCollateralModal>> = {},
) {
  return render(
    <TopUpCollateralModal
      isOpen
      onClose={jest.fn()}
      debt={debt}
      borrowerPublicKey={borrowerPublicKey}
      {...props}
    />,
  );
}

const amountInput = () => screen.getByPlaceholderText("0.00");
const submitButton = () => screen.getByRole("button", { name: /add collateral|processing/i });

describe("TopUpCollateralModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAddCollateralMock.mockReturnValue(hookState());
  });

  // ── Visibility ──────────────────────────────────────────────

  it("renders nothing when closed", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no debt", () => {
    const { container } = renderModal({ debt: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders the modal with the debt health factor preview", () => {
    renderModal();
    expect(screen.getByText("Top Up Collateral")).toBeInTheDocument();
    expect(screen.getAllByText("150.00%")).toHaveLength(2);
  });

  it("passes the borrower public key to useAddCollateral", () => {
    renderModal();
    expect(useAddCollateralMock).toHaveBeenCalledWith(borrowerPublicKey);
  });

  // ── Input validation ────────────────────────────────────────

  it("disables submission when the amount is empty", () => {
    renderModal();
    expect(amountInput()).toHaveValue(null);
    expect(submitButton()).toBeDisabled();
  });

  it("disables submission for a zero amount", () => {
    renderModal();
    fireEvent.change(amountInput(), { target: { value: "0" } });
    expect(amountInput()).toHaveValue(0);
    expect(submitButton()).toBeDisabled();
  });

  it("disables submission for a negative amount", () => {
    renderModal();
    fireEvent.change(amountInput(), { target: { value: "-10" } });
    expect(submitButton()).toBeDisabled();
  });

  it("rejects non-numeric input and blocks the form submit", () => {
    renderModal();
    const input = amountInput();
    fireEvent.change(input, { target: { value: "abc" } });

    // The browser sanitises a number input to an empty value, so the button
    // stays disabled and the form-level guard refuses to call the hook.
    expect(submitButton()).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(addCollateralMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("topup-error")).toHaveTextContent(
      /enter an amount greater than zero/i,
    );
  });

  it("enables submission and updates the health factor preview for a valid amount", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(amountInput(), "50");

    expect(submitButton()).toBeEnabled();
    // 150 USD collateral + 50 USD top-up on 100 USD debt = 200.00%
    expect(screen.getByText("200.00%")).toBeInTheDocument();
  });

  // ── Submission ──────────────────────────────────────────────

  it("converts the amount to 7-decimal fixed-point and closes on success", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    addCollateralMock.mockResolvedValue(true);

    renderModal({ onClose });

    await user.type(amountInput(), "50");
    await user.click(submitButton());

    await waitFor(() => {
      expect(addCollateralMock).toHaveBeenCalledWith({
        positionId: 42,
        amount: BigInt(50 * 10_000_000),
        collateralCurrency: "CCOLLATERAL",
        borrowerPublicKey,
      });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("does not close the modal when the hook reports failure", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    addCollateralMock.mockResolvedValue(false);

    renderModal({ onClose });

    await user.type(amountInput(), "25");
    await user.click(submitButton());

    await waitFor(() => expect(addCollateralMock).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a spinner and disables submission while signing", () => {
    useAddCollateralMock.mockReturnValue(hookState({ isAddingCollateral: true }));

    renderModal();

    expect(screen.getByRole("button", { name: /processing/i })).toBeDisabled();
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
  });

  it("surfaces an error returned by the hook", () => {
    useAddCollateralMock.mockReturnValue(
      hookState({ error: "Wallet not connected" }),
    );

    renderModal();

    expect(screen.getByTestId("topup-error")).toHaveTextContent(
      "Wallet not connected",
    );
  });

  it("shows the rejection message when the hook throws", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    addCollateralMock.mockRejectedValue(new Error("Transaction failed"));

    renderModal({ onClose });

    await user.type(amountInput(), "10");
    await user.click(submitButton());

    expect(await screen.findByTestId("topup-error")).toHaveTextContent(
      "Transaction failed",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Dismissal ───────────────────────────────────────────────

  it("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const { container } = renderModal({ onClose });

    const closeButton = container.querySelector("button.rounded-full");
    expect(closeButton).not.toBeNull();
    await user.click(closeButton as HTMLButtonElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    const { container } = renderModal({ onClose });

    const backdrop = container.querySelector(".absolute.inset-0");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
