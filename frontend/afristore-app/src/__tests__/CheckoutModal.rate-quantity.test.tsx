/**
 * CheckoutModal: live XLM rate (#1288) and locked quantity for unique tokens (#1289).
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

jest.mock("posthog-js", () => ({ capture: jest.fn() }));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    ["X", "CreditCard", "Wallet", "CheckCircle", "AlertCircle", "Loader2"].map(
      (name) => [name, () => <span />],
    ),
  ),
);

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as any;

import {
  CheckoutModal,
  estimateFiat,
  maxPurchasableQuantity,
} from "@/components/CheckoutModal";
import { __resetCache } from "@/lib/xlmRate";

const listing = {
  listing_id: 1,
  price: 100_000_000n, // 10 XLM in stroops
  collection: "CCOLLECTION",
  token_id: 7,
  status: "Active",
  artist: "GARTIST",
} as any;

function renderModal() {
  return render(
    <CheckoutModal
      isOpen={true}
      onClose={jest.fn()}
      listing={listing}
      onCryptoPurchase={jest.fn()}
      isBuyingCrypto={false}
    />,
  );
}

describe("estimateFiat", () => {
  it("multiplies the XLM total by the rate to two decimals", () => {
    expect(estimateFiat(10, 0.25)).toBe("2.50");
    expect(estimateFiat(10, 0.12)).toBe("1.20");
    expect(estimateFiat(0, 0.3)).toBe("0.00");
  });
});

describe("maxPurchasableQuantity", () => {
  it("allows one of a unique token listing", () => {
    expect(maxPurchasableQuantity(listing)).toBe(1);
  });
});

describe("CheckoutModal live rate (#1288)", () => {
  beforeEach(() => {
    __resetCache();
    mockFetch.mockReset();
    delete process.env.NEXT_PUBLIC_XLM_USD_RATE;
  });

  it("shows the fiat estimate from the live rate, not a hardcoded 0.12", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ stellar: { usd: 0.25 } }),
    });
    renderModal();
    // 10 XLM * 0.25 = 2.50
    await waitFor(() => expect(screen.getByText("~$2.50")).toBeInTheDocument());
  });

  it("falls back to the default rate when the live fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    renderModal();
    // 10 XLM * 0.12 = 1.20
    await waitFor(() => expect(screen.getByText("~$1.20")).toBeInTheDocument());
  });
});

describe("CheckoutModal quantity (#1289)", () => {
  beforeEach(() => {
    __resetCache();
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error("offline"));
  });

  it("disables both quantity buttons and explains why", () => {
    renderModal();
    expect(screen.getByLabelText("Increase quantity")).toBeDisabled();
    expect(screen.getByLabelText("Decrease quantity")).toBeDisabled();
    expect(screen.getByTestId("quantity-locked-note")).toBeInTheDocument();
  });

  it("keeps quantity and total at 1 when the + button is clicked", async () => {
    renderModal();
    await userEvent.click(screen.getByLabelText("Increase quantity"));
    expect(screen.getByText("Pay 10 XLM")).toBeInTheDocument();
  });

  it("tells the buyer an ERC-1155 bundle transfers every listed copy", () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={jest.fn()}
        listing={{ ...listing, amount: 5 }}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    expect(screen.getByTestId("quantity-locked-note")).toHaveTextContent(
      "transfers all 5 copies",
    );
    expect(screen.getByText("Pay 10 XLM")).toBeInTheDocument();
  });
});
