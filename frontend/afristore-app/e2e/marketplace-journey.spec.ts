import { test, expect } from "@playwright/test";
import path from "path";
import { BUYER_PUBLIC_KEY, TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet, openNewListingTab } from "./helpers/wallet";

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

test.describe("Marketplace journey (#199)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    try {
      store.reset();
      await setupMarketplaceMocks(page, store);
      await resetE2eListingsInBrowser(page);
    } catch (error) {
      console.error("Setup error in beforeEach:", error);
      throw error;
    }
  });

  test("seller lists an NFT via the creation form", async ({ page }) => {
    try {
      await connectFreighterWallet(page, TEST_PUBLIC_KEY);
      await openNewListingTab(page);

      const fileChooserPromise = page.waitForEvent("filechooser");
      await page.getByText("Select Your Artwork").click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

      await page.getByPlaceholder(/serengeti/i).fill(MOCK_ARTWORK_METADATA.title);
      await page
        .getByPlaceholder(/name or alias/i)
        .fill(MOCK_ARTWORK_METADATA.artist);
      await page
        .getByPlaceholder(/soul of this artwork/i)
        .fill(MOCK_ARTWORK_METADATA.description);

      const submitBtn = page.getByRole("button", { name: /create listing/i });
      await expect(submitBtn).toBeEnabled();
      await submitBtn.click();

      await expect(page.getByText(/Listing #\d+ Created/i)).toBeVisible({
        timeout: 30_000,
      });

      const heading = await page
        .getByRole("heading", { name: /Listing #\d+ Created/i })
        .textContent();
      const listingId = Number(heading?.match(/Listing #(\d+)/)?.[1]);
      expect(listingId).toBeGreaterThan(0);

      store.upsertActive({
        listing_id: listingId,
        artist: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        price: String(10 * 10_000_000),
        currency: "XLM",
        token: DEFAULT_TOKEN,
        status: "Active",
        owner: null,
        created_at: Math.floor(Date.now() / 1000),
        original_creator: TEST_PUBLIC_KEY,
        royalty_bps: 0,
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      });
    } catch (error) {
      console.error("Test error:", error);
      throw error;
    }
  });

  test("buyer completes a simulated crypto purchase", async ({ browser }) => {
    const sellerContext = await browser.newContext();
    const buyerContext = await browser.newContext();

    try {
      const sellerPage = await sellerContext.newPage();
      const buyerPage = await buyerContext.newPage();

      await setupMarketplaceMocks(sellerPage, store);
      await setupMarketplaceMocks(buyerPage, store);
      await resetE2eListingsInBrowser(sellerPage);

      // ── Seller creates listing ─────────────────────────────────────────────
      await connectFreighterWallet(sellerPage, TEST_PUBLIC_KEY);
      await openNewListingTab(sellerPage);

      const fileChooserPromise = sellerPage.waitForEvent("filechooser");
      await sellerPage.getByText("Select Your Artwork").click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

      await sellerPage
        .getByPlaceholder(/serengeti/i)
        .fill(MOCK_ARTWORK_METADATA.title);
      await sellerPage
        .getByPlaceholder(/name or alias/i)
        .fill(MOCK_ARTWORK_METADATA.artist);
      await sellerPage.getByRole("button", { name: /create listing/i }).click();
      await expect(sellerPage.getByText(/Listing #\d+ Created/i)).toBeVisible({
        timeout: 30_000,
      });

      const heading = await sellerPage
        .getByRole("heading", { name: /Listing #\d+ Created/i })
        .textContent();
      const listingId = Number(heading?.match(/Listing #(\d+)/)?.[1]);

      store.upsertActive({
        listing_id: listingId,
        artist: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        price: String(10 * 10_000_000),
        currency: "XLM",
        token: DEFAULT_TOKEN,
        status: "Active",
        owner: null,
        created_at: Math.floor(Date.now() / 1000),
        original_creator: TEST_PUBLIC_KEY,
        royalty_bps: 0,
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      });

      // ── Buyer purchases via explore + crypto checkout ────────────────────────
      await connectFreighterWallet(buyerPage, BUYER_PUBLIC_KEY);
      await buyerPage.goto("/explore");
      await expect(buyerPage.getByText("Explore Artworks")).toBeVisible();

      await expect(buyerPage.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible({
        timeout: 15_000,
      });

      const buyNow = buyerPage.getByRole("button", { name: /buy now/i }).first();
      await expect(buyNow).toBeEnabled();
      await buyNow.click();

      await expect(buyerPage.getByText("Checkout")).toBeVisible();
      await expect(buyerPage.getByText("Crypto")).toBeVisible();
      await buyerPage.getByRole("button", { name: /pay 10 xlm/i }).click();
      await expect(buyerPage.getByText("Checkout")).toBeHidden({
        timeout: 15_000,
      });

      store.markSold(listingId, BUYER_PUBLIC_KEY);
      await buyerPage.reload();
      await expect(
        buyerPage.getByRole("button", { name: /buy now/i }),
      ).toHaveCount(0);
    } catch (error) {
      console.error("Test error:", error);
      throw error;
    } finally {
      await sellerContext.close().catch(() => {});
      await buyerContext.close().catch(() => {});
    }
  });
});
