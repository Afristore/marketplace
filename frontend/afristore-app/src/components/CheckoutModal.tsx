"use client";

import { useState } from "react";
import { X, CreditCard, Wallet, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { useSafeToast } from "@/hooks/useSafeToast";
import { useXlmRate } from "@/lib/xlmRate";
import posthog from "posthog-js";

/** Turns whatever a failed purchase threw into a sentence a buyer can act on. */
export function purchaseErrorMessage(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (/reject|denied|declined|cancel/i.test(detail)) {
    return "The transaction was cancelled in your wallet. No payment was made.";
  }
  return detail
    ? `Purchase failed: ${detail}`
    : "Purchase failed. Please try again.";
}

/**
 * How many of a listing a buyer can purchase in one checkout. buy_artwork takes
 * no quantity: it sells the whole listing (all `listing.amount` ERC-1155 copies)
 * for `listing.price`, so the counter is locked to one purchase.
 */
export function maxPurchasableQuantity(_listing: Listing): number {
  return 1;
}

/** Fiat estimate shown at checkout, as a fixed two-decimal string. */
export function estimateFiat(totalPriceXlm: number, xlmUsdRate: number): string {
  return (totalPriceXlm * xlmUsdRate).toFixed(2);
}

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: Listing;
  onCryptoPurchase: () => Promise<boolean>;
  onPurchased?: () => void;
  isBuyingCrypto: boolean;
}

export function CheckoutModal({
  isOpen,
  onClose,
  listing,
  onCryptoPurchase,
  onPurchased,
  isBuyingCrypto,
}: CheckoutModalProps) {
  const [method, setMethod] = useState<"crypto" | "fiat">("crypto");
  const [quantity, setQuantity] = useState(1);
  const [purchased, setPurchased] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useSafeToast();
  const xlmRate = useXlmRate();

  if (!isOpen) return null;

  const priceXlm = Number(stroopsToXlm(listing.price));
  const maxQuantity = maxPurchasableQuantity(listing);
  const quantityLocked = maxQuantity <= 1;
  const totalPriceXlm = priceXlm * quantity;
  const estimatedFiat = estimateFiat(totalPriceXlm, xlmRate);

  const handleClose = () => {
    setPurchased(false);
    setQuantity(1);
    setError(null);
    onClose();
  };

  const handleCryptoPurchase = async () => {
    if (submitting || isBuyingCrypto) return;
    setSubmitting(true);
    setError(null);

    let success = false;
    try {
      success = await onCryptoPurchase();
    } catch (err) {
      const message = purchaseErrorMessage(err);
      setError(message);
      pushToast(message, "error");
      return;
    } finally {
      setSubmitting(false);
    }

    if (!success) return;

    // The purchase went through on chain. Analytics or a parent callback
    // failing must not hide that from the buyer or crash the modal.
    try {
      posthog.capture("Purchase Successful", {
        listing_id: listing.listing_id,
        price_xlm: totalPriceXlm,
        quantity,
        method: "crypto",
      });
    } catch (err) {
      console.error("Failed to record purchase analytics", err);
    }
    try {
      onPurchased?.();
    } catch (err) {
      console.error("onPurchased callback failed", err);
    }
    setPurchased(true);
  };

  const busy = isBuyingCrypto || submitting;

  if (purchased) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
          onClick={handleClose}
        />
        <div
          data-testid="purchase-success-modal"
          className="relative flex w-full max-w-md flex-col items-center gap-6 overflow-hidden rounded-3xl bg-white p-10 text-center shadow-2xl animate-scale-in"
        >
          <div className="rounded-full bg-green-50 p-4">
            <CheckCircle size={56} className="text-green-500" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-gray-900">
              Purchase Successful!
            </h2>
            <p className="font-inter text-gray-500">
              You now own this artwork for {totalPriceXlm} XLM.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-full rounded-2xl bg-brand-500 py-4 text-lg font-bold text-white shadow-lg shadow-brand-500/20 transition-all hover:bg-brand-600"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="font-display text-xl font-bold text-gray-900">
            Checkout
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6 flex justify-between rounded-2xl bg-gray-50 p-4">
            <div>
              <p className="text-sm text-gray-500">Unit Price</p>
              <p className="font-display text-lg font-bold text-gray-700">
                {priceXlm} XLM
              </p>
              <p className="text-sm text-gray-500 mt-1">Quantity</p>
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantityLocked || quantity <= 1}
                  aria-label="Decrease quantity"
                  className="rounded-lg bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  -
                </button>
                <span className="font-display text-lg font-bold text-gray-900 min-w-[2ch] text-center">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                  disabled={quantityLocked || quantity >= maxQuantity}
                  aria-label="Increase quantity"
                  className="rounded-lg bg-gray-200 px-3 py-1 text-sm font-bold hover:bg-gray-300 transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  +
                </button>
              </div>
              {quantityLocked && (
                <p
                  data-testid="quantity-locked-note"
                  className="mt-1 text-xs text-gray-400"
                >
                  {listing.amount > 1
                    ? `Bundle listing: this purchase transfers all ${listing.amount} copies.`
                    : "Unique token: quantity is fixed at 1."}
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Price</p>
              <p className="font-display text-2xl font-bold text-gray-900">
                {totalPriceXlm} XLM
              </p>
              <p className="text-sm text-gray-500 mt-1">Estimated</p>
              <p className="font-display text-xl font-bold text-brand-500">
                ~${estimatedFiat}
              </p>
            </div>
          </div>

          {/* Payment method selector */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-500">
              Select Payment Method
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setMethod("crypto")}
                className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-4 transition-all ${method === "crypto" ? "border-brand-500 bg-brand-50 text-brand-600" : "border-gray-100 hover:border-gray-200 text-gray-600"}`}
              >
                <Wallet size={24} />
                <span className="text-sm font-semibold">Crypto</span>
              </button>

              {/* Fiat payment — coming soon */}
              <div className="relative flex flex-col items-center gap-3 rounded-2xl border-2 border-gray-100 p-4 text-gray-400 cursor-not-allowed select-none opacity-60">
                <CreditCard size={24} />
                <span className="text-sm font-semibold">Credit Card</span>
                <span className="absolute -top-2 right-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-600">
                  Coming Soon
                </span>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                data-testid="checkout-error"
                className="mt-6 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <button
              onClick={handleCryptoPurchase}
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 font-bold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-600 transition-all disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin" size={18} /> Processing...
                </>
              ) : (
                `Pay ${totalPriceXlm} XLM`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
