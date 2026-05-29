"use client";

import { createContext, useContext, ReactNode, useMemo } from "react";
import { useWallet, WalletState, WalletStatus } from "@/hooks/useWallet";
import { useMagicWallet, MagicWalletState, MagicWalletStatus } from "@/hooks/useMagicWallet";

export type WalletType = "freighter" | "magic" | null;

export interface UnifiedWalletState {
  walletType: WalletType;
  publicKey: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  status: WalletStatus | "MAGIC_CONNECTED" | "DISCONNECTED";
  networkPassphrase: string | null;
  isInstalled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  freighter: WalletState;
  magic: MagicWalletState;
}

const WalletContext = createContext<UnifiedWalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const freighter = useWallet();
  const magic = useMagicWallet();

  const walletType: WalletType = freighter.isConnected
    ? "freighter"
    : magic.isConnected
      ? "magic"
      : null;

  const publicKey = freighter.publicKey ?? magic.publicAddress ?? null;

  const status: UnifiedWalletState['status'] = freighter.isConnected || (!magic.isConnected && freighter.status !== "DISCONNECTED")
    ? freighter.status
    : magic.isConnected
      ? "MAGIC_CONNECTED"
      : "DISCONNECTED";

  const value = useMemo(() => ({
    walletType,
    publicKey,
    isConnected: freighter.isConnected || magic.isConnected,
    isConnecting: freighter.isConnecting || magic.isConnecting,
    isWrongNetwork: freighter.isWrongNetwork,
    networkPassphrase: freighter.networkPassphrase,
    isInstalled: freighter.isInstalled,
    error: freighter.error ?? magic.error,
    status,
    connect: freighter.connect,
    disconnect: freighter.disconnect,
    refresh: freighter.refresh,
    freighter,
    magic,
  }), [walletType, publicKey, status, freighter, magic]);

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWalletContext(): UnifiedWalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWalletContext must be used inside <WalletProvider>");
  }
  return ctx;
}
