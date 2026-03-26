// ─────────────────────────────────────────────────────────────
// lib/freighter.ts — Freighter browser wallet helpers
// ─────────────────────────────────────────────────────────────

import {
  getPublicKey,
  isConnected,
  signTransaction,
  setAllowed,
  getNetworkDetails,
} from "@stellar/freighter-api";

export interface FreighterAccount {
  publicKey: string;
  networkPassphrase: string;
}

/**
 * Returns true if the Freighter extension is installed in this browser.
 */
export async function isFreighterInstalled(): Promise<boolean> {
  // Check global objects
  if (typeof window !== "undefined") {
    if ((window as any).starlight || (window as any).freighter) {
      return true;
    }
  }

  // Check API
  try {
    return await isConnected();
    const connected = await isConnected();
    // Some versions return a boolean, some return { isConnected: boolean }
    if (typeof connected === "boolean") return connected;
    if (connected && typeof (connected as any).isConnected === "boolean") {
      return (connected as any).isConnected;
    }
    return !!connected;
  } catch {
    return false;
  }
}

// ── Connect wallet ────────────────────────────────────────────

/**
 * Requests access to Freighter and returns the public key + network.
 */
export async function connectFreighter(): Promise<FreighterAccount> {
  // 1. setAllowed
  const allowed = await setAllowed();
  if (!allowed) {
    throw new Error("Freighter access was denied by the user.");
  }

  const publicKey = await getPublicKey();
  if (!publicKey) {
    throw new Error("Could not retrieve public key from Freighter.");
  // Handle both boolean and { isAllowed: boolean }
  const isAllowed = typeof allowed === "boolean" ? allowed : (allowed as any)?.isAllowed;

  if (!isAllowed) {
    throw new Error("Freighter access was denied by the user.");
  }

  // 2. getPublicKey
  const publicKey = await getPublicKey();
  if (typeof publicKey !== "string") {
    const error = (publicKey as any)?.error;
    throw new Error(error ? `Freighter key error: ${error}` : "Failed to get public key from Freighter");
  }

  // 3. getNetworkDetails
  const networkResult = await getNetworkDetails();
  if (!networkResult) {
    throw new Error("Could not retrieve network details from Freighter.");
  }

  return {
    publicKey,
  if (!networkResult || (networkResult as any).error) {
    throw new Error(`Freighter network error: ${(networkResult as any)?.error || "Unknown error"}`);
  }

  return {
    publicKey: publicKey,
    networkPassphrase: networkResult.networkPassphrase,
  };
}

// ── Sign a transaction XDR ────────────────────────────────────

/**
 * Asks Freighter to sign a transaction XDR string.
 */
export async function signWithFreighter(
  txXdr: string,
  networkPassphrase: string
): Promise<string> {
  const signedTxXdr = await signTransaction(txXdr, { networkPassphrase });
  if (!signedTxXdr) {
    throw new Error("Freighter sign error: result was empty.");
  }
  return signedTxXdr;
  const result = await signTransaction(txXdr, { networkPassphrase });

  if (typeof result === "string") return result;

  if (result && (result as any).signedTxXdr) {
    return (result as any).signedTxXdr;
  }

  const error = (result as any)?.error;
  throw new Error(error ? `Freighter sign error: ${error}` : "Failed to sign transaction with Freighter");
}

// ── Get connected public key ──────────────────────────────────

/**
 * Returns the currently connected public key, or null if not connected.
 */
export async function getConnectedPublicKey(): Promise<string | null> {
  try {
    const connected = await isConnected();
    if (!connected) return null;
    const publicKey = await getPublicKey();
    return publicKey || null;
    const installed = await isFreighterInstalled();
    if (!installed) return null;

    const key = await getPublicKey();
    if (typeof key === "string") return key;
    if (key && (key as any).publicKey) return (key as any).publicKey;

    return null;
  } catch {
    return null;
  }
}
