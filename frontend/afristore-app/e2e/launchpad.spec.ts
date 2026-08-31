import { test, expect } from "@playwright/test";
import { TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  MarketplaceTestStore,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
  rejectNextE2eTransaction,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet } from "./helpers/wallet";

test.describe("Launchpad E2E", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
  });

  test("launchpad deployment signs soroban contract deployment (#531)", async ({
    page,
  }) => {
    await page.goto("/launchpad/create");
    await expect(page.getByText(/new collection/i)).toBeVisible({
      timeout: 15_000,
    });

    // Fill collection details
    await page
      .getByPlaceholder(/african legends/i)
      .fill("African Genesis");
    await page.getByPlaceholder(/afrl/i).fill("AFGEN");

    const deployBtn = page.getByRole("button", { name: /deploy collection/i });
    await expect(deployBtn).toBeEnabled();

    // Verify rejection scenario
    await rejectNextE2eTransaction(page);
    await deployBtn.click();

    await expect(
      page.getByText(/user declined access|failed/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Deploy successfully
    await deployBtn.click();

    await expect(page.getByText("Collection Deployed!")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/CB[A-Z0-9]+/i).first(),
    ).toBeVisible();
  });

  test("successful deployment redirects to new Collection page (#532)", async ({
    page,
  }) => {
    await page.goto("/launchpad/create");
    await expect(page.getByText(/new collection/i)).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByPlaceholder(/african legends/i)
      .fill("Safari Legends");
    await page.getByPlaceholder(/afrl/i).fill("SAFARI");

    const deployBtn = page.getByRole("button", { name: /deploy collection/i });
    await deployBtn.click();

    await expect(page.getByText("Collection Deployed!")).toBeVisible({
      timeout: 15_000,
    });

    const viewCollectionLink = page.getByRole("link", {
      name: /view collection/i,
    });
    await expect(viewCollectionLink).toBeVisible();
    await viewCollectionLink.click();

    await expect(page).toHaveURL(/\/launchpad\/collections\/CB[A-Z0-9]+/);
    await expect(page.getByText("Safari Legends").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("#530: launchpad validates collection name and symbol length", async ({
    page,
  }) => {
    await page.goto("/launchpad/create");
    await expect(page.getByText(/new collection/i)).toBeVisible({
      timeout: 15_000,
    });

    const deployBtn = page.getByRole("button", { name: /deploy collection/i });

    // Verify name is required — clicking deploy with empty fields should not submit
    await deployBtn.click();
    // Page should still show the form (no success state, no deploying text)
    await expect(page.getByPlaceholder(/african legends/i)).toBeVisible();
    await expect(page.getByText("Collection Deployed!")).not.toBeVisible();

    // Fill name but leave symbol empty, try again
    await page.getByPlaceholder(/african legends/i).fill("Test Collection");
    await deployBtn.click();
    // Symbol is required — form should not submit
    await expect(page.getByText("Collection Deployed!")).not.toBeVisible();

    // Verify symbol has maxLength={10}
    const symbolInput = page.getByPlaceholder(/afrl/i);
    await expect(symbolInput).toHaveAttribute("maxlength", "10");

    // Verify symbol auto-uppercases
    await symbolInput.fill("afrl");
    await expect(symbolInput).toHaveValue("AFRL");
  });
});
