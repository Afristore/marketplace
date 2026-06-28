"use client";

import { createContext, useContext, ReactNode, useMemo, useCallback } from "react";
import { useWallet, WalletState, WalletStatus } from "@/hooks/useWallet";
import {
  useMagicWallet,
  MagicWalletState,
  MagicWalletStatus,
} from "@/hooks/useMagicWallet";
import { isE2eMockChain } from "@/lib/e2e-chain-mock";

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
  network: string;
  isInstalled: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  switchNetwork: (networkName: string) => Promise<void>;
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

  const status: UnifiedWalletState["status"] =
    freighter.isConnected ||
    (!magic.isConnected && freighter.status !== "DISCONNECTED")
      ? freighter.status
      : magic.isConnected
        ? "MAGIC_CONNECTED"
        : "DISCONNECTED";

  const network = freighter.networkPassphrase?.includes("Test SDF")
    ? "testnet"
    : freighter.networkPassphrase?.includes("Public Global")
      ? "public"
      : freighter.networkPassphrase
        ? "futurenet"
        : "public";

  const switchNetwork = useCallback(async (networkName: string) => {
    const passphrases: Record<string, string> = {
      public: "Public Global Stellar Network ; September 2015",
      testnet: "Test SDF Network ; September 2015",
      futurenet: "Test SDF Future Network ; October 2022",
    };

    const passphrase = passphrases[networkName] ?? passphrases.public;

    if (isE2eMockChain()) {
      sessionStorage.setItem("e2e_network_passphrase", passphrase);
      window.location.reload();
      return;
    }

    console.info(
      `Please switch Freighter to the ${networkName} network manually.`,
    );
  }, []);

  const value = useMemo(
    () => ({
      walletType,
      publicKey,
      isConnected: freighter.isConnected || magic.isConnected,
      isConnecting: freighter.isConnecting || magic.isConnecting,
      isWrongNetwork: freighter.isWrongNetwork,
      networkPassphrase: freighter.networkPassphrase,
      network,
      isInstalled: freighter.isInstalled,
      error: freighter.error ?? magic.error,
      status,
      connect: freighter.connect,
      disconnect: () => {
        if (walletType === "magic") {
          magic.logout();
        } else {
          freighter.disconnect();
        }
      },
      refresh: freighter.refresh,
      switchNetwork,
      freighter,
      magic,
    }),
    [walletType, publicKey, status, network, switchNetwork, freighter, magic],
  );

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
