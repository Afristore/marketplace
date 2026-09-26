import { test, expect } from "@playwright/test";
import { safeGoto, collectPageErrors } from "./helpers/error-handling";

test("homepage loads and displays branding", async ({ page }) => {
  const pageErrors = collectPageErrors(page);
  await safeGoto(page, "/");
  await expect(page.getByText("Afristore").first()).toBeVisible();
  await expect(page.getByText("Where African Art")).toBeVisible();
  await expect(page.getByText("Meets the Blockchain")).toBeVisible();
  // Nothing on the homepage may throw an uncaught error or unhandled rejection.
  expect(pageErrors).toEqual([]);
});

test("navigation bar is present", async ({ page }) => {
  await safeGoto(page, "/");
  const nav = page.locator("nav");
  await expect(nav).toBeVisible();
  await expect(nav.getByText("Explore")).toBeVisible();
  await expect(nav.getByText("Auctions")).toBeVisible();
  await expect(nav.getByText("Launchpad")).toBeVisible();
});
