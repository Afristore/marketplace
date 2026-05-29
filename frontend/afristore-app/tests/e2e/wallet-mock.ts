import { Page } from '@playwright/test';

export async function mockFreighterWallet(page: Page, publicKey: string = 'GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I') {
  await page.addInitScript((mockPublicKey) => {
    // Mock the freighter API exposed on the window
    (window as any).freighterApi = {
      isConnected: async () => true,
      getPublicKey: async () => mockPublicKey,
      signTransaction: async (tx: string) => {
        return `mock-signature-for-${tx.substring(0, 10)}`;
      },
      getAddress: async () => mockPublicKey,
      connect: async () => true
    };
    
    // Also set sessionStorage if the app relies on it
    sessionStorage.setItem('e2e_freighter_installed', 'true');
    sessionStorage.setItem('e2e_wallet_public_key', mockPublicKey);
  }, publicKey);
}
