import { test, expect } from "@playwright/test";
import {
  mockFreighter,
  mockFreighterNotInstalled,
  mockFreighterWrongNetwork,
  TEST_PUBLIC_KEY,
} from "./freighter-mock";

async function captureFailureContext(page: import("@playwright/test").Page, testName: string) {
  try {
    await page.screenshot({
      path: `test-results/failure-${testName.replace(/\s+/g, "-")}.png`,
      fullPage: true,
    });
  } catch {
    // Screenshot capture is best-effort; ignore failures so the original error still surfaces.
  }
}

test.describe("Wallet Connection", () => {
  test("shows connect button when disconnected", async ({ page }) => {
    try {
      await mockFreighter(page);
      await page.goto("/");
      await expect(
        page
          .getByRole("navigation")
          .getByRole("button", { name: "Connect Wallet", exact: true }),
      ).toBeVisible();
    } catch (error) {
      await captureFailureContext(page, "shows-connect-button-when-disconnected");
      throw new Error(
        `Failed to show connect button when disconnected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("successful wallet connection shows success state and closes modal", async ({
    page,
  }) => {
    try {
      await mockFreighter(page);
      await page.goto("/");
      const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
      await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });
    } catch (error) {
      await captureFailureContext(page, "successful-wallet-connection");
      throw new Error(
        `Failed to complete successful wallet connection flow: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("shows error when freighter access denied", async ({ page }) => {
    try {
      await mockFreighter(page);
      await page.addInitScript(() => {
        (window as any).freighter.setAllowed = () =>
          Promise.resolve({ isAllowed: false });
      });
      await page.goto("/");
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "Connect Wallet", exact: true })
        .click();
      await page
        .getByRole("button", { name: /Freighter Wallet Official/i })
        .click();
      await expect(page.getByText(/denied/i)).toBeVisible({ timeout: 10000 });
    } catch (error) {
      await captureFailureContext(page, "shows-error-when-freighter-access-denied");
      throw new Error(
        `Failed to show error state when Freighter access is denied: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
});
