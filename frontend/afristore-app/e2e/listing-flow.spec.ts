import { test, expect } from '@playwright/test';
import { mockFreighter, TEST_PUBLIC_KEY } from './freighter-mock';
import path from 'path';

test.describe('NFT Listing Flow', () => {

  test('listing form renders all required fields', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 5000 });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /list your art/i }).click();
    await expect(page.getByText('List Your Artwork')).toBeVisible();
    await expect(page.getByPlaceholder(/serengeti/i)).toBeVisible();
    await expect(page.getByPlaceholder(/name or alias/i)).toBeVisible();
    await expect(page.getByText('Category')).toBeVisible();
    await expect(page.getByText('Price')).toBeVisible();
  });

  test('listing form validates required fields', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 5000 });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /list your art/i }).click();
    const submitBtn = page.getByRole('button', { name: /create listing/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('listing form accepts image file selection', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/');
    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByText('Freighter Wallet').click();
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 5000 });
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /list your art/i }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByText('Select Your Artwork').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'test-art.png',
      mimeType: 'image/png',
      buffer: Buffer.from('fake-png-content'),
    });
    await expect(page.locator('img[alt="Preview"]')).toBeVisible({ timeout: 5000 });
  });

});
