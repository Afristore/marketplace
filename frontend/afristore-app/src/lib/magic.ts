// ─────────────────────────────────────────────────────────────
// lib/magic.ts — Magic.link wallet abstraction for email/passkey
// ─────────────────────────────────────────────────────────────

import { Magic } from "magic-sdk";

const MAGIC_API_KEY = process.env.NEXT_PUBLIC_MAGIC_API_KEY;

if (!MAGIC_API_KEY) {
  console.warn("NEXT_PUBLIC_MAGIC_API_KEY is not set. Magic wallet will not be available.");
}

let magicInstance: Magic | null = null;

/**
 * Get or create the Magic instance
 */
export function getMagicInstance(): Magic {
  if (!magicInstance && MAGIC_API_KEY) {
    magicInstance = new Magic(MAGIC_API_KEY);
  }
  if (!magicInstance) {
    throw new Error("Magic SDK not initialized. Please set NEXT_PUBLIC_MAGIC_API_KEY.");
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
  try {
    const magic = getMagicInstance();
    
    // Send magic link to email
    const didToken = await magic.auth.loginWithMagicLink({ email });
    
    // Get user metadata
    const userMetadata = await magic.user.getInfo();
    
    // The Magic SDK might return different property names
    const publicAddress = (userMetadata as any).publicAddress || 
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
  try {
    const magic = getMagicInstance();
    
    // Attempt passkey login (if available)
    let didToken;
    try {
      didToken = await (magic.auth as any).loginWithPasskey?.();
    } catch (e) {
      throw new Error("Passkey login is not available or failed");
    }
    
    // Get user metadata
    const userMetadata = await magic.user.getInfo();
    
    // The Magic SDK might return different property names
    const publicAddress = (userMetadata as any).publicAddress || 
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
  try {
    const magic = getMagicInstance();
    const isLoggedIn = await magic.user.isLoggedIn();
    
    if (!isLoggedIn) {
      return null;
    }

    const userMetadata = await magic.user.getInfo();
    
    // The Magic SDK might return different property names
    const publicAddress = (userMetadata as any).publicAddress || 
                         (userMetadata as any).walletAddress || 
                         (userMetadata as any).address || "";
    
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
    "Please use Freighter wallet. Stellar support for Magic is coming soon."
  );
}
