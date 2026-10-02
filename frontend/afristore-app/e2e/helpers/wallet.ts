import { Page, expect } from "@playwright/test";
import { mockFreighter, TEST_PUBLIC_KEY } from "../freighter-mock";

export async function connectFreighterWallet(
  page: Page,
  publicKey: string = TEST_PUBLIC_KEY,
) {
  try {
    await mockFreighter(page, { publicKey });
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const shortKey = `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
    await expect(page.getByText(shortKey).first()).toBeVisible({ timeout: 15_000 });
  } catch (err) {
    throw new Error(`connectFreighterWallet failed for ${publicKey}`, { cause: err });
  }
}

export async function openNewListingTab(page: Page) {
  try {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /new listing/i }).click();
    await expect(page.getByText("List Your Artwork")).toBeVisible();
  } catch (err) {
    throw new Error("openNewListingTab failed", { cause: err });
  }
}
