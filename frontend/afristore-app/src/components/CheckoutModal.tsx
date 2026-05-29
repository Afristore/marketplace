"use client";

import { useState } from "react";
import {
  X,
  CreditCard,
  Wallet,
  CheckCircle2,
  Loader2,
  DollarSign,
} from "lucide-react";
import { Listing, stroopsToXlm } from "@/lib/contract";
import posthog from "posthog-js";

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
  const [fiatStep, setFiatStep] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const priceXlm = Number(stroopsToXlm(listing.price));
  const estimatedFiat = (priceXlm * 0.12).toFixed(2); // Mock XLM price $0.12

  const handleFiatPurchase = async () => {
    setFiatStep("processing");
    setErrorMsg("");
    try {
      // Mocking the backend transaction sponsor/relay logic
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Simulating a successful relay response
      const relaySuccess = true;
      if (relaySuccess) {
        setFiatStep("success");
        posthog.capture("Purchase Successful", {
          listing_id: listing.listing_id,
          price_xlm: priceXlm,
          method: "fiat",
        });
        setTimeout(() => {
          onPurchased?.();
          onClose();
          setFiatStep("idle");
        }, 2000);
      } else {
        throw new Error("Transaction relay failed. Please try again.");
      }
    } catch (err: any) {
      setFiatStep("error");
      setErrorMsg(err.message || "An error occurred during fiat checkout.");
    }
  };

  const handleCryptoPurchase = async () => {
    const success = await onCryptoPurchase();
    if (success) {
      posthog.capture("Purchase Successful", {
        listing_id: listing.listing_id,
        price_xlm: priceXlm,
        method: "crypto",
      });
      onPurchased?.();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 p-6">
          <h2 className="font-display text-xl font-bold text-gray-900">
            Checkout
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="mb-6 flex justify-between rounded-2xl bg-gray-50 p-4">
            <div>
              <p className="text-sm text-gray-500">Total Price</p>
              <p className="font-display text-2xl font-bold text-gray-900">
                {priceXlm} XLM
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Estimated</p>
              <p className="font-display text-xl font-bold text-brand-500">
                ~${estimatedFiat}
              </p>
            </div>
          </div>

          {fiatStep === "success" ? (
            <div className="py-8 text-center animate-fade-in">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-mint-500">
                <CheckCircle2 size={32} />
              </div>
              <h3 className="font-display text-xl font-bold text-gray-900">
                Payment Successful!
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                The NFT has been transferred to your wallet.
              </p>
            </div>
          ) : (
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

                <button
                  onClick={() => setMethod("fiat")}
                  className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-4 transition-all ${method === "fiat" ? "border-brand-500 bg-brand-50 text-brand-600" : "border-gray-100 hover:border-gray-200 text-gray-600"}`}
                >
                  <CreditCard size={24} />
                  <span className="text-sm font-semibold">Credit Card</span>
                </button>
              </div>

              {method === "fiat" && (
                <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4 mt-4">
                  <div className="flex items-start gap-3">
                    <DollarSign className="text-brand-500 mt-0.5" size={18} />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Direct Fiat Purchase
                      </p>
                      <p className="mt-1 text-xs text-gray-600">
                        Pay with your card. We&apos;ll instantly buy XLM and
                        execute the smart contract trade for you.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {errorMsg && (
                <p className="mt-4 text-sm text-red-500">{errorMsg}</p>
              )}

              <button
                onClick={
                  method === "crypto"
                    ? handleCryptoPurchase
                    : handleFiatPurchase
                }
                disabled={isBuyingCrypto || fiatStep === "processing"}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 font-bold text-white shadow-lg shadow-brand-500/20 hover:bg-brand-600 transition-all disabled:opacity-50"
              >
                {isBuyingCrypto || fiatStep === "processing" ? (
                  <>
                    <Loader2 className="animate-spin" size={18} /> Processing...
                  </>
                ) : (
                  `Pay ${method === "crypto" ? `${priceXlm} XLM` : `$${estimatedFiat}`}`
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
