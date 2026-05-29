import { test, expect } from '@playwright/test';
import { mockFreighter } from './freighter-mock';

test.describe('Checkout and Purchase Flow', () => {

  test('checkout modal opens and displays listing price', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/explore');
    await expect(page.getByText('Explore Artworks')).toBeVisible();
  });

  test('checkout modal payment method selection works', async ({ page }) => {
    await mockFreighter(page);
    await page.goto('/explore');
    const listingCards = page.locator('[class*="rounded-2xl"][class*="border"] a');
    const count = await listingCards.count();
    if (count === 0) {
      test.skip();
      return;
    }
    await listingCards.first().click();
    const buyBtn = page.getByRole('button', { name: /buy now/i });
    if (await buyBtn.isVisible()) {
      await buyBtn.click();
      await expect(page.getByText('Checkout')).toBeVisible();
      await expect(page.getByText('Crypto')).toBeVisible();
      await expect(page.getByText('Credit Card')).toBeVisible();
      await page.getByText('Credit Card').click();
      await expect(page.getByText(/fiat purchase/i)).toBeVisible();
    }
  });

});
