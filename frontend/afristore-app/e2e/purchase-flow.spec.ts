import { test, expect } from "@playwright/test";
import { BUYER_PUBLIC_KEY, TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet } from "./helpers/wallet";

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

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

test.describe("Checkout and Purchase Flow", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    try {
      store.reset();
      await setupMarketplaceMocks(page, store);
      await resetE2eListingsInBrowser(page);
    } catch (error) {
      throw new Error(
        `Failed to set up marketplace mocks before purchase flow test: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("checkout modal opens and displays listing price", async ({ page }) => {
    try {
      store.upsertActive({
        listing_id: 9001,
        artist: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        price: String(25 * 10_000_000),
        currency: "XLM",
        token: DEFAULT_TOKEN,
        status: "Active",
        owner: null,
        created_at: Math.floor(Date.now() / 1000),
        original_creator: TEST_PUBLIC_KEY,
        royalty_bps: 0,
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      });

      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await page.goto("/explore");
      await expect(page.getByText("Explore Artworks")).toBeVisible();
      await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();
      await expect(page.getByText("25 XLM")).toBeVisible();
    } catch (error) {
      await captureFailureContext(page, "checkout-modal-opens-and-displays-listing-price");
      throw new Error(
        `Failed to open checkout modal and display listing price: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("crypto checkout simulates buy_artwork transaction", async ({
    page,
  }) => {
    try {
      store.upsertActive({
        listing_id: 9002,
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

      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await page.goto("/explore");
      await page
        .getByRole("button", { name: /buy now/i })
        .first()
        .click();
      await expect(page.getByText("Checkout")).toBeVisible();
      await page.getByRole("button", { name: /pay 10 xlm/i }).click();
      await expect(page.getByText("Checkout")).toBeHidden({ timeout: 15_000 });

      store.markSold(9002, BUYER_PUBLIC_KEY);
      await page.reload();
      await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);
    } catch (error) {
      await captureFailureContext(page, "crypto-checkout-simulates-buy-artwork-transaction");
      throw new Error(
        `Failed to complete crypto checkout buy_artwork simulation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("checkout modal payment method selection works", async ({ page }) => {
    try {
      store.upsertActive({
        listing_id: 9003,
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

      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await page.goto("/explore");
      await page
        .getByRole("button", { name: /buy now/i })
        .first()
        .click();
      await expect(page.getByText("Checkout")).toBeVisible();
      await expect(page.getByText("Crypto")).toBeVisible();
      await expect(page.getByText("Credit Card")).toBeVisible();
      await page.getByText("Credit Card").click();
      await expect(page.getByText(/fiat purchase/i)).toBeVisible();
    } catch (error) {
      await captureFailureContext(page, "checkout-modal-payment-method-selection-works");
      throw new Error(
        `Failed to select payment method in checkout modal: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
});
