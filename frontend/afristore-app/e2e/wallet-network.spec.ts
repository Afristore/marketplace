import { test, expect } from "@playwright/test";
import { mockFreighter, mockFreighterWrongNetwork } from "./freighter-mock";

test.describe("Wallet Network Detection", () => {
  test("shows wrong network warning in navbar after connecting", async ({
    page,
  }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto("/");
    await expect(page.getByText(/wrong network/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows wrong network prompt in connect modal", async ({ page }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Connect Wallet", exact: true })
      .click();
    await expect(page.getByText(/switch the network/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test("prompts to switch networks instead of granting connected access", async ({
    page,
  }) => {
    await mockFreighterWrongNetwork(page);
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Connect Wallet", exact: true })
      .click();

    await expect(
      page.getByRole("heading", { name: "Wrong Network" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/switch the network/i)).toBeVisible();
    const refreshButton = page.getByRole("button", {
      name: /refresh connection/i,
    });
    await expect(refreshButton).toBeVisible();

    // The wallet never reaches the connected "Success!" state while the
    // network mismatch persists.
    await expect(page.getByText(/^success!$/i)).toHaveCount(0);

    // Retrying while still on the wrong network keeps the same prompt up
    // rather than closing the modal or granting access.
    await refreshButton.click();
    await expect(
      page.getByRole("heading", { name: "Wrong Network" }),
    ).toBeVisible();
    await expect(page.getByText(/^success!$/i)).toHaveCount(0);
  });
});
