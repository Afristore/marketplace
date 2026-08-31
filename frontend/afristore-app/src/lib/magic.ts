// ─────────────────────────────────────────────────────────────
// lib/magic.ts — Magic.link wallet abstraction for email/passkey
// ─────────────────────────────────────────────────────────────

import { Magic } from "magic-sdk";
import { isE2eMockChain } from "@/lib/e2e-chain-mock";

const MAGIC_API_KEY = process.env.NEXT_PUBLIC_MAGIC_API_KEY;

if (!MAGIC_API_KEY) {
  console.warn(
    "NEXT_PUBLIC_MAGIC_API_KEY is not set. Magic wallet will not be available.",
  );
}

let magicInstance: Magic | null = null;

const E2E_LOGIN_KEY = "e2e_magic_logged_in";
const E2E_EMAIL_KEY = "e2e_magic_email";
const E2E_ADDRESS_KEY = "e2e_magic_public_address";
const E2E_MOCK_PUBLIC_ADDRESS =
  "GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW";

/**
 * Get or create the Magic instance
 */
export function getMagicInstance(): Magic {
  if (isE2eMockChain()) {
    throw new Error(
      "Magic SDK is unavailable in E2E mock mode.",
    );
  }
  if (!magicInstance && MAGIC_API_KEY) {
    magicInstance = new Magic(MAGIC_API_KEY);
  }
  if (!magicInstance) {
    throw new Error(
      "Magic SDK not initialized. Please set NEXT_PUBLIC_MAGIC_API_KEY.",
    );
  }
  return magicInstance;
}

export interface MagicAccount {
  email: string;
  publicAddress: string;
  isLoggedIn: boolean;
}

/**
 * Check if user is logged in with Magic
 */
export async function isMagicLoggedIn(): Promise<boolean> {
  if (isE2eMockChain()) {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(E2E_LOGIN_KEY) === "true";
  }
  try {
    const magic = getMagicInstance();
    return await magic.user.isLoggedIn();
  } catch (err) {
    console.error("Error checking Magic login status:", err);
    return false;
  }
}

/**
 * Login with email using Magic Link
 */
export async function loginWithMagicLink(email: string): Promise<MagicAccount> {
  if (isE2eMockChain()) {
    const account: MagicAccount = {
      email,
      publicAddress: E2E_MOCK_PUBLIC_ADDRESS,
      isLoggedIn: true,
    };
    if (typeof window !== "undefined") {
      sessionStorage.setItem(E2E_LOGIN_KEY, "true");
      sessionStorage.setItem(E2E_EMAIL_KEY, email);
      sessionStorage.setItem(E2E_ADDRESS_KEY, E2E_MOCK_PUBLIC_ADDRESS);
    }
    return account;
  }
  try {
    const magic = getMagicInstance();
    await magic.auth.loginWithMagicLink({ email });
    const userMetadata = await magic.user.getInfo();

    const publicAddress =
      (userMetadata as any).publicAddress ||
      (userMetadata as any).walletAddress ||
      (userMetadata as any).address;

    if (!publicAddress) {
      throw new Error("Failed to get public address from Magic");
    }

    return {
      email: userMetadata.email || email,
      publicAddress: publicAddress,
      isLoggedIn: true,
    };
  } catch (err) {
    console.error("Magic Link login error:", err);
    throw err;
  }
}

/**
 * Login with passkey using Magic
 */
export async function loginWithPasskey(): Promise<MagicAccount> {
  if (isE2eMockChain()) {
    const account: MagicAccount = {
      email: "passkey-user",
      publicAddress: E2E_MOCK_PUBLIC_ADDRESS,
      isLoggedIn: true,
    };
    if (typeof window !== "undefined") {
      sessionStorage.setItem(E2E_LOGIN_KEY, "true");
      sessionStorage.setItem(E2E_EMAIL_KEY, "passkey-user");
      sessionStorage.setItem(E2E_ADDRESS_KEY, E2E_MOCK_PUBLIC_ADDRESS);
    }
    return account;
  }
  try {
    const magic = getMagicInstance();

    let didToken;
    try {
      didToken = await (magic.auth as any).loginWithPasskey?.();
    } catch (e) {
      throw new Error("Passkey login is not available or failed");
    }

    const userMetadata = await magic.user.getInfo();

    const publicAddress =
      (userMetadata as any).publicAddress ||
      (userMetadata as any).walletAddress ||
      (userMetadata as any).address;

    if (!publicAddress) {
      throw new Error("Failed to get public address from Magic");
    }

    return {
      email: userMetadata.email || "passkey-user",
      publicAddress: publicAddress,
      isLoggedIn: true,
    };
  } catch (err) {
    console.error("Passkey login error:", err);
    throw err;
  }
}

/**
 * Get current Magic user metadata
 */
export async function getMagicUserMetadata(): Promise<MagicAccount | null> {
  if (isE2eMockChain()) {
    if (typeof window === "undefined") return null;
    const isLoggedIn = sessionStorage.getItem(E2E_LOGIN_KEY) === "true";
    if (!isLoggedIn) return null;
    return {
      email: sessionStorage.getItem(E2E_EMAIL_KEY) || "unknown",
      publicAddress: sessionStorage.getItem(E2E_ADDRESS_KEY) || "",
      isLoggedIn: true,
    };
  }
  try {
    const magic = getMagicInstance();
    const isLoggedIn = await magic.user.isLoggedIn();

    if (!isLoggedIn) {
      return null;
    }

    const userMetadata = await magic.user.getInfo();

    const publicAddress =
      (userMetadata as any).publicAddress ||
      (userMetadata as any).walletAddress ||
      (userMetadata as any).address ||
      "";

    return {
      email: userMetadata.email || "unknown",
      publicAddress: publicAddress,
      isLoggedIn: true,
    };
  } catch (err) {
    console.error("Error getting Magic user metadata:", err);
    return null;
  }
}

/**
 * Logout from Magic
 */
export async function logoutFromMagic(): Promise<void> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(E2E_LOGIN_KEY);
      sessionStorage.removeItem(E2E_EMAIL_KEY);
      sessionStorage.removeItem(E2E_ADDRESS_KEY);
    }
    return;
  }
  try {
    const magic = getMagicInstance();
    await magic.user.logout();
  } catch (err) {
    console.error("Error logging out from Magic:", err);
    throw err;
  }
}

/**
 * Sign a transaction with Magic (Stellar XDR)
 *
 * Magic SDK does not natively support Stellar transaction signing.
 * This is a placeholder that throws a clear error until Stellar
 * support is added (e.g. via Stellar Turrets, custodial relay, or
 * Magic's Stellar extension).
 */
export async function signWithMagic(_txXdr: string): Promise<string> {
  throw new Error(
    "Magic wallet does not support Stellar transaction signing yet. " +
      "Please use Freighter wallet. Stellar support for Magic is coming soon.",
  );
}
