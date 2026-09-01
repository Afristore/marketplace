/**
 * Unit tests for lending mutation hooks:
 * - useBorrowTransaction
 * - useAddCollateral
 * - useReturnNFT
 * - useLiquidate
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBorrow = jest.fn();
const mockAddCollateral = jest.fn();
const mockReturnNFT = jest.fn();
const mockLiquidate = jest.fn();
const mockGetTokenBalance = jest.fn();
const mockApproveToken = jest.fn();
const mockPushToast = jest.fn();

jest.mock("@/lib/lending", () => ({
  borrow: (...args: unknown[]) => mockBorrow(...args),
  addCollateral: (...args: unknown[]) => mockAddCollateral(...args),
  returnNFT: (...args: unknown[]) => mockReturnNFT(...args),
  liquidate: (...args: unknown[]) => mockLiquidate(...args),
  getTokenBalance: (...args: unknown[]) => mockGetTokenBalance(...args),
  approveToken: (...args: unknown[]) => mockApproveToken(...args),
  computeAccruedInterestUsd: jest.fn().mockReturnValue(5000000n),
  calculateReturnFees: jest.fn().mockReturnValue({
    principalUsd: 100000000n,
    accruedInterestUsd: 5000000n,
    platformFeeUsd: 1050000n,
    totalRequiredUsd: 106050000n,
  }),
}));

jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

jest.mock("@/hooks/useTransientErrorToast", () => ({
  useTransientErrorToast: jest.fn(),
}));

jest.mock("@/lib/errors", () => ({
  getReadableErrorMessage: (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback,
}));

import { useBorrowTransaction } from "@/hooks/mutations/useBorrowTransaction";
import { useAddCollateral } from "@/hooks/mutations/useAddCollateral";
import { useReturnNFT } from "@/hooks/mutations/useReturnNFT";
import { useLiquidate } from "@/hooks/mutations/useLiquidate";

describe("Lending Mutation Hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. useBorrowTransaction ──────────────────────────────────────────────────

  describe("useBorrowTransaction", () => {
    it("returns null and sets error when wallet is not connected", async () => {
      function Comp() {
        const { borrow, error } = useBorrowTransaction(null);
        const [res, setRes] = React.useState<number | null | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await borrow({
                  listingId: 1,
                  collateralCurrency: "CTOKEN",
                  collateralAmount: 1000,
                });
                setRes(r);
              }}
            >
              Borrow
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("null");
        expect(screen.getByTestId("err").textContent).toBe("Wallet not connected");
      });
      expect(mockBorrow).not.toHaveBeenCalled();
    });

    it("handles token approval flow prior to calling borrowing contract and returns positionId", async () => {
      mockBorrow.mockResolvedValueOnce(202);

      function Comp() {
        const { borrow, error, isBorrowing } = useBorrowTransaction("GBORROWER");
        const [res, setRes] = React.useState<number | null | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await borrow({
                  listingId: 5,
                  collateralCurrency: "CUSDC",
                  collateralAmount: 150000000n,
                });
                setRes(r);
              }}
            >
              Borrow
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="loading">{String(isBorrowing)}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("202");
      });

      expect(mockBorrow).toHaveBeenCalledWith(
        "GBORROWER",
        5,
        "CUSDC",
        150000000n
      );
    });

    it("provides clear error message when user has insufficient balance", async () => {
      mockBorrow.mockRejectedValueOnce(
        new Error("Insufficient balance for collateral requirement")
      );

      function Comp() {
        const { borrow, error } = useBorrowTransaction("GBORROWER");
        const [res, setRes] = React.useState<number | null | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await borrow({
                  listingId: 5,
                  collateralCurrency: "CUSDC",
                  collateralAmount: 150000000n,
                });
                setRes(r);
              }}
            >
              Borrow
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("null");
        expect(screen.getByTestId("err").textContent).toBe(
          "Insufficient balance for collateral requirement"
        );
      });
    });
  });

  // ── 2. useAddCollateral ─────────────────────────────────────────────────────

  describe("useAddCollateral", () => {
    it("returns false and sets error when positionId or amount is invalid", async () => {
      function Comp() {
        const { addCollateral, error } = useAddCollateral("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await addCollateral({
                  positionId: 1,
                  amount: 0n,
                });
                setRes(r);
              }}
            >
              Add
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("false");
        expect(screen.getByTestId("err").textContent).toBe(
          "Amount must be greater than zero"
        );
      });
    });

    it("requires position_id and amount, handles token approval flow, and returns true", async () => {
      mockAddCollateral.mockResolvedValueOnce(undefined);

      function Comp() {
        const { addCollateral, isAddingCollateral } = useAddCollateral("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await addCollateral({
                  positionId: 10,
                  amount: 50000000n,
                  collateralCurrency: "CUSDC",
                });
                setRes(r);
              }}
            >
              Add
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="loading">{String(isAddingCollateral)}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("true");
      });

      expect(mockAddCollateral).toHaveBeenCalledWith(
        "GBORROWER",
        10,
        50000000n,
        "CUSDC"
      );
    });
  });

  // ── 3. useReturnNFT ─────────────────────────────────────────────────────────

  describe("useReturnNFT", () => {
    it("approves principal + interest + platform fees and submits return_nft transaction", async () => {
      mockReturnNFT.mockResolvedValueOnce(undefined);

      function Comp() {
        const { returnNFT, isReturningNFT } = useReturnNFT("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await returnNFT({ positionId: 42 });
                setRes(r);
              }}
            >
              Return
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="loading">{String(isReturningNFT)}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("true");
      });

      expect(mockReturnNFT).toHaveBeenCalledWith("GBORROWER", 42);
    });

    it("returns false and sets error when returnNFT fails", async () => {
      mockReturnNFT.mockRejectedValueOnce(
        new Error("Loan term has expired; use liquidate()")
      );

      function Comp() {
        const { returnNFT, error } = useReturnNFT("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await returnNFT(42);
                setRes(r);
              }}
            >
              Return
            </button>
            <span data-testid="res">{String(res)}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("false");
        expect(screen.getByTestId("err").textContent).toBe(
          "Loan term has expired; use liquidate()"
        );
      });
    });
  });

  // ── 4. useLiquidate ─────────────────────────────────────────────────────────

  describe("useLiquidate", () => {
    it("accepts position_id, triggers liquidate endpoint, and emits success toast showing bounty earned", async () => {
      mockLiquidate.mockResolvedValueOnce({ bountyEarned: 5250000n });

      function Comp() {
        const { liquidate, bountyEarned, isLiquidating } = useLiquidate("GLIQUIDATOR");
        const [res, setRes] = React.useState<string | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await liquidate({ positionId: 88 });
                setRes(r !== null ? r.toString() : "null");
              }}
            >
              Liquidate
            </button>
            <span data-testid="res">{res ?? "undefined"}</span>
            <span data-testid="bounty">{bountyEarned?.toString() ?? "none"}</span>
            <span data-testid="loading">{String(isLiquidating)}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("5250000");
      });

      expect(mockLiquidate).toHaveBeenCalledWith("GLIQUIDATOR", 88);
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringMatching(/bounty earned: 0\.53 USDC/i),
        "success"
      );
    });

    it("returns null and sets error when liquidation fails", async () => {
      mockLiquidate.mockRejectedValueOnce(
        new Error("Position is not eligible for liquidation")
      );

      function Comp() {
        const { liquidate, error } = useLiquidate("GLIQUIDATOR");
        const [res, setRes] = React.useState<string | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                const r = await liquidate(88);
                setRes(r !== null ? r.toString() : "null");
              }}
            >
              Liquidate
            </button>
            <span data-testid="res">{res ?? "undefined"}</span>
            <span data-testid="err">{error ?? "none"}</span>
          </div>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(screen.getByTestId("res").textContent).toBe("null");
        expect(screen.getByTestId("err").textContent).toBe(
          "Position is not eligible for liquidation"
        );
      });
    });
  });
});
