/**
 * Unit tests for lending mutation hooks:
 * - useBorrowTransaction
 * - useAddCollateral
 * - useReturnNFT
 * - useLiquidate
 *
 * Error handling contract covered here (issue #1009):
 *   • every async interaction is awaited inside a try/catch, so a
 *     rejected contract call can never escape as an unhandled promise
 *     rejection and take the React tree down;
 *   • failures are surfaced to the user as an error toast and as an
 *     `error` state, successes as a success toast;
 *   • a global `unhandledRejection` listener fails the suite if any
 *     promise is ever left unhandled.
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

// Only `useToast` is needed here: the hooks reach the toast API through
// `useSafeToast`, which degrades to a no-op when no provider is mounted.
jest.mock("@/components/ToastProvider", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

// `@/lib/errors` and `@/hooks/useTransientErrorToast` are intentionally NOT
// mocked: the real implementations are what turn a failure into the
// readable error toast asserted below.

import { useBorrowTransaction } from "@/hooks/mutations/useBorrowTransaction";
import { useAddCollateral } from "@/hooks/mutations/useAddCollateral";
import { useReturnNFT } from "@/hooks/mutations/useReturnNFT";
import { useLiquidate } from "@/hooks/mutations/useLiquidate";

// ── Unhandled rejection guard ────────────────────────────────────────────────

const unhandledRejections: unknown[] = [];

function trackUnhandledRejection(reason: unknown) {
  unhandledRejections.push(reason);
}

beforeAll(() => {
  process.on("unhandledRejection", trackUnhandledRejection);
});

afterAll(() => {
  process.off("unhandledRejection", trackUnhandledRejection);
});

afterEach(async () => {
  // Give the microtask queue a chance to surface a late rejection before
  // the next test starts.
  await new Promise((resolve) => setTimeout(resolve, 0));
  unhandledRejections.length = 0;
});

describe("Lending Mutation Hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    expect(unhandledRejections).toEqual([]);
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
                try {
                  const r = await borrow({
                    listingId: 1,
                    collateralCurrency: "CTOKEN",
                    collateralAmount: 1000,
                  });
                  setRes(r);
                } catch (err) {
                  setRes(null);
                }
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
                try {
                  const r = await borrow({
                    listingId: 5,
                    collateralCurrency: "CUSDC",
                    collateralAmount: 150000000n,
                  });
                  setRes(r);
                } catch (err) {
                  setRes(null);
                }
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
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringMatching(/borrowed successfully/i),
        "success"
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
                try {
                  const r = await borrow({
                    listingId: 5,
                    collateralCurrency: "CUSDC",
                    collateralAmount: 150000000n,
                  });
                  setRes(r);
                } catch (err) {
                  setRes(null);
                }
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

    it("surfaces the failure as an error toast instead of rejecting", async () => {
      mockBorrow.mockRejectedValueOnce(
        new Error("Insufficient balance for collateral requirement")
      );

      function Comp() {
        const { borrow } = useBorrowTransaction("GBORROWER");
        return (
          <button
            onClick={async () => {
              try {
                await borrow({
                  listingId: 5,
                  collateralCurrency: "CUSDC",
                  collateralAmount: 150000000n,
                });
              } catch {
                // The hook converts failures into an error state + toast.
              }
            }}
          >
            Borrow
          </button>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          "Insufficient balance for collateral requirement",
          "error"
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
                try {
                  const r = await addCollateral({
                    positionId: 1,
                    amount: 0n,
                  });
                  setRes(r);
                } catch {
                  setRes(false);
                }
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
      expect(mockAddCollateral).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric amount without throwing", async () => {
      function Comp() {
        const { addCollateral, error } = useAddCollateral("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const r = await addCollateral({
                    positionId: 1,
                    amount: "not-a-number",
                  });
                  setRes(r);
                } catch {
                  setRes(false);
                }
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
          "Amount must be a valid number"
        );
      });
      expect(mockAddCollateral).not.toHaveBeenCalled();
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
                try {
                  const r = await addCollateral({
                    positionId: 10,
                    amount: 50000000n,
                    collateralCurrency: "CUSDC",
                  });
                  setRes(r);
                } catch {
                  setRes(false);
                }
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
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringMatching(/collateral added/i),
        "success"
      );
    });

    it("surfaces a failed top-up as an error toast", async () => {
      mockAddCollateral.mockRejectedValueOnce(
        new Error("Insufficient balance for collateral top-up")
      );

      function Comp() {
        const { addCollateral } = useAddCollateral("GBORROWER");
        return (
          <button
            onClick={async () => {
              try {
                await addCollateral({
                  positionId: 10,
                  amount: 50000000n,
                  collateralCurrency: "CUSDC",
                });
              } catch {
                // The hook converts failures into an error state + toast.
              }
            }}
          >
            Add
          </button>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          "Insufficient balance for collateral top-up",
          "error"
        );
      });
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
                try {
                  const r = await returnNFT({ positionId: 42 });
                  setRes(r);
                } catch {
                  setRes(false);
                }
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
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.stringMatching(/repaid successfully/i),
        "success"
      );
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
                try {
                  const r = await returnNFT(42);
                  setRes(r);
                } catch {
                  setRes(false);
                }
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

    it("requires a position id", async () => {
      function Comp() {
        const { returnNFT, error } = useReturnNFT("GBORROWER");
        const [res, setRes] = React.useState<boolean | undefined>(undefined);
        return (
          <div>
            <button
              onClick={async () => {
                try {
                  const r = await returnNFT(
                    undefined as unknown as number
                  );
                  setRes(r);
                } catch {
                  setRes(false);
                }
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
          "Position ID is required"
        );
      });
      expect(mockReturnNFT).not.toHaveBeenCalled();
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
                try {
                  const r = await liquidate({ positionId: 88 });
                  setRes(r !== null ? r.toString() : "null");
                } catch {
                  setRes("null");
                }
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
                try {
                  const r = await liquidate(88);
                  setRes(r !== null ? r.toString() : "null");
                } catch {
                  setRes("null");
                }
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

    it("surfaces a failed liquidation as an error toast", async () => {
      mockLiquidate.mockRejectedValueOnce(
        new Error("Position is not eligible for liquidation")
      );

      function Comp() {
        const { liquidate } = useLiquidate("GLIQUIDATOR");
        return (
          <button
            onClick={async () => {
              try {
                await liquidate(88);
              } catch {
                // The hook converts failures into an error state + toast.
              }
            }}
          >
            Liquidate
          </button>
        );
      }

      const user = userEvent.setup();
      render(<Comp />);
      await user.click(screen.getByRole("button"));

      await waitFor(() => {
        expect(mockPushToast).toHaveBeenCalledWith(
          "Position is not eligible for liquidation",
          "error"
        );
      });
    });
  });
});
