import { test, expect, Page } from '@playwright/test';

// ── Constants ────────────────────────────────────────────────────────────────

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const WRONG_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const MOCK_PUBLIC_KEY = 'GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW';

// ── Mock injection helpers ────────────────────────────────────────────────────

/**
 * Injects a mock Freighter extension that returns a successful connection.
 * Must be called before page.goto() so addInitScript fires before app code.
 */
async function injectConnectedWallet(page: Page, networkPassphrase = TESTNET_PASSPHRASE) {
    await page.addInitScript(
        ({ pub, netPass }) => {
            // Mark extension as present (caught by isFreighterInstalled's window check)
            (window as any).freighter = { version: '5.0.0-mock' };

            // Stub the window.stellar API that @stellar/freighter-api v2 uses internally
            (window as any).stellar = {
                isConnected: () => Promise.resolve({ isConnected: true }),
                userInfo: () => Promise.resolve({ publicKey: pub }),
                getNetworkDetails: () =>
                    Promise.resolve({
                        network: netPass.includes('Test') ? 'TESTNET' : 'PUBLIC',
                        networkPassphrase: netPass,
                        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
                    }),
                addTrust: () => Promise.resolve({ result: true }),
                signAuthEntry: (_xdr: string) => Promise.resolve({ signedAuthEntry: 'mock-signed' }),
                signBlob: () => Promise.resolve({ result: 'mock-blob' }),
                signTransaction: (_xdr: string) =>
                    Promise.resolve({ signedTxXdr: 'mock-signed-xdr' }),
                requestPublicKey: () => Promise.resolve({ publicKey: pub }),
                setAllowed: () => Promise.resolve({ isAllowed: true }),
            };
        },
        { pub: MOCK_PUBLIC_KEY, netPass: networkPassphrase }
    );
}

/**
 * Opens the Connect Wallet modal via the navbar button.
 */
async function openWalletModal(page: Page) {
    // The desktop "Connect Wallet" navbar button
    await page.getByRole('button', { name: /connect wallet/i }).first().click();
}

// ── Test Suite ────────────────────────────────────────────────────────────────

test.describe('Wallet Connect Modal', () => {
    test('navbar renders a Connect Wallet button when disconnected', async ({ page }) => {
        await page.goto('/');
        const btn = page.getByRole('button', { name: /connect wallet/i }).first();
        await expect(btn).toBeVisible();
    });

    test('clicking Connect Wallet opens the modal', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await expect(page.getByRole('heading', { name: /connect wallet/i })).toBeVisible();
    });

    test('modal can be dismissed via the close button', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: '' }).filter({ has: page.locator('svg') }).first().click();
        await expect(page.getByRole('heading', { name: /connect wallet/i })).not.toBeVisible();
    });

    test('modal closes when clicking the backdrop', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        const modal = page.getByRole('heading', { name: /connect wallet/i });
        await expect(modal).toBeVisible();
        // Click the backdrop (outside the modal card)
        await page.mouse.click(10, 10);
        await expect(modal).not.toBeVisible();
    });

    test('modal shows security disclaimer text', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await expect(
            page.getByText(/afristore never has access to your private keys/i)
        ).toBeVisible();
    });
});

// ── Freighter Not Installed ───────────────────────────────────────────────────

test.describe('Freighter not installed', () => {
    test('modal shows Freighter Not Found state when extension is absent', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        // The modal initially shows a loading spinner; after 2 s it resolves to NOT_INSTALLED
        await expect(page.getByText(/freighter not found/i)).toBeVisible({ timeout: 5000 });
    });

    test('shows an Install Freighter button that links to freighter.app', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        const installLink = page.getByRole('link', { name: /install freighter/i });
        await expect(installLink).toBeVisible({ timeout: 5000 });
        await expect(installLink).toHaveAttribute('href', /freighter\.app/);
    });

    test('shows a "Already installed? Refresh detection" button', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await expect(
            page.getByRole('button', { name: /refresh detection/i })
        ).toBeVisible({ timeout: 5000 });
    });
});

// ── Network Switching Prompt ──────────────────────────────────────────────────

test.describe('Wrong network detection', () => {
    test.beforeEach(async ({ page }) => {
        await injectConnectedWallet(page, WRONG_PASSPHRASE);
    });

    test('shows Wrong Network state when passphrase does not match testnet', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);

        // Click the Freighter Wallet option to trigger connection
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        // After connection attempt, the wrong network UI should appear
        await expect(page.getByText(/wrong network/i)).toBeVisible({ timeout: 8000 });
    });

    test('wrong network view shows the expected network name', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        await expect(page.getByText(/testnet/i)).toBeVisible({ timeout: 8000 });
    });

    test('wrong network view shows a Refresh Connection button', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        await expect(
            page.getByRole('button', { name: /refresh connection/i })
        ).toBeVisible({ timeout: 8000 });
    });
});

// ── Successful Wallet Connection ──────────────────────────────────────────────

test.describe('Successful wallet connection', () => {
    test.beforeEach(async ({ page }) => {
        await injectConnectedWallet(page, TESTNET_PASSPHRASE);
    });

    test('shows Success state after connecting on the correct network', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        await expect(page.getByText(/success/i)).toBeVisible({ timeout: 8000 });
    });

    test('displays the connected public key after successful connection', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        // Public key is rendered in mono font after connecting
        await expect(page.getByText(MOCK_PUBLIC_KEY, { exact: false })).toBeVisible({
            timeout: 8000,
        });
    });

    test('modal auto-closes within a couple of seconds after successful connection', async ({
        page,
    }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        // Wait for success state then modal should disappear (1 s timeout in component)
        await expect(page.getByText(/success/i)).toBeVisible({ timeout: 8000 });
        await expect(
            page.getByRole('heading', { name: /connect wallet/i })
        ).not.toBeVisible({ timeout: 4000 });
    });

    test('navbar shows wallet address chip after connection', async ({ page }) => {
        await page.goto('/');
        await openWalletModal(page);
        await page.getByRole('button', { name: /freighter wallet/i }).click();

        // After the modal closes, the navbar should reflect the connected state
        // (no longer showing "Connect Wallet" text)
        await expect(
            page.getByRole('button', { name: /connect wallet/i }).first()
        ).not.toBeVisible({ timeout: 6000 });
    });
});

// ── Onboarding Flow ───────────────────────────────────────────────────────────

test.describe('Onboarding flow', () => {
    test('hero Get Started button triggers the connect flow', async ({ page }) => {
        await page.goto('/');
        const getStartedBtn = page.getByRole('button', { name: /get started/i });
        await expect(getStartedBtn).toBeVisible();
        await getStartedBtn.click();
        // Clicking "Get Started" calls connect() directly from the hero — the
        // modal stays closed but connection state should transition (loading or error)
        // For a unit-safe check we verify the button text changes or an error surfaces
        await expect(
            page.getByRole('button', { name: /connecting/i }).or(
                page.getByText(/freighter not found/i)
            )
        ).toBeVisible({ timeout: 5000 });
    });

    test('"How Afristore Works" section lists Connect Wallet as step 1', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Connect Wallet')).toBeVisible();
    });
});
