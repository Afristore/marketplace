import { test, expect } from '@playwright/test';
import { mockFreighter } from './freighter-mock';

test.describe('Freighter Not Installed', () => {

  test('shows install prompt when freighter is missing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText(/install freighter/i)).toBeVisible({ timeout: 10000 });
  });

  test('refresh detection button appears when freighter is missing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText(/refresh detection/i)).toBeVisible({ timeout: 10000 });
  });

});
