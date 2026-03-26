// ─────────────────────────────────────────────────────────────
// components/WalletGuard.tsx — Gated access wrapper
// ─────────────────────────────────────────────────────────────

"use client";

import { useWalletContext } from "@/context/WalletContext";
import { ConnectWalletModal } from "./ConnectWalletModal";
import { useState, ReactNode } from "react";
import { Wallet, AlertTriangle } from "lucide-react";

interface WalletGuardProps {
    children: ReactNode;
    fallback?: ReactNode;
    actionName?: string;
    hideContentWhenDisconnected?: boolean;
}

/**
 * Higher-order component to protect actions or entire views.
 */
export function WalletGuard({
    children,
    fallback,
    actionName = "To perform this action",
    hideContentWhenDisconnected = false
}: WalletGuardProps) {
    const { isConnected, isWrongNetwork, status } = useWalletContext();
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Connection flow handler
    const handleProtectedAction = (e: React.MouseEvent) => {
        if (!isConnected || isWrongNetwork) {
            e.preventDefault();
            e.stopPropagation();
            setIsModalOpen(true);
        }
    };

    if (isConnected && !isWrongNetwork) {
        return (
            <>
                {children}
                <ConnectWalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
            </>
        );
    }

    // Define default fallback if none provided
    const defaultFallback = (
        <div className=" mt-24 border-none bg-brand-50/20 p-8 text-center transition-all hover:bg-brand-50/40">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 scale-110">
                <Wallet size={32} />
            </div>
            <h3 className="font-display font-bold text-midnight-900 text-xl">Wallet Connection Required</h3>
            <p className="mt-2 text-sm text-gray-500 max-w-xs mx-auto">
                {actionName}, you must connect your Freighter wallet on the correct network.
            </p>
            <button
                onClick={() => setIsModalOpen(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-8 py-3.5 text-base font-bold text-white shadow-xl shadow-brand-500/30 hover:bg-brand-600 transition-all hover:scale-105 active:scale-95"
            >
                <Wallet size={20} />
                Connect Wallet
            </button>

            {isWrongNetwork && (
                <p className="mt-4 text-xs font-semibold text-terracotta-600 flex items-center justify-center gap-1.5">
                    <AlertTriangle size={14} /> Wrong network detected!
                </p>
            )}
        </div>
    );

    return (
        <>
            <div onClickCapture={handleProtectedAction} className={hideContentWhenDisconnected ? "hidden" : "contents"}>
                {fallback || (hideContentWhenDisconnected ? null : defaultFallback)}
            </div>
            <ConnectWalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </>
    );
}

/**
 * Reusable guard button component
 */
interface GuardButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    actionName?: string;
    onAction?: (e: React.MouseEvent) => void;
}

export function GuardButton({
    children,
    actionName,
    onAction,
    className,
    ...props
}: GuardButtonProps) {
    const { isConnected, isWrongNetwork } = useWalletContext();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!isConnected || isWrongNetwork) {
            e.preventDefault();
            e.stopPropagation();
            setIsModalOpen(true);
            return;
        }
        onAction?.(e);
    };

    return (
        <>
            <button
                {...props}
                onClick={handleClick}
                className={className}
            >
                {children}
            </button>
            <ConnectWalletModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        </>
    );
}
