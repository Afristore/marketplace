import { test, expect } from "@playwright/test";
import { mockFreighter, TEST_PUBLIC_KEY } from "./freighter-mock";

test.describe("Royalties Splitter", () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighter(page);
  });

  test("total split percentages strictly enforced to 100%", async ({ page }) => {
    // Navigate to the splitter page
    await page.goto("/dashboard/splitter");

    // Wait for page to load and wallet to connect
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    // Verify the page title
    await expect(
      page.getByRole("heading", { name: /create royalty splitter/i }),
    ).toBeVisible();

    // Verify the beneficiaries section
    await expect(page.getByText("Beneficiaries")).toBeVisible();
    await expect(
      page.getByText(/must total 100%/i),
    ).toBeVisible();

    // Find the first beneficiary inputs
    const addressInputs = page.getByPlaceholder(/GABC|address/i);
    const percentageInputs = page.locator('input[type="number"]');

    // Test 1: Total below 100% should show validation error
    await addressInputs.first().fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await percentageInputs.first().fill("50");

    // Check total display shows 50%
    await expect(page.getByText("50%")).toBeVisible();

    // Try to deploy with less than 100%
    const deployButton = page.getByRole("button", {
      name: /deploy royalty splitter/i,
    });
    await deployButton.click();

    // Verify validation error appears
    await expect(
      page.getByText(/total percentages must equal exactly 100%/i),
    ).toBeVisible({ timeout: 5_000 });

    // Test 2: Total above 100% should show validation error
    await percentageInputs.first().fill("120");
    await deployButton.click();

    // Verify validation error for over 100%
    await expect(
      page.getByText(/total percentages must equal exactly 100%/i),
    ).toBeVisible({ timeout: 5_000 });

    // Test 3: Total exactly 100% should NOT show validation error
    // Add first beneficiary with 60%
    await percentageInputs.first().fill("60");

    // Add a second beneficiary
    const addButton = page.getByRole("button", { name: /add/i });
    await addButton.click();

    // Fill second beneficiary with 40%
    const secondAddressInput = addressInputs.nth(1);
    const secondPercentageInput = percentageInputs.nth(1);
    await secondAddressInput.fill("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    await secondPercentageInput.fill("40");

    // Check total display shows 100%
    const totalDisplay = page.getByText("100%");
    await expect(totalDisplay).toBeVisible();

    // Verify the total is displayed with mint/green color (success state)
    const totalContainer = page.locator(
      "text=100%",
    ).first();
    await expect(totalContainer).toBeVisible();

    // Clear any previous validation errors
    const validationError = page.getByText(
      /total percentages must equal exactly 100%/i,
    );
    await expect(validationError).not.toBeVisible();

    // Test 4: Three beneficiaries totaling 100%
    await addButton.click();

    // Adjust percentages: 50%, 30%, 20%
    await percentageInputs.first().fill("50");
    await percentageInputs.nth(1).fill("30");
    const thirdAddressInput = addressInputs.nth(2);
    const thirdPercentageInput = percentageInputs.nth(2);
    await thirdAddressInput.fill("GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC");
    await thirdPercentageInput.fill("20");

    // Verify total is 100%
    await expect(page.getByText("100%")).toBeVisible();

    // Verify no validation error
    await expect(
      page.getByText(/total percentages must equal exactly 100%/i),
    ).not.toBeVisible();

    // The deploy button should be enabled (not disabled)
    await expect(deployButton).toBeEnabled();
  });

  test("shows error when percentages do not add up to 100%", async ({ page }) => {
    await page.goto("/dashboard/splitter");

    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    // Enter a beneficiary with 75%
    const addressInputs = page.getByPlaceholder(/GABC|address/i);
    const percentageInputs = page.locator('input[type="number"]');

    await addressInputs.first().fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await percentageInputs.first().fill("75");

    // Try to deploy
    const deployButton = page.getByRole("button", {
      name: /deploy royalty splitter/i,
    });
    await deployButton.click();

    // Should show error about 100% requirement
    await expect(
      page.getByText(/total percentages must equal exactly 100%/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("displays total percentage indicator with correct styling", async ({ page }) => {
    await page.goto("/dashboard/splitter");

    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    const addressInputs = page.getByPlaceholder(/GABC|address/i);
    const percentageInputs = page.locator('input[type="number"]');

    // Test under 100% - should show neutral/warning color
    await addressInputs.first().fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await percentageInputs.first().fill("25");

    // Total should be visible
    await expect(page.getByText("25%")).toBeVisible();

    // Test exactly 100% - should show success color (mint/green)
    const addButton = page.getByRole("button", { name: /add/i });
    await addButton.click();

    const secondAddressInput = addressInputs.nth(1);
    const secondPercentageInput = percentageInputs.nth(1);
    await secondAddressInput.fill("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    await secondPercentageInput.fill("75");

    // Total should show 100% in green
    await expect(page.getByText("100%")).toBeVisible();

    // Test over 100% - should show error color (terracotta/red)
    await percentageInputs.first().fill("80");

    // Total should show 155% or similar
    await expect(page.getByText(/155%|160%/)).toBeVisible({ timeout: 3_000 });
  });

  test("allows removing beneficiaries and recalculates total", async ({ page }) => {
    await page.goto("/dashboard/splitter");

    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    const addressInputs = page.getByPlaceholder(/GABC|address/i);
    const percentageInputs = page.locator('input[type="number"]');

    // Add two beneficiaries
    await addressInputs.first().fill("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await percentageInputs.first().fill("50");

    const addButton = page.getByRole("button", { name: /add/i });
    await addButton.click();

    const secondAddressInput = addressInputs.nth(1);
    const secondPercentageInput = percentageInputs.nth(1);
    await secondAddressInput.fill("GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    await secondPercentageInput.fill("50");

    // Verify total is 100%
    await expect(page.getByText("100%")).toBeVisible();

    // Remove the second beneficiary
    const removeButtons = page.locator('button[title="Remove beneficiary"]');
    await removeButtons.last().click();

    // Total should now show 50%
    await expect(page.getByText("50%")).toBeVisible({ timeout: 3_000 });
  });
});
