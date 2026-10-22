import { test, expect } from "@playwright/test";
import { connectFreighterWallet, openNewListingTab } from "./helpers/wallet";
import {
  MarketplaceTestStore,
  setupMarketplaceMocks,
  setupWalletIndexerMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";

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

test.describe("Dashboard empty state (#477)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    try {
      test.setTimeout(90000);
      store.reset();
      await setupMarketplaceMocks(page, store);
      // User owns 0 NFTs — tokens endpoint returns an empty array.
      await setupWalletIndexerMocks(page, { tokens: [] });
      await resetE2eListingsInBrowser(page);
      await connectFreighterWallet(page);
    } catch (error) {
      throw new Error(
        `Failed to set up dashboard empty-state mocks: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("dashboard handles empty state when user owns 0 NFTs", async ({
    page,
  }) => {
    try {
      const tokensRequest = page.waitForRequest(
        (req) =>
          req.method() === "GET" &&
          /\/wallets\/[^/]+\/tokens/.test(req.url()),
      );

      await openNewListingTab(page);
      await tokensRequest;

      await expect(
        page.getByText("No NFTs found in your wallet"),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(/don't own any NFTs on this network/i),
      ).toBeVisible();
    } catch (error) {
      await captureFailureContext(page, "dashboard-handles-empty-state-when-user-owns-0-nfts");
      throw new Error(
        `Failed to handle dashboard empty state for a wallet with 0 NFTs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
});

test.describe("Dashboard owned NFTs (#476)", () => {
  const store = new MarketplaceTestStore();

  const MOCK_TOKENS = [
    {
      collectionAddress: "CDP7YNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I",
      tokenId: 42,
      name: "Serengeti Sunset",
      image: "ipfs://image-cid-1",
    },
    {
      collectionAddress: "CDP7YNF7SOWQ3GLR2ZGMH7TQZ2N2LHCP5JH5C4H4K2PJ7X2OV4YH4L7I",
      tokenId: 99,
      name: "African Horizon",
      image: "ipfs://image-cid-2",
    },
  ];

  test.beforeEach(async ({ page }) => {
    try {
      test.setTimeout(90000);
      store.reset();
      await setupMarketplaceMocks(page, store);
      // User owns 2 NFTs
      await setupWalletIndexerMocks(page, { tokens: MOCK_TOKENS });
      await resetE2eListingsInBrowser(page);
      await connectFreighterWallet(page);
    } catch (error) {
      throw new Error(
        `Failed to set up dashboard owned-NFTs mocks: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("dashboard displays correct owned NFTs from indexer", async ({
    page,
  }) => {
    try {
      // Navigate to new listing / gallery view to load owned NFTs
      await page.goto("/dashboard");
      await page.getByRole("button", { name: /new listing/i }).click();

      // Check that we can see the selection title
      await expect(page.getByText("Select an NFT to List")).toBeVisible({ timeout: 15_000 });

      // Assert that the tokens returned from the indexer are correctly displayed
      for (const token of MOCK_TOKENS) {
        await expect(page.getByText(token.name)).toBeVisible();
        await expect(page.getByText(`ID: ${token.tokenId}`)).toBeVisible();
      }
    } catch (error) {
      await captureFailureContext(page, "dashboard-displays-correct-owned-nfts-from-indexer");
      throw new Error(
        `Failed to display owned NFTs from indexer on dashboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
});
