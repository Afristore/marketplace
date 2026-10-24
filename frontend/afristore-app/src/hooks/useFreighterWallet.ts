"use client";

import { useState, useCallback, useEffect } from "react";
import {
  connectFreighter,
  getConnectedPublicKey,
  isFreighterInstalled,
} from "@/lib/freighter";
import { config } from "@/lib/config";
import { trackEvent } from "@/providers/PostHogProvider";
import type { WalletState, WalletStatus } from "./useWallet";

export function useFreighterWallet(): WalletState {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(
    null,
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWrongNetwork =
    !!publicKey &&
    !!networkPassphrase &&
    networkPassphrase !== config.networkPassphrase;

  const status: WalletStatus = !isInstalled
    ? "NOT_INSTALLED"
    : isConnecting
      ? "CONNECTING"
      : !publicKey
        ? "DISCONNECTED"
        : isWrongNetwork
          ? "WRONG_NETWORK"
          : "CONNECTED";

  // Runs fire-and-forget from the mount effect and polling interval, so it
  // must never reject: a failed detection is treated as "not installed".
  const refresh = useCallback(async () => {
    let installed = false;
    try {
      installed = await isFreighterInstalled();
    } catch (err) {
      console.error("Wallet detection error:", err);
    }
    setIsInstalled(installed);
    if (installed) {
      try {
        const key = await getConnectedPublicKey();
        if (key) {
          setPublicKey(key);
        }
      } catch (err) {
        console.error("Wallet auto-detection error:", err);
      }
    }
  }, []);

  useEffect(() => {
    refresh();

    const interval = setInterval(() => {
      refresh();
    }, 800);

    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 4000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const account = await connectFreighter();
      setPublicKey(account.publicKey);
      setNetworkPassphrase(account.networkPassphrase);

      if (account.networkPassphrase !== config.networkPassphrase) {
        setError(
          `Wrong network! Please switch Freighter to ${config.network}.`,
        );
        trackEvent.walletConnectionDropOff("connection_failed", "freighter");
      } else {
        // Track successful wallet connection
        trackEvent.walletConnected("freighter", account.publicKey);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("denied")) {
        setError("Connection request was rejected.");
        trackEvent.walletConnectionDropOff("connection_failed", "freighter");
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to connect wallet",
        );
        trackEvent.walletConnectionDropOff("connection_failed", "freighter");
      }
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null);
    setNetworkPassphrase(null);
    setError(null);
  }, []);

  return {
    publicKey,
    networkPassphrase,
    status,
    isInstalled,
    isConnecting,
    isConnected: status === "CONNECTED",
    isWrongNetwork,
    error,
    connect,
    disconnect,
    refresh,
  };
}
