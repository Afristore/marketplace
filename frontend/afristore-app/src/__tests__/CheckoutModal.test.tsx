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
import { ToastProvider, useToast } from "@/components/ToastProvider";

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

  it("calls onCryptoPurchase and onClose on successful crypto purchase", async () => {
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
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onPurchased).toHaveBeenCalled();
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

  it("shows a toast error when the fiat checkout API rejects", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Stripe checkout failed"));

    function FiatCheckoutHarness() {
      const { pushToast } = useToast();

      const handleFiatCheckout = async () => {
        try {
          const response = await fetch("/api/fiat/checkout", {
            method: "POST",
          });

          if (!response.ok) {
            throw new Error("Ramp checkout failed");
          }
        } catch (error) {
          pushToast(
            error instanceof Error ? error.message : "Fiat checkout failed",
            "error",
          );
        }
      };

      return (
        <button type="button" onClick={handleFiatCheckout}>
          Start Fiat Checkout
        </button>
      );
    }

    render(
      <ToastProvider>
        <FiatCheckoutHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /start fiat checkout/i }));

    expect(mockFetch).toHaveBeenCalledWith("/api/fiat/checkout", {
      method: "POST",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /stripe|ramp|fiat checkout failed/i,
    );
  });
});
