import { test, expect } from "@playwright/test";
import { connectFreighterWallet, openNewListingTab } from "./helpers/wallet";
import {
  MarketplaceTestStore,
  setupMarketplaceMocks,
  setupWalletIndexerMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";

test.describe("Dashboard empty state (#477)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    store.reset();
    await setupMarketplaceMocks(page, store);
    // User owns 0 NFTs — tokens endpoint returns an empty array.
    await setupWalletIndexerMocks(page, { tokens: [] });
    await resetE2eListingsInBrowser(page);
    await connectFreighterWallet(page);
  });

  test("dashboard handles empty state when user owns 0 NFTs", async ({
    page,
  }) => {
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
    test.setTimeout(90000);
    store.reset();
    await setupMarketplaceMocks(page, store);
    // User owns 2 NFTs
    await setupWalletIndexerMocks(page, { tokens: MOCK_TOKENS });
    await resetE2eListingsInBrowser(page);
    await connectFreighterWallet(page);
  });

  test("dashboard displays correct owned NFTs from indexer", async ({
    page,
  }) => {
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
  });
});
