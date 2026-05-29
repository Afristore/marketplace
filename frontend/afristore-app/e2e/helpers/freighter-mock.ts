import type { Page } from '@playwright/test';

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const MOCK_PUBLIC_KEY = 'GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW';

export type FreighterMockOptions = {
    isInstalled?: boolean;
    isAllowed?: boolean;
    publicKey?: string;
    networkPassphrase?: string;
};

/**
 * Injects a mock of the Freighter browser extension APIs into the page
 * before any application scripts run, enabling wallet E2E tests without
 * a real browser extension.
 */
export async function injectFreighterMock(
    page: Page,
    opts: FreighterMockOptions = {}
): Promise<void> {
    const {
        isInstalled = true,
        isAllowed = true,
        publicKey = MOCK_PUBLIC_KEY,
        networkPassphrase = TESTNET_PASSPHRASE,
    } = opts;

    await page.addInitScript(
        ({ isInstalled, isAllowed, publicKey, networkPassphrase }) => {
            // Mark the extension as present so isFreighterInstalled() returns true
            if (isInstalled) {
                (window as any).freighter = { version: '5.0.0' };
            }

            // Stub the @stellar/freighter-api module-level functions that the
            // app calls through lib/freighter.ts
            (window as any).__freighterMock = {
                isConnected: () => Promise.resolve(isInstalled),
                setAllowed: () => Promise.resolve({ isAllowed }),
                getPublicKey: () =>
                    isAllowed
                        ? Promise.resolve(publicKey)
                        : Promise.reject(new Error('Not allowed')),
                getNetworkDetails: () =>
                    Promise.resolve({ networkPassphrase }),
                signTransaction: (_xdr: string) =>
                    Promise.resolve({ signedTxXdr: 'mock-signed-xdr' }),
            };
        },
        { isInstalled, isAllowed, publicKey, networkPassphrase }
    );
}
