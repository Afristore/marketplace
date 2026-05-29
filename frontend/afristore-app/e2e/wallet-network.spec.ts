import { test, expect } from '@playwright/test';
import { mockFreighter, mockFreighterWrongNetwork } from './freighter-mock';

test.describe('Wallet Network Detection', () => {

  test('shows wrong network warning in navbar after connecting', async ({ page }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    await expect(page.getByText(/wrong network/i)).toBeVisible({ timeout: 10000 });
  });

  test('shows wrong network prompt in connect modal', async ({ page }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    await expect(page.getByText(/switch the network/i)).toBeVisible({ timeout: 10000 });
  });

});
