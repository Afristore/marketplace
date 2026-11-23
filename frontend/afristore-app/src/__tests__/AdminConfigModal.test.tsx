/**
 * AdminConfigModal fee validation (#1273): each fee is validated on its own,
 * and platform + liquidator fees must sum to less than 10000 bps.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSaveFees = jest.fn();

jest.mock("@/hooks/mutations/useSetFees", () => ({
  useSetFees: () => ({ saveFees: mockSaveFees, isSettingFees: false, error: null }),
}));
jest.mock("@/hooks/mutations/useUpdateBounds", () => ({
  useUpdateBounds: () => ({ update: jest.fn(), isUpdating: false, error: null }),
  validateBounds: () => ({ valid: true }),
}));
jest.mock("@/hooks/useSafeToast", () => ({ useSafeToast: () => jest.fn() }));
jest.mock("lucide-react", () =>
  Object.fromEntries(["X", "Loader2"].map((name) => [name, () => null])),
);

import { AdminConfigModal } from "@/components/lending/AdminConfigModal";

function renderModal() {
  return render(<AdminConfigModal isOpen onClose={jest.fn()} adminPublicKey="GADMIN" />);
}

async function setFee(label: RegExp, value: string) {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

describe("AdminConfigModal fees", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveFees.mockResolvedValue(true);
  });

  it("submits fees whose sum is below 10000 bps", async () => {
    renderModal();
    await setFee(/Platform Fee/i, "200");
    await setFee(/Liquidator Fee/i, "800");
    await userEvent.click(screen.getByRole("button", { name: "Save Fees" }));

    await waitFor(() =>
      expect(mockSaveFees).toHaveBeenCalledWith({
        platformFeeBps: "200",
        liquidatorFeeBps: "800",
      }),
    );
  });

  it("rejects fees that sum to 10000 bps or more and does not submit", async () => {
    renderModal();
    await setFee(/Platform Fee/i, "6000");
    await setFee(/Liquidator Fee/i, "4000");
    await userEvent.click(screen.getByRole("button", { name: "Save Fees" }));

    expect(await screen.findByTestId("error-liquidatorFeeBps")).toHaveTextContent(
      /together must be less than 10000 bps/,
    );
    expect(screen.getByLabelText(/Liquidator Fee/i)).toHaveAttribute("aria-invalid", "true");
    expect(mockSaveFees).not.toHaveBeenCalled();
  });

  it("still validates each fee individually", async () => {
    renderModal();
    await setFee(/Platform Fee/i, "10001");
    await userEvent.click(screen.getByRole("button", { name: "Save Fees" }));

    expect(await screen.findByTestId("error-platformFeeBps")).toHaveTextContent(
      /cannot exceed 10000/,
    );
    expect(mockSaveFees).not.toHaveBeenCalled();
  });

  it("clears a field's error when it is edited", async () => {
    renderModal();
    await setFee(/Platform Fee/i, "9000");
    await setFee(/Liquidator Fee/i, "1000");
    await userEvent.click(screen.getByRole("button", { name: "Save Fees" }));
    expect(await screen.findByTestId("error-liquidatorFeeBps")).toBeInTheDocument();

    await setFee(/Liquidator Fee/i, "500");
    expect(screen.queryByTestId("error-liquidatorFeeBps")).not.toBeInTheDocument();
  });
});
