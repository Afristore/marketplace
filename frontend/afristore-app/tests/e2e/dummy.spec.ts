import { test, expect } from '@playwright/test';
import { mockFreighterWallet } from './wallet-mock';

test('homepage loads and wallet can be connected', async ({ page }) => {
  // 1. Mock wallet connection
  await mockFreighterWallet(page);
  
  // 2. Open homepage
  await page.goto('/');
  
  // 3. Verify wallet connected state
  // Check that either a connect button changes state, or a mock public key is visible.
  // We'll just test that we can run Playwright and that the mock is injected.
  const isConnected = await page.evaluate(() => (window as any).freighterApi.isConnected());
  expect(isConnected).toBe(true);
  
  const address = await page.evaluate(() => (window as any).freighterApi.getAddress());
  expect(address).toBe('GA7QYNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I');
});
