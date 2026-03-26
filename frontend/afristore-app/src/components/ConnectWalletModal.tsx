// ─────────────────────────────────────────────────────────────
// components/ConnectWalletModal.tsx — Onboarding experience
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import {
    X,
    Wallet,
    ExternalLink,
    ShieldCheck,
    AlertTriangle,
    ArrowRight,
    Loader2,
    CheckCircle2
} from "lucide-react";
import { config } from "@/lib/config";

interface ConnectWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ConnectWalletModal({ isOpen, onClose }: ConnectWalletModalProps) {
    const {
        status,
        connect,
        isConnecting,
        error,
        publicKey,
        refresh
    } = useWalletContext();

    const [hasStartedConnect, setHasStartedConnect] = useState(false);

    const [isInitialLoading, setIsInitialLoading] = useState(true);

    // Give auto-detection some time before showing "Not Installed"
    useEffect(() => {
        if (status !== "NOT_INSTALLED") {
            setIsInitialLoading(false);
            return;
        }
        const timer = setTimeout(() => setIsInitialLoading(false), 2000);
        return () => clearTimeout(timer);
    }, [status]);

    // Close when connected
    useEffect(() => {
        if (status === "CONNECTED" && hasStartedConnect) {
            const timer = setTimeout(onClose, 1000);
            return () => clearTimeout(timer);
        }
    }, [status, hasStartedConnect, onClose]);

    if (!isOpen) return null;

    const handleConnect = async () => {
        setHasStartedConnect(true);
        await connect();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
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
                        Connect <span className="text-brand-500">Wallet</span>
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
                        Securely connect your wallet to interact with African digital art.
                    </p>

                    {/* Status-based views */}
                    <div className="space-y-4">
                        {isInitialLoading && status === "NOT_INSTALLED" ? (
                            <div className="py-16 flex flex-col items-center justify-center space-y-4 animate-fade-in">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-full border-4 border-brand-100 border-t-brand-500 animate-spin" />
                                    <Wallet className="absolute inset-0 m-auto text-brand-500" size={24} />
                                </div>
                                <p className="text-sm text-gray-500 font-medium animate-pulse">Detecting Freighter Wallet...</p>
                            </div>
                        ) : status === "NOT_INSTALLED" ? (
                            <div className="rounded-2xl border-2 border-brand-100 bg-brand-50/30 p-5 text-center transition-all duration-300">
                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                                    <AlertTriangle size={24} />
                                </div>
                                <h3 className="font-display font-bold text-midnight-900">Freighter Not Found</h3>
                                <p className="mt-2 text-xs text-brand-700 leading-relaxed">
                                    We couldn&apos;t detect the Freighter wallet. Please install it to continue.
                                </p>
                                <a
                                    href="https://www.freighter.app/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-sm font-bold text-white hover:bg-brand-600 shadow-lg shadow-brand-500/20 transition-all"
                                >
                                    Install Freighter <ExternalLink size={14} />
                                </a>
                                <button
                                    onClick={refresh}
                                    className="mt-3 block w-full text-xs text-brand-500 hover:underline font-medium"
                                >
                                    Already installed? Refresh detection
                                </button>
                            </div>
                        ) : status === "WRONG_NETWORK" ? (
                            <div className="rounded-2xl border-2 border-terracotta-100 bg-terracotta-50/30 p-5 text-center">
                                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-terracotta-100 text-terracotta-600">
                                    <AlertTriangle size={24} />
                                </div>
                                <h3 className="font-display font-bold text-midnight-900">Wrong Network</h3>
                                <p className="mt-2 text-xs text-terracotta-800">
                                    Please open your Freighter extension and switch the network to <b>{config.network}</b>.
                                </p>
                                <div className="mt-4 flex flex-col gap-2">
                                    <button
                                        onClick={refresh}
                                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-terracotta-500 py-3 text-sm font-bold text-white hover:bg-terracotta-600 transition-all"
                                    >
                                        Refresh Connection
                                    </button>
                                </div>
                            </div>
                        ) : status === "CONNECTED" ? (
                            <div className="rounded-2xl border-2 border-mint-100 bg-mint-50/30 p-8 text-center animate-fade-in">
                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mint-100 text-mint-600 scale-110">
                                    <CheckCircle2 size={32} />
                                </div>
                                <h3 className="font-display font-bold text-midnight-900 text-xl">Success!</h3>
                                <p className="mt-2 text-sm text-mint-800">
                                    Your wallet is connected to Afristore.
                                </p>
                                <p className="mt-4 font-mono text-[10px] text-mint-700/60 break-all px-4">
                                    {publicKey}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <button
                                    onClick={handleConnect}
                                    disabled={isConnecting}
                                    className="group relative flex w-full items-center gap-4 rounded-2xl border-2 border-gray-100 p-4 hover:border-brand-300 hover:bg-brand-50/30 transition-all duration-300"
                                >
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-600 group-hover:bg-brand-500 group-hover:text-white transition-colors">
                                        {isConnecting ? <Loader2 size={24} className="animate-spin" /> : <Wallet size={24} />}
                                    </div>
                                    <div className="text-left">
                                        <p className="font-bold text-midnight-900">Freighter Wallet</p>
                                        <p className="text-xs text-gray-500">Official Stellar Wallet</p>
                                    </div>
                                    <ArrowRight size={18} className="absolute right-4 text-gray-300 group-hover:text-brand-500 group-hover:translate-x-1 transition-all" />
                                </button>

                                <div className="relative py-2">
                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                        <div className="w-full border-t border-gray-100"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase tracking-widest text-gray-300">
                                        <span className="bg-white px-2">Secure</span>
                                    </div>
                                </div>

                                <div className="rounded-2xl bg-gray-50 p-4 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <ShieldCheck size={18} className="text-mint-500 mt-0.5" />
                                        <p className="text-xs text-gray-600 leading-relaxed">
                                            Afristore never has access to your private keys and cannot sign transactions without your explicit permission.
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
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold flex items-center justify-center gap-2">
                        Authenticated by Stellar Consensus <ShieldCheck size={10} />
                    </p>
                </div>
            </div>
        </div>
    );
}
