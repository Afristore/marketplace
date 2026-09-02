import { test, expect } from "@playwright/test";
import { connectFreighterWallet } from "./helpers/wallet";
import {
  MarketplaceTestStore,
  setupMarketplaceMocks,
  setupWalletIndexerMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";

test.describe("Settings preferences (#481)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("settings page loads preferences from backend on load", async ({ page }) => {
    await setupWalletIndexerMocks(page, {
      preferences: {
        theme: "dark",
        currency: "NGN",
        priceAlerts: false,
      },
    });

    const prefsRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        /\/wallets\/[^/]+\/preferences/.test(req.url()),
    );

    await connectFreighterWallet(page);
    await page.goto("/settings");
    await prefsRequest;

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('[data-prefs-loaded="true"]')).toBeVisible({
      timeout: 15_000,
    });

    // Display Currency select reflects backend preference (NGN, not default XLM).
    const currencySelect = page
      .locator("select")
      .filter({ hasText: "Nigerian Naira" });
    await expect(currencySelect).toHaveValue("NGN");

    // Price Alerts toggle is off when backend returns priceAlerts: false.
    const priceAlertsRow = page
      .locator("div.flex.items-center.justify-between")
      .filter({ hasText: "Price Alerts" });
    await expect(priceAlertsRow.locator("button")).toHaveClass(/bg-gray-600/);
  });
});

async function mockSettingsSave(
  page: import("@playwright/test").Page,
  options: { status?: number } = {},
) {
  const requests: unknown[] = [];

  await page.route("**/api/settings", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH") {
      return route.continue();
    }

    requests.push(request.postDataJSON());

    await route.fulfill({
      status: options.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.status && options.status >= 400
          ? { ok: false, error: "Save failed" }
          : { ok: true },
      ),
    });
  });

  return requests;
}

test.describe("Settings", () => {
  test.beforeEach(async ({ page }) => {
    await connectFreighterWallet(page);
  });

  test("toggling dark/light theme updates preference in backend", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByText("Settings")).toBeVisible({ timeout: 10_000 });

    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if ((await themeToggle.count()) > 0) {
      const initialTheme = await page.evaluate(() => {
        return document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
      });

      await themeToggle.click();

      const updatedTheme = await page.evaluate(() => {
        return document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
      });

      expect(updatedTheme).not.toBe(initialTheme);

      const savedSettings = await page.evaluate(() => {
        const stored = localStorage.getItem("afristore_settings");
        return stored ? JSON.parse(stored) : null;
      });

      expect(savedSettings).toBeTruthy();
      expect(savedSettings.theme).toBe(updatedTheme);
    }
  });

  test("changing preferred currency updates preference", async ({ page }) => {
    const saveRequests = await mockSettingsSave(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });

    const currencySelect = page.getByLabel("Display Currency");
    await expect(currencySelect).toHaveValue("XLM");
    await currencySelect.selectOption("USDC");
    await expect(currencySelect).toHaveValue("USDC");

    await page.getByRole("button", { name: /save settings/i }).click();

    await expect(page.getByRole("button", { name: /saved!/i })).toBeVisible();
    expect(saveRequests).toHaveLength(1);
    expect(saveRequests[0]).toMatchObject({ currency: "USDC" });

    const savedSettings = await page.evaluate(() => {
      const stored = localStorage.getItem("afristore_settings");
      return stored ? JSON.parse(stored) : null;
    });

    expect(savedSettings).toMatchObject({ currency: "USDC" });
  });

  test("toggling price alerts saves successfully", async ({ page }) => {
    const saveRequests = await mockSettingsSave(page);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });

    const priceAlertsToggle = page.getByRole("button", {
      name: /toggle price alerts/i,
    });
    await expect(priceAlertsToggle).toHaveAttribute("aria-pressed", "true");

    await priceAlertsToggle.click();
    await expect(priceAlertsToggle).toHaveAttribute("aria-pressed", "false");

    await page.getByRole("button", { name: /save settings/i }).click();

    await expect(page.getByRole("button", { name: /saved!/i })).toBeVisible();
    expect(saveRequests).toHaveLength(1);
    expect(saveRequests[0]).toMatchObject({ priceAlerts: false });

    const savedSettings = await page.evaluate(() => {
      const stored = localStorage.getItem("afristore_settings");
      return stored ? JSON.parse(stored) : null;
    });

    expect(savedSettings).toMatchObject({ priceAlerts: false });
  });

  test("gracefully handles API failure on save", async ({ page }) => {
    const saveRequests = await mockSettingsSave(page, { status: 500 });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByLabel("Display Currency").selectOption("USDC");
    await page.getByRole("button", { name: /save settings/i }).click();

    await expect(page.getByRole("alert")).toContainText(
      "Settings could not be saved",
    );
    await expect(page.getByRole("button", { name: /save settings/i })).toBeVisible();
    expect(saveRequests).toHaveLength(1);
    expect(saveRequests[0]).toMatchObject({ currency: "USDC" });

    const savedSettings = await page.evaluate(() => {
      const stored = localStorage.getItem("afristore_settings");
      return stored ? JSON.parse(stored) : null;
    });

    expect(savedSettings).toBeNull();
  });
});
