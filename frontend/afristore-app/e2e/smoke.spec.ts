import { test, expect } from '@playwright/test';

test('homepage loads and displays branding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Afristore').first()).toBeVisible();
  await expect(page.getByText('Where African Art')).toBeVisible();
  await expect(page.getByText('Meets the Blockchain')).toBeVisible();
});

test('navigation bar is present', async ({ page }) => {
  await page.goto('/');
  const nav = page.locator('nav');
  await expect(nav).toBeVisible();
  await expect(nav.getByText('Explore')).toBeVisible();
  await expect(nav.getByText('Auctions')).toBeVisible();
  await expect(nav.getByText('Launchpad')).toBeVisible();
});
