// ─────────────────────────────────────────────────────────────
// hooks/useMagicWallet.ts — Magic wallet connection state
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  isMagicLoggedIn,
  loginWithMagicLink,
  loginWithPasskey,
  getMagicUserMetadata,
  logoutFromMagic,
  MagicAccount,
} from "@/lib/magic";
import { trackEvent } from "@/providers/PostHogProvider";

export type MagicWalletStatus =
  | "NOT_INITIALIZED"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export interface MagicWalletState {
  email: string | null;
  publicAddress: string | null;
  status: MagicWalletStatus;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  loginWithEmail: (email: string) => Promise<void>;
  loginWithPasskey: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMagicWallet(): MagicWalletState {
  const [email, setEmail] = useState<string | null>(null);
  const [publicAddress, setPublicAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Derive status
  const status: MagicWalletStatus = !isInitialized
    ? "NOT_INITIALIZED"
    : isConnecting
      ? "CONNECTING"
      : !publicAddress
        ? "DISCONNECTED"
        : "CONNECTED";

  const refresh = useCallback(async () => {
    try {
      const isLoggedIn = await isMagicLoggedIn();
      if (isLoggedIn) {
        const metadata = await getMagicUserMetadata();
        if (metadata) {
          setEmail(metadata.email);
          setPublicAddress(metadata.publicAddress);
        }
      } else {
        setEmail(null);
        setPublicAddress(null);
      }
    } catch (err) {
      console.error("Magic wallet refresh error:", err);
    } finally {
      setIsInitialized(true);
    }
  }, []);

  // Check login status on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const loginWithEmail = useCallback(async (emailAddress: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      const account = await loginWithMagicLink(emailAddress);
      setEmail(account.email);
      setPublicAddress(account.publicAddress);

      // Track successful Magic wallet connection
      trackEvent.walletConnected("magic", account.publicAddress);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to login with email";
      setError(errorMessage);
      trackEvent.walletConnectionDropOff("connection_failed", "magic");
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const loginWithPasskeyHandler = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const account = await loginWithPasskey();
      setEmail(account.email);
      setPublicAddress(account.publicAddress);

      // Track successful Magic wallet connection
      trackEvent.walletConnected("magic", account.publicAddress);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to login with passkey";
      setError(errorMessage);
      trackEvent.walletConnectionDropOff("connection_failed", "magic");
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutFromMagic();
      setEmail(null);
      setPublicAddress(null);
      setError(null);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to logout";
      setError(errorMessage);
      throw err;
    }
  }, []);

  return {
    email,
    publicAddress,
    status,
    isConnecting,
    isConnected: status === "CONNECTED",
    error,
    loginWithEmail,
    loginWithPasskey: loginWithPasskeyHandler,
    logout,
    refresh,
  };
}
