import { Page } from "@playwright/test";

export const TEST_PUBLIC_KEY =
  "GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I";
/** Second wallet for purchase E2E (seller must differ from buyer). */
export const BUYER_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
export const TEST_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const WRONG_NETWORK_PASSPHRASE =
  "Public Global Stellar Network ; September 2015";

const KEY_STORAGE = "e2e_wallet_public_key";
const PASSPHRASE_STORAGE = "e2e_network_passphrase";
const INSTALLED_STORAGE = "e2e_freighter_installed";

/**
 * Seeds sessionStorage before navigation so useE2eWallet connects without Freighter.
 * Requires NEXT_PUBLIC_E2E_MOCK_CHAIN=true on the dev server.
 */
export async function mockFreighter(
  page: Page,
  overrides?: {
    publicKey?: string;
    networkPassphrase?: string;
  },
) {
  try {
    const publicKey = overrides?.publicKey ?? TEST_PUBLIC_KEY;
    const networkPassphrase =
      overrides?.networkPassphrase ?? TEST_NETWORK_PASSPHRASE;

    await page.addInitScript(
      ({ pk, passphrase, keyStorage, passphraseStorage, installedStorage }) => {
        sessionStorage.setItem(installedStorage, "true");
        sessionStorage.setItem(keyStorage, pk);
        sessionStorage.setItem(passphraseStorage, passphrase);
      },
      {
        pk: publicKey,
        passphrase: networkPassphrase,
        keyStorage: KEY_STORAGE,
        passphraseStorage: PASSPHRASE_STORAGE,
        installedStorage: INSTALLED_STORAGE,
      },
    );
  } catch (error) {
    console.error("Failed to mock Freighter wallet:", error);
    throw error;
  }
}

export async function mockFreighterNotInstalled(page: Page) {
  try {
    await page.addInitScript(
      ({ keyStorage, passphraseStorage, installedStorage }) => {
        sessionStorage.setItem(installedStorage, "false");
        sessionStorage.removeItem(keyStorage);
        sessionStorage.removeItem(passphraseStorage);
      },
      {
        keyStorage: KEY_STORAGE,
        passphraseStorage: PASSPHRASE_STORAGE,
        installedStorage: INSTALLED_STORAGE,
      },
    );
  } catch (error) {
    console.error("Failed to mock Freighter as not installed:", error);
    throw error;
  }
}

export async function mockFreighterWrongNetwork(page: Page) {
  try {
    await mockFreighter(page, { networkPassphrase: WRONG_NETWORK_PASSPHRASE });
  } catch (error) {
    console.error("Failed to mock Freighter with wrong network:", error);
    throw error;
  }
}
