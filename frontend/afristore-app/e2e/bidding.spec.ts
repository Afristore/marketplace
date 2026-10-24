import { test, expect } from "@playwright/test";
import { BUYER_PUBLIC_KEY, TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
  seedE2eAuctionInBrowser,
  failNextE2eTransaction,
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

test.describe("Bidding E2E", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    try {
      store.reset();
      await setupMarketplaceMocks(page, store);
    } catch (error) {
      throw new Error(
        `Failed to set up marketplace mocks before bidding test: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("placing a valid bid updates highest bid amount", async ({ page }) => {
    try {
      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await resetE2eListingsInBrowser(page);

      const futureTime = Math.floor(Date.now() / 1000) + 86400; // 1 day future
      await seedE2eAuctionInBrowser(page, {
        auction_id: 8003,
        creator: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        collection: "CA1234567890",
        token_id: 3,
        token: DEFAULT_TOKEN,
        reserve_price: 100_000_000n, // 10 XLM
        highest_bid: 0n,
        highest_bidder: null,
        end_time: futureTime,
        status: "Active",
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
        created_at: Math.floor(Date.now() / 1000),
      });

      await page.goto("/auctions/8003");
      await expect(page.getByText("Current Bid")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("No bids yet")).toBeVisible();

      const bidInput = page.getByPlaceholder(/min/i);
      await expect(bidInput).toBeVisible();
      await bidInput.fill("12");

      const bidBtn = page.getByRole("button", { name: /^bid$/i });
      await expect(bidBtn).toBeVisible();
      await bidBtn.click();

      await expect(page.getByText("Bid placed successfully!")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("12 XLM")).toBeVisible();
    } catch (error) {
      await captureFailureContext(page, "placing-a-valid-bid-updates-highest-bid-amount");
      throw new Error(
        `Failed to place a valid bid and update the highest bid amount: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("outbidding a user triggers outbid notification", async ({ page }) => {
    try {
      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await resetE2eListingsInBrowser(page);

      const futureTime = Math.floor(Date.now() / 1000) + 86400;
      await seedE2eAuctionInBrowser(page, {
        auction_id: 8004,
        creator: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        collection: "CA1234567890",
        token_id: 4,
        token: DEFAULT_TOKEN,
        reserve_price: 100_000_000n,
        highest_bid: 100_000_000n, // 10 XLM placed by TEST_PUBLIC_KEY
        highest_bidder: TEST_PUBLIC_KEY,
        end_time: futureTime,
        status: "Active",
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
        created_at: Math.floor(Date.now() / 1000),
      });

      await page.goto("/auctions/8004");
      await expect(page.getByText("Current Bid")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("10 XLM")).toBeVisible();

      const bidInput = page.getByPlaceholder(/min/i);
      await expect(bidInput).toBeVisible();
      await bidInput.fill("15");

      const bidBtn = page.getByRole("button", { name: /^bid$/i });
      await expect(bidBtn).toBeVisible();
      await bidBtn.click();

      await expect(page.getByText("Bid placed successfully!")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.locator('[data-testid="outbid-notification"]'),
      ).toBeVisible({ timeout: 15_000 });
    } catch (error) {
      await captureFailureContext(page, "outbidding-a-user-triggers-outbid-notification");
      throw new Error(
        `Failed to trigger outbid notification when outbidding a user: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("bidding with insufficient funds shows UI error (#524)", async ({ page }) => {
    try {
      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await resetE2eListingsInBrowser(page);

      const futureTime = Math.floor(Date.now() / 1000) + 86400;
      await seedE2eAuctionInBrowser(page, {
        auction_id: 8005,
        creator: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        collection: "CA1234567890",
        token_id: 5,
        token: DEFAULT_TOKEN,
        reserve_price: 100_000_000n, // 10 XLM
        highest_bid: 0n,
        highest_bidder: null,
        end_time: futureTime,
        status: "Active",
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
        created_at: Math.floor(Date.now() / 1000),
      });

      await page.goto("/auctions/8005");
      await expect(page.getByText("Current Bid")).toBeVisible({ timeout: 15_000 });

      const bidInput = page.getByPlaceholder(/min/i);
      await expect(bidInput).toBeVisible();
      await bidInput.fill("20");

      const bidBtn = page.getByRole("button", { name: /^bid$/i });
      await expect(bidBtn).toBeVisible();

      await failNextE2eTransaction(page, "Insufficient balance to place bid");
      await bidBtn.click();

      await expect(
        page.getByText(/insufficient balance|insufficient funds|failed to place bid/i).first(),
      ).toBeVisible({ timeout: 15_000 });
    } catch (error) {
      await captureFailureContext(page, "bidding-with-insufficient-funds-shows-ui-error");
      throw new Error(
        `Failed to show UI error when bidding with insufficient funds: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  test("bidding below reserve price or current highest bid is rejected (#525)", async ({
    page,
  }) => {
    try {
      await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
      await resetE2eListingsInBrowser(page);

      const futureTime = Math.floor(Date.now() / 1000) + 86400;

      await seedE2eAuctionInBrowser(page, {
        auction_id: 8006,
        creator: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        collection: "CA1234567890",
        token_id: 6,
        token: DEFAULT_TOKEN,
        reserve_price: 100_000_000n, // 10 XLM
        highest_bid: 0n,
        highest_bidder: null,
        end_time: futureTime,
        status: "Active",
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
        created_at: Math.floor(Date.now() / 1000),
      });

      await page.goto("/auctions/8006");
      await expect(page.getByText("Current Bid")).toBeVisible({ timeout: 15_000 });

      const bidInput = page.getByPlaceholder(/min/i);
      await expect(bidInput).toBeVisible();

      // Bidding below reserve price (5 XLM < 10 XLM)
      await bidInput.fill("5");
      await expect(
        page.getByText(/must be at least 10 XLM/i),
      ).toBeVisible();

      const bidBtn = page.getByRole("button", { name: /^bid$/i });
      await expect(bidBtn).toBeDisabled();

      // Bidding below current highest bid
      await seedE2eAuctionInBrowser(page, {
        auction_id: 8007,
        creator: TEST_PUBLIC_KEY,
        metadata_cid: E2E_METADATA_CID,
        collection: "CA1234567890",
        token_id: 7,
        token: DEFAULT_TOKEN,
        reserve_price: 100_000_000n, // 10 XLM
        highest_bid: 150_000_000n, // 15 XLM
        highest_bidder: TEST_PUBLIC_KEY,
        end_time: futureTime,
        status: "Active",
        recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
        created_at: Math.floor(Date.now() / 1000),
      });

      await page.goto("/auctions/8007");
      await expect(page.getByText("Current Bid")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("15 XLM")).toBeVisible();

      await bidInput.fill("12");
      await expect(
        page.getByText(/higher than current bid/i),
      ).toBeVisible();
      await expect(bidBtn).toBeDisabled();
    } catch (error) {
      await captureFailureContext(
        page,
        "bidding-below-reserve-price-or-current-highest-bid-is-rejected",
      );
      throw new Error(
        `Failed to reject bid below reserve price or current highest bid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
});
