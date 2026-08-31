import { test, expect, Page } from "@playwright/test";
import { connectFreighterWallet } from "./helpers/wallet";
import { TEST_PUBLIC_KEY, BUYER_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  setupWalletIndexerMocks,
  resetE2eListingsInBrowser,
} from "./helpers/marketplace-mocks";

const INDEXER_URL = (
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

async function mockProfileIndexer(page: Page) {
  await page.route(`${INDEXER_URL}/wallets/${TEST_PUBLIC_KEY}/activity**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 101,
          listingId: "42",
          eventType: "ARTWORK_SOLD",
          actor: TEST_PUBLIC_KEY,
          data: {
            artist: TEST_PUBLIC_KEY,
            buyer: "GBUYERWALLET000000000000000000000000000000000000000000000",
            price: "88.5",
          },
          ledgerSequence: 123456,
          ledgerTimestamp: "2026-07-20T10:30:00.000Z",
        },
      ]),
    });
  });

  await page.route(`${INDEXER_URL}/wallets/${TEST_PUBLIC_KEY}/royalty-stats`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalEarned: "27.75",
        payoutCount: 3,
        lastPayout: 1784543400000,
      }),
    });
  });

  await page.route(`${INDEXER_URL}/listings**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ listings: [], total: 0 }),
    });
  });
}

test.describe("Profile", () => {
  test("profile page displays correct royalty statistics", async ({ page }) => {
    await mockProfileIndexer(page);
    await connectFreighterWallet(page);

    await page.goto("/profile");

    await expect(page.getByRole("heading", { name: /african patron/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Creator Royalties")).toBeVisible();
    await expect(page.getByText("27.75")).toBeVisible();
    await expect(page.getByText("XLM")).toBeVisible();
    await expect(page.getByText(/3\s+Payouts Found/i)).toBeVisible();
  });
});

test.describe("Profile past sales history (#480)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await setupWalletIndexerMocks(page);
    await resetE2eListingsInBrowser(page);
  });

  test("profile page displays user past sales history", async ({ page }) => {
    store.upsertActive({
      listing_id: 4801,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(42 * 10_000_000),
      currency: "XLM",
      token: DEFAULT_TOKEN,
      status: "Sold",
      owner: BUYER_PUBLIC_KEY,
      created_at: Math.floor(Date.now() / 1000),
      original_creator: TEST_PUBLIC_KEY,
      royalty_bps: 500,
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
    });

    const artistListingsRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes("/listings") &&
        req.url().includes(`artist=${encodeURIComponent(TEST_PUBLIC_KEY)}`),
    );

    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await page.goto("/profile");
    await artistListingsRequest;

    await expect(page.getByText("African")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /heritage sold/i }).click();

    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Sold").first()).toBeVisible();
    await expect(page.getByText("42 XLM")).toBeVisible();
  });
});

test.describe("Profile artwork image fallbacks", () => {
  const store = new MarketplaceTestStore();

  const BROKEN_METADATA_CID = "QmE2eBrokenImageMetadataCid";
  const BROKEN_IMAGE_CID = "QmE2eUnreachableImageCid";
  const MISSING_METADATA_CID = "QmE2eMissingImageMetadataCid";

  const BROKEN_IMAGE_TITLE = "E2E Broken Image Artwork";
  const MISSING_IMAGE_TITLE = "E2E Imageless Artwork";

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await setupWalletIndexerMocks(page);

    // Registered after setupMarketplaceMocks so it takes precedence for the
    // CIDs below; anything else falls through to the default gateway mock.
    await page.route("**/ipfs/**", async (route) => {
      const url = route.request().url();

      if (url.includes(BROKEN_METADATA_CID)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...MOCK_ARTWORK_METADATA,
            title: BROKEN_IMAGE_TITLE,
            image: `ipfs://${BROKEN_IMAGE_CID}`,
          }),
        });
      }

      if (url.includes(MISSING_METADATA_CID)) {
        const { image: _image, ...withoutImage } = MOCK_ARTWORK_METADATA;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...withoutImage, title: MISSING_IMAGE_TITLE }),
        });
      }

      // The image asset itself is unreachable — triggers the <Image> onError path.
      if (url.includes(BROKEN_IMAGE_CID)) {
        return route.abort("failed");
      }

      return route.fallback();
    });

    await resetE2eListingsInBrowser(page);
  });

  test("profile page handles missing or broken NFT images gracefully using fallbacks", async ({
    page,
  }) => {
    const createdAt = Math.floor(Date.now() / 1000);
    const baseListing = {
      artist: BUYER_PUBLIC_KEY,
      price: String(12 * 10_000_000),
      currency: "XLM",
      token: DEFAULT_TOKEN,
      status: "Active",
      owner: TEST_PUBLIC_KEY,
      created_at: createdAt,
      original_creator: BUYER_PUBLIC_KEY,
      royalty_bps: 500,
      recipients: [{ address: BUYER_PUBLIC_KEY, percentage: 100 }],
    };

    store.upsertActive({
      ...baseListing,
      listing_id: 4901,
      metadata_cid: BROKEN_METADATA_CID,
    });
    store.upsertActive({
      ...baseListing,
      listing_id: 4902,
      metadata_cid: MISSING_METADATA_CID,
    });

    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await page.goto("/profile");

    // "My Collections" is the default tab and holds artwork owned but not created
    // by the connected wallet.
    await expect(page.getByRole("heading", { name: /african patron/i })).toBeVisible({
      timeout: 15_000,
    });

    // Both cards degrade to the placeholder instead of rendering a dead image.
    await expect(page.getByTestId("artwork-missing")).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(page.getByText("No Artwork").first()).toBeVisible();
    await expect(page.getByTestId("artwork-loading")).toHaveCount(0);

    // The rest of the card content still renders, so the page stays usable.
    await expect(page.getByText(BROKEN_IMAGE_TITLE)).toBeVisible();
    await expect(page.getByText(MISSING_IMAGE_TITLE)).toBeVisible();
    await expect(page.getByText("12 XLM").first()).toBeVisible();

    // No broken <img> is left behind for either card.
    await expect(
      page.locator(`img[alt="${BROKEN_IMAGE_TITLE}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`img[alt="${MISSING_IMAGE_TITLE}"]`),
    ).toHaveCount(0);
  });
});
