// ─────────────────────────────────────────────────────────────
// components/MagicWalletModal.tsx — Magic wallet onboarding
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import {
  X,
  Mail,
  Fingerprint,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  Loader2,
  CheckCircle2,
} from "lucide-react";

interface MagicWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MagicWalletModal({ isOpen, onClose }: MagicWalletModalProps) {
  const {
    status,
    isConnecting,
    error,
    email,
    publicAddress,
    loginWithEmail,
    loginWithPasskey,
  } = useWalletContext().magic;

  const [emailInput, setEmailInput] = useState("");
  const [hasStartedConnect, setHasStartedConnect] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  // Close when connected
  useEffect(() => {
    if (status === "CONNECTED" && hasStartedConnect) {
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [status, hasStartedConnect, onClose]);

  if (!isOpen) return null;

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    setHasStartedConnect(true);
    try {
      await loginWithEmail(emailInput);
    } catch (err) {
      console.error("Email login failed:", err);
    }
  };

  const handlePasskeyLogin = async () => {
    setHasStartedConnect(true);
    try {
      await loginWithPasskey();
    } catch (err) {
      console.error("Passkey login failed:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-md animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/50 animate-scale-in">
        <div className="tribal-strip h-2" />

        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-0">
          <h2 className="font-display text-2xl font-bold text-midnight-900">
            Magic <span className="text-brand-500">Wallet</span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-midnight-900 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 pt-4">
          <p className="text-sm text-gray-500 mb-6 font-medium">
            Create a wallet with just your email or passkey. No crypto knowledge
            needed.
          </p>

          {/* Status-based views */}
          <div className="space-y-4">
            {status === "CONNECTED" ? (
              <div className="rounded-2xl border-2 border-mint-100 bg-mint-50/30 p-8 text-center animate-fade-in">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-mint-600 scale-110">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="font-display font-bold text-midnight-900 text-xl">
                  Success!
                </h3>
                <p className="mt-2 text-sm text-mint-800">
                  Your Magic wallet is ready.
                </p>
                <p className="mt-4 font-mono text-[10px] text-mint-700/60 break-all px-4">
                  {publicAddress}
                </p>
              </div>
            ) : showEmailForm ? (
              <form onSubmit={handleEmailLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-midnight-900 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="you@example.com"
                    disabled={isConnecting}
                    className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 focus:border-brand-500 focus:outline-none transition-colors disabled:bg-gray-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isConnecting || !emailInput.trim()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-sm font-bold text-white hover:bg-brand-600 disabled:bg-gray-300 shadow-lg shadow-brand-500/20 transition-all"
                >
                  {isConnecting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Sending Link...
                    </>
                  ) : (
                    <>
                      <Mail size={16} />
                      Send Magic Link
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmailForm(false)}
                  className="w-full text-sm text-gray-500 hover:text-midnight-900 transition-colors"
                >
                  Back
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => setShowEmailForm(true)}
                  disabled={isConnecting}
                  className="group relative flex w-full items-center gap-4 rounded-2xl border-2 border-gray-100 p-4 hover:border-brand-300 hover:bg-brand-50/30 transition-all duration-300 disabled:opacity-50"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                    <Mail size={24} />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-midnight-900">
                      Email Magic Link
                    </p>
                    <p className="text-xs text-gray-500">
                      Receive a link via email
                    </p>
                  </div>
                  <ArrowRight
                    size={18}
                    className="absolute right-4 text-gray-300 group-hover:text-brand-500 group-hover:translate-x-1 transition-all"
                  />
                </button>

                <button
                  onClick={handlePasskeyLogin}
                  disabled={isConnecting}
                  className="group relative flex w-full items-center gap-4 rounded-2xl border-2 border-gray-100 p-4 hover:border-brand-300 hover:bg-brand-50/30 transition-all duration-300 disabled:opacity-50"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                    {isConnecting ? (
                      <Loader2 size={24} className="animate-spin" />
                    ) : (
                      <Fingerprint size={24} />
                    )}
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-midnight-900">Passkey Login</p>
                    <p className="text-xs text-gray-500">
                      Use FaceID or fingerprint
                    </p>
                  </div>
                  <ArrowRight
                    size={18}
                    className="absolute right-4 text-gray-300 group-hover:text-brand-500 group-hover:translate-x-1 transition-all"
                  />
                </button>

                <div className="relative py-2">
                  <div
                    className="absolute inset-0 flex items-center"
                    aria-hidden="true"
                  >
                    <div className="w-full border-t border-gray-100"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-widest text-gray-300">
                    <span className="bg-white px-2">Secure & Simple</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      size={18}
                      className="text-mint-500 mt-0.5 flex-shrink-0"
                    />
                    <p className="text-xs text-gray-600 leading-relaxed">
                      No seed phrases or private keys to manage. Your wallet is
                      secured by Magic.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && status !== "CONNECTED" && !isConnecting && (
            <div className="mt-6 rounded-xl bg-terracotta-50 p-3 flex items-start gap-2 text-xs text-terracotta-700 animate-slide-up">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="bg-gray-50 p-4 text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
            Powered by Magic.link
          </p>
        </div>
      </div>
    </div>
  );
}
