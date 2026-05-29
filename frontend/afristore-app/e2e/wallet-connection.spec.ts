import { test, expect } from '@playwright/test';
import { mockFreighter, mockFreighterNotInstalled, mockFreighterWrongNetwork, TEST_PUBLIC_KEY } from './freighter-mock';

test.describe('Wallet Connection', () => {

  test('shows connect button when disconnected', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  });

  test('successful wallet connection shows success state and closes modal', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    const modal = page.getByText('Connect Wallet');
    await expect(modal).toBeVisible();
    await page.getByText('Freighter Wallet').click();
    await expect(page.getByText('Success!')).toBeVisible({ timeout: 10000 });
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 5000 });
  });

  test('shows error when freighter access denied', async ({ page }) => {
    await mockFreighter(page);
    await page.addInitScript(() => {
      (window as any).freighter.setAllowed = () => Promise.resolve({ isAllowed: false });
    });
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    await expect(page.getByText(/denied/i)).toBeVisible({ timeout: 10000 });
  });

});
