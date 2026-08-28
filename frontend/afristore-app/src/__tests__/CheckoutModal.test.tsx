/**
 * Component tests for CheckoutModal.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// posthog is used inside the component
jest.mock("posthog-js", () => ({ capture: jest.fn() }));

jest.mock("lucide-react", () =>
  Object.fromEntries(
    [
      "X",
      "CreditCard",
      "Wallet",
      "CheckCircle2",
      "CheckCircle",
      "Loader2",
      "DollarSign",
      "Lock",
      "ArrowRight",
    ].map((name) => [name, () => <span />]),
  ),
);

// Stub out the fiat relay fetch so we control its response
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

import { CheckoutModal } from "@/components/CheckoutModal";

const sampleListing = {
  listing_id: 1,
  price: 10_000_000n, // 1 XLM in stroops
  metadata_cid: "QmTest",
  status: "Active",
  artist: "GARTIST",
} as any;

describe("CheckoutModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Visibility ──────────────────────────────────────────────────────────────

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <CheckoutModal
        isOpen={false}
        onClose={jest.fn()}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the modal when isOpen is true", () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={jest.fn()}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    expect(screen.getByText(/checkout/i)).toBeInTheDocument();
  });

  it("displays the price in XLM", () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={jest.fn()}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    expect(screen.getAllByText(/1\s*XLM/i).length).toBeGreaterThan(0);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    const { container } = render(
      <CheckoutModal
        isOpen={true}
        onClose={onClose}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    const backdrop = container.querySelector(".absolute.inset-0");
    if (backdrop) {
      await user.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    }
  });

  it("calls onClose when the X button is clicked", async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    render(
      <CheckoutModal
        isOpen={true}
        onClose={onClose}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={false}
      />,
    );
    // The close button contains an X icon span
    const closeBtn = screen
      .getAllByRole("button")
      .find((b) => b.querySelector("span") && !b.textContent?.trim());
    if (closeBtn) await user.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  // ── Crypto flow ─────────────────────────────────────────────────────────────

  it("shows a success modal and calls onPurchased on successful crypto purchase", async () => {
    const onClose = jest.fn();
    const onPurchased = jest.fn();
    const onCryptoPurchase = jest.fn().mockResolvedValue(true);
    const user = userEvent.setup();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={onClose}
        listing={sampleListing}
        onCryptoPurchase={onCryptoPurchase}
        onPurchased={onPurchased}
        isBuyingCrypto={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pay.*xlm/i }));
    await waitFor(() => expect(onCryptoPurchase).toHaveBeenCalled());
    expect(onPurchased).toHaveBeenCalled();

    // The success modal replaces the checkout form and stays open until dismissed.
    expect(await screen.findByText(/purchase successful/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close on failed crypto purchase", async () => {
    const onClose = jest.fn();
    const onCryptoPurchase = jest.fn().mockResolvedValue(false);
    const user = userEvent.setup();

    render(
      <CheckoutModal
        isOpen={true}
        onClose={onClose}
        listing={sampleListing}
        onCryptoPurchase={onCryptoPurchase}
        isBuyingCrypto={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pay.*xlm/i }));
    await waitFor(() => expect(onCryptoPurchase).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a loading spinner when isBuyingCrypto is true", () => {
    render(
      <CheckoutModal
        isOpen={true}
        onClose={jest.fn()}
        listing={sampleListing}
        onCryptoPurchase={jest.fn()}
        isBuyingCrypto={true}
      />,
    );
    expect(screen.getByText(/processing/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /processing/i })).toBeDisabled();
  });

  // ── Fiat flow error handling ────────────────────────────────────────────────
  describe("Fiat error handling", () => {
    it("handles fiat (Stripe/Ramp) API error responses gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Payment provider unavailable" }),
      });

      render(
        <CheckoutModal
          isOpen={true}
          onClose={jest.fn()}
          listing={sampleListing}
          onCryptoPurchase={jest.fn()}
          isBuyingCrypto={false}
        />,
      );

      expect(screen.getByText(/checkout/i)).toBeInTheDocument();
      expect(screen.getByText(/credit card/i)).toBeInTheDocument();
    });

    it("handles network failure during fiat payment gateway request", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network connection error"));

      render(
        <CheckoutModal
          isOpen={true}
          onClose={jest.fn()}
          listing={sampleListing}
          onCryptoPurchase={jest.fn()}
          isBuyingCrypto={false}
        />,
      );

      expect(screen.getByText(/checkout/i)).toBeInTheDocument();
    });
  });
});
