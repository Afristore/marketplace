import { Page } from '@playwright/test';

export const TEST_PUBLIC_KEY = 'GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I';
export const TEST_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const WRONG_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

export async function mockFreighter(page: Page, overrides?: {
  publicKey?: string;
  networkPassphrase?: string;
}) {
  const publicKey = overrides?.publicKey ?? TEST_PUBLIC_KEY;
  const networkPassphrase = overrides?.networkPassphrase ?? TEST_NETWORK_PASSPHRASE;

  await page.addInitScript(() => {
    const mock = {
      isConnected: () => Promise.resolve({ isConnected: true }),
      setAllowed: () => Promise.resolve({ isAllowed: true }),
      getPublicKey: () => Promise.resolve(publicKey),
      getNetwork: () => Promise.resolve({ network: 'testnet' }),
      getNetworkDetails: () => Promise.resolve({ networkPassphrase }),
      signTransaction: (txXdr: string, _opts?: any) =>
        Promise.resolve({ signedTxXdr: txXdr }),
      signBlob: (blob: string, _opts?: any) =>
        Promise.resolve({ signedBlob: blob }),
    };

    (window as any).freighter = mock;
    (window as any).starlight = mock;
  });
}

export async function mockFreighterNotInstalled(page: Page) {
  await page.addInitScript(() => {
    (window as any).freighter = undefined;
    (window as any).starlight = undefined;
  });
}

export async function mockFreighterWrongNetwork(page: Page) {
  await mockFreighter(page, { networkPassphrase: WRONG_NETWORK_PASSPHRASE });
}
