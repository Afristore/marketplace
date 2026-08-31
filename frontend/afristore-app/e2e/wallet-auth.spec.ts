import { test, expect, Page } from "@playwright/test";
import { mockFreighter, TEST_PUBLIC_KEY } from "./freighter-mock";

const MAGIC_PUBLIC_KEY =
  "GBVFEOFMZAUI7WVPDMGTQZ3BO63BKGKVFKFKMLMDAZDCIYB2MZZXKVW";
const MAGIC_SHORT_KEY = `${MAGIC_PUBLIC_KEY.slice(0, 4)}…${MAGIC_PUBLIC_KEY.slice(-4)}`;
const FREIGHTER_SHORT_KEY = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;

test.describe("Magic Wallet — Passkey Login", () => {
  test("connects via passkey and shows success state", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /connect wallet/i })
      .first()
      .click();

    await page.getByRole("button", { name: /magic wallet/i }).click();
    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /passkey login/i }).click();

    await expect(page.getByText(/success/i).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(
      page.getByText(MAGIC_PUBLIC_KEY, { exact: false }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).not.toBeVisible({ timeout: 4000 });

    await expect(page.getByText(MAGIC_SHORT_KEY).first()).toBeVisible({
      timeout: 6000,
    });
  });
});

test.describe("Magic Wallet — Email Login", () => {
  test("connects via email and shows success state", async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /connect wallet/i })
      .first()
      .click();

    await page.getByRole("button", { name: /magic wallet/i }).click();
    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /email magic link/i }).click();

    await page
      .getByPlaceholder(/you@example.com/i)
      .fill("test@afristore.xyz");
    await page.getByRole("button", { name: /send magic link/i }).click();

    await expect(page.getByText(/success/i).first()).toBeVisible({
      timeout: 8000,
    });
    await expect(
      page.getByText(MAGIC_PUBLIC_KEY, { exact: false }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).not.toBeVisible({ timeout: 4000 });

    await expect(page.getByText(MAGIC_SHORT_KEY).first()).toBeVisible({
      timeout: 6000,
    });
  });
});

test.describe("Disconnect Wallet", () => {
  test("disconnecting clears session state and resets navbar", async ({
    page,
  }) => {
    await mockFreighter(page);
    await page.goto("/");

    await expect(page.getByText(FREIGHTER_SHORT_KEY).first()).toBeVisible({
      timeout: 10000,
    });

    await page.getByText(FREIGHTER_SHORT_KEY).first().click();
    await page
      .getByRole("button", { name: /^disconnect$/i })
      .first()
      .click();

    await expect(
      page
        .getByRole("button", { name: /^connect wallet$/i })
        .first()
        .or(page.getByRole("button", { name: /^connecting/i }).first()),
    ).toBeVisible({ timeout: 6000 });
  });
});

test.describe("Reconnect Different Wallet", () => {
  test("reconnecting with magic after freighter updates the navbar", async ({
    page,
  }) => {
    await mockFreighter(page);
    await page.goto("/");

    await expect(page.getByText(FREIGHTER_SHORT_KEY).first()).toBeVisible({
      timeout: 10000,
    });

    await page.getByText(FREIGHTER_SHORT_KEY).first().click();
    await page
      .getByRole("button", { name: /^disconnect$/i })
      .first()
      .click();

    await expect(
      page
        .getByRole("button", { name: /^connect wallet$/i })
        .first()
        .or(page.getByRole("button", { name: /^connecting/i }).first()),
    ).toBeVisible({ timeout: 6000 });

    await page
      .getByRole("button", { name: /^connect wallet$/i })
      .first()
      .click();
    await page.getByRole("button", { name: /magic wallet/i }).click();
    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /passkey login/i }).click();
    await expect(page.getByText(/success/i).first()).toBeVisible({
      timeout: 8000,
    });

    await expect(
      page.getByRole("heading", { name: /^magic wallet$/i }),
    ).not.toBeVisible({ timeout: 4000 });

    await expect(page.getByText(MAGIC_SHORT_KEY).first()).toBeVisible({
      timeout: 6000,
    });

    await expect(
      page.getByText(FREIGHTER_SHORT_KEY, { exact: false }),
    ).not.toBeVisible();
  });
});
