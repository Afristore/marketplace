import { test, expect } from "@playwright/test";
import { BUYER_PUBLIC_KEY, TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
  seedE2eAuctionInBrowser,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet } from "./helpers/wallet";

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

test.describe("Auctions Lifecycle E2E", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
  });

  test("auction finalize button appears for creator after countdown ends", async ({
    page,
  }) => {
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await resetE2eListingsInBrowser(page);

    const expiredTime = Math.floor(Date.now() / 1000) - 100;
    await seedE2eAuctionInBrowser(page, {
      auction_id: 8001,
      creator: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      collection: "CA1234567890",
      token_id: 1,
      token: DEFAULT_TOKEN,
      reserve_price: 100_000_000n, // 10 XLM
      highest_bid: 150_000_000n, // 15 XLM
      highest_bidder: BUYER_PUBLIC_KEY,
      end_time: expiredTime,
      status: "Active",
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      created_at: Math.floor(Date.now() / 1000) - 3600,
    });

    await page.goto("/auctions/8001");
    await expect(page.getByText("Auction Ended")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: /finalize auction/i }),
    ).toBeVisible();
  });

  test("finalize transaction transfers NFT to highest bidder", async ({
    page,
  }) => {
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await resetE2eListingsInBrowser(page);

    const expiredTime = Math.floor(Date.now() / 1000) - 100;
    await seedE2eAuctionInBrowser(page, {
      auction_id: 8002,
      creator: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      collection: "CA1234567890",
      token_id: 2,
      token: DEFAULT_TOKEN,
      reserve_price: 100_000_000n,
      highest_bid: 200_000_000n,
      highest_bidder: BUYER_PUBLIC_KEY,
      end_time: expiredTime,
      status: "Active",
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      created_at: Math.floor(Date.now() / 1000) - 3600,
    });

    await page.goto("/auctions/8002");
    await expect(page.getByText("Auction Ended")).toBeVisible({ timeout: 15_000 });

    const finalizeBtn = page.getByRole("button", { name: /finalize auction/i });
    await expect(finalizeBtn).toBeVisible();
    await finalizeBtn.click();

    await expect(
      page.getByText(/auction finalized successfully|won by/i),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("auction page shows 'Auction Ended' and hides the Bid button after expiration", async ({
    page,
  }) => {
    await connectFreighterWallet(page, BUYER_PUBLIC_KEY);
    await resetE2eListingsInBrowser(page);

    const now = Math.floor(Date.now() / 1000);

    // Live auction — control case: bidding UI is available.
    await seedE2eAuctionInBrowser(page, {
      auction_id: 8003,
      creator: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      collection: "CA1234567890",
      token_id: 3,
      token: DEFAULT_TOKEN,
      reserve_price: 100_000_000n,
      highest_bid: 0n,
      highest_bidder: null,
      end_time: now + 3600,
      status: "Active",
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      created_at: now - 3600,
    });

    // Expired auction — subject under test.
    await seedE2eAuctionInBrowser(page, {
      auction_id: 8004,
      creator: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      collection: "CA1234567890",
      token_id: 4,
      token: DEFAULT_TOKEN,
      reserve_price: 100_000_000n,
      highest_bid: 150_000_000n,
      highest_bidder: BUYER_PUBLIC_KEY,
      end_time: now - 100,
      status: "Active",
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
      created_at: now - 3600,
    });

    const bidButton = page.getByRole("button", { name: /^bid$/i });

    await page.goto("/auctions/8003");
    await expect(page.getByText("Place a Bid")).toBeVisible({ timeout: 15_000 });
    await expect(bidButton).toBeVisible();
    await expect(page.getByText("Auction Ended")).toHaveCount(0);

    await page.goto("/auctions/8004");
    await expect(page.getByText("Auction Ended")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Place a Bid")).toHaveCount(0);
    await expect(bidButton).toHaveCount(0);
    await expect(page.getByPlaceholder(/^Min\./)).toHaveCount(0);

    // Viewer is not the creator, so no finalize affordance is offered either.
    await expect(
      page.getByRole("button", { name: /finalize auction/i }),
    ).toHaveCount(0);
  });
});
