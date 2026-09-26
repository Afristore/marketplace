import { test, expect } from "@playwright/test";
import { mockFreighterNotInstalled } from "./freighter-mock";

test.describe("Freighter Not Installed", () => {
  test("shows install prompt when freighter is missing", async ({ page }) => {
    try {
      await mockFreighterNotInstalled(page);
      await page.goto("/");
      await page.getByRole("button", { name: /connect wallet/i }).click();
      await expect(page.getByText(/install freighter/i)).toBeVisible({
        timeout: 10000,
      });
    } catch (error) {
      console.error("Test error:", error);
      expect.fail(`Test failed with error: ${error}`);
    }
  });

  test("refresh detection button appears when freighter is missing", async ({
    page,
  }) => {
    try {
      await mockFreighterNotInstalled(page);
      await page.goto("/");
      await page.getByRole("button", { name: /connect wallet/i }).click();
      await expect(page.getByText(/refresh detection/i)).toBeVisible({
        timeout: 10000,
      });
    } catch (error) {
      console.error("Test error:", error);
      expect.fail(`Test failed with error: ${error}`);
    }
  });
});
