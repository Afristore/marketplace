import { test, expect, Page } from "@playwright/test";
import { TEST_PUBLIC_KEY, BUYER_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_IMAGE_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
  E2eIndexerListing,
} from "./helpers/marketplace-mocks";

const INDEXER_URL = (
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Explore page paginates at 12 items per page (see PAGE_SIZE in app/explore/page.tsx).
const PAGE_SIZE = 12;

const CID_BAOBAB = "QmE2eBaobabTwilightCid";
const CID_LAGOS = "QmE2eLagosSkylineCid";
const CID_NAIROBI = "QmE2eNairobiStreetsCid";
const CID_KENTE = "QmE2eKenteWeaveCid";
const CID_ADINKRA = "QmE2eAdinkraCarvingCid";

const EXTRA_METADATA: Record<string, typeof MOCK_ARTWORK_METADATA> = {
  [CID_BAOBAB]: {
    ...MOCK_ARTWORK_METADATA,
    title: "Baobab Twilight",
    category: "Sculpture",
  },
  [CID_LAGOS]: {
    ...MOCK_ARTWORK_METADATA,
    title: "Lagos Skyline",
    category: "Painting",
  },
  [CID_NAIROBI]: {
    ...MOCK_ARTWORK_METADATA,
    title: "Nairobi Streets",
    category: "Photography",
  },
  [CID_KENTE]: {
    ...MOCK_ARTWORK_METADATA,
    title: "Kente Weave",
    category: "Sculpture",
  },
  [CID_ADINKRA]: {
    ...MOCK_ARTWORK_METADATA,
    title: "Adinkra Carving",
    category: "Sculpture",
  },
};

/** Serves distinct per-CID metadata for listings created with the CIDs above. */
async function mockExtraArtworkMetadata(page: Page) {
  await page.route("**/gateway.pinata.cloud/ipfs/**", async (route) => {
    const cid = route.request().url().split("/ipfs/").pop() ?? "";
    const meta = EXTRA_METADATA[cid];
    if (!meta) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(meta),
    });
  });
  await page.route("**/ipfs.io/ipfs/**", async (route) => {
    const cid = route.request().url().split("/ipfs/").pop() ?? "";
    const meta = EXTRA_METADATA[cid];
    if (!meta) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(meta),
    });
  });
}

/** CID → art category map mirroring the indexer's denormalized `category` column. */
const categoryByCid = Object.fromEntries(
  Object.entries(EXTRA_METADATA).map(([cid, meta]) => [cid, meta.category]),
);

function makeListing(
  overrides: Partial<E2eIndexerListing> & { listing_id: number },
): E2eIndexerListing {
  return {
    artist: TEST_PUBLIC_KEY,
    metadata_cid: CID_LAGOS,
    price: String(10 * 10_000_000),
    currency: "XLM",
    token: DEFAULT_TOKEN,
    status: "Active",
    owner: null,
    created_at: Math.floor(Date.now() / 1000),
    original_creator: TEST_PUBLIC_KEY,
    royalty_bps: 0,
    recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
    ...overrides,
  };
}

function waitForListingsRequest(page: Page) {
  return page.waitForRequest(
    (req) => req.method() === "GET" && req.url().includes(`${INDEXER_URL}/listings`),
  );
}

test.describe("Explore page loads first page of listings (#491)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await resetE2eListingsInBrowser(page);
  });

  test("explore page loads first page of listings", async ({ page }) => {
    for (let i = 0; i < 14; i++) {
      store.upsertActive(
        makeListing({
          listing_id: 9200 + i,
          metadata_cid: `${CID_LAGOS}-${i}`,
          created_at: Math.floor(Date.now() / 1000) + i,
        }),
      );
    }

    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Explore Artworks")).toBeVisible();
    await expect(
      page.getByText(/Showing\s+1\s*-\s*12\s+of\s+14\s+artworks/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      PAGE_SIZE,
    );

    // Pagination controls reflect two total pages.
    await expect(
      page.getByRole("button", { name: "2", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(
      page.getByText(/Showing\s+13\s*-\s*14\s+of\s+14\s+artworks/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      2,
    );
    await expect(page.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });
});

test.describe("Explore page sorts by Price (#494)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    const now = Math.floor(Date.now() / 1000);
    // created_at order (oldest → newest) intentionally differs from price
    // order so switching sort mode visibly reorders the grid.
    store.upsertActive(
      makeListing({
        listing_id: 9301,
        metadata_cid: CID_BAOBAB,
        price: String(5 * 10_000_000),
        created_at: now,
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9302,
        metadata_cid: CID_LAGOS,
        price: String(25 * 10_000_000),
        created_at: now + 1,
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9303,
        metadata_cid: CID_NAIROBI,
        price: String(15 * 10_000_000),
        created_at: now + 2,
      }),
    );
  });

  test("sorts listings ascending and descending by price", async ({
    page,
  }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Nairobi Streets")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("h3")).toHaveText([
      "Nairobi Streets",
      "Lagos Skyline",
      "Baobab Twilight",
    ]);

    await page.getByRole("combobox").first().selectOption("price_asc");
    await expect(page.locator("h3")).toHaveText([
      "Baobab Twilight",
      "Nairobi Streets",
      "Lagos Skyline",
    ]);

    await page.getByRole("combobox").first().selectOption("price_desc");
    await expect(page.locator("h3")).toHaveText([
      "Lagos Skyline",
      "Nairobi Streets",
      "Baobab Twilight",
    ]);
  });
});

test.describe("Explore page filters by category/kind (#495)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    store.upsertActive(
      makeListing({ listing_id: 9401, metadata_cid: CID_BAOBAB }),
    );
    store.upsertActive(
      makeListing({ listing_id: 9402, metadata_cid: CID_LAGOS }),
    );
    store.upsertActive(
      makeListing({ listing_id: 9403, metadata_cid: CID_NAIROBI }),
    );
  });

  test("filters the grid down to the selected category", async ({
    page,
  }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Baobab Twilight")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Lagos Skyline")).toBeVisible();
    await expect(page.getByText("Nairobi Streets")).toBeVisible();

    await page.getByRole("button", { name: /advanced filters/i }).click();
    await page.getByRole("combobox").nth(1).selectOption("Sculpture");

    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(page.getByText("Lagos Skyline")).toHaveCount(0);
    await expect(page.getByText("Nairobi Streets")).toHaveCount(0);
    await expect(
      page.getByText(/Found\s+1\s+results\s+matching\s+your\s+criteria/i),
    ).toBeVisible();

    await page.getByRole("combobox").nth(1).selectOption("All");

    await expect(page.getByText("Lagos Skyline")).toBeVisible();
    await expect(page.getByText("Nairobi Streets")).toBeVisible();
  });
});

test.describe('Explore page "Load More" appends next page of results (#492)', () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await resetE2eListingsInBrowser(page);
  });

  test("clicking next reveals the next page of listings without losing the first page's data", async ({
    page,
  }) => {
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      store.upsertActive(
        makeListing({
          listing_id: 9600 + i,
          metadata_cid: `${CID_LAGOS}-${i}`,
          created_at: Math.floor(Date.now() / 1000) + i,
        }),
      );
    }

    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(
      page.getByText(/Showing\s+1\s*-\s*12\s+of\s+17\s+artworks/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      PAGE_SIZE,
    );

    await page.getByRole("button", { name: /^next$/i }).click();

    await expect(
      page.getByText(/Showing\s+13\s*-\s*17\s+of\s+17\s+artworks/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      5,
    );

    // Total count stays the same across pages — the second page is the
    // next slice of the same result set, not a fresh/duplicated fetch.
    await expect(page.getByText(/of\s+17\s+artworks/i)).toBeVisible();
  });
});

test.describe("Search bar returns relevant collection/NFT results (#496)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    store.upsertActive(
      makeListing({
        listing_id: 9501,
        artist: TEST_PUBLIC_KEY,
        metadata_cid: CID_LAGOS,
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9502,
        artist: BUYER_PUBLIC_KEY,
        metadata_cid: CID_BAOBAB,
      }),
    );
  });

  test("search bar returns only listings matching the query", async ({
    page,
  }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Lagos Skyline")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Baobab Twilight")).toBeVisible();

    const query = TEST_PUBLIC_KEY.slice(0, 10);
    const searchRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes(`search=${encodeURIComponent(query)}`),
    );
    await page
      .getByPlaceholder(/search by title, artist, or description/i)
      .fill(query);
    await searchRequest;

    await expect(page.getByText("Lagos Skyline")).toBeVisible();
    await expect(page.getByText("Baobab Twilight")).toHaveCount(0);

    const noMatchRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes("search=no-such-artist"),
    );
    await page
      .getByPlaceholder(/search by title, artist, or description/i)
      .fill("no-such-artist");
    await noMatchRequest;

    await expect(page.getByText("No artworks found")).toBeVisible();
    await expect(
      page.getByText(/adjusting your search or filters/i),
    ).toBeVisible();
  });
});

test.describe("Explore page sorts by Newest correctly (#493)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    const now = Math.floor(Date.now() / 1000);
    // Listing order intentionally differs from creation order so switching
    // to "Newest First" visibly reorders the grid.
    store.upsertActive(
      makeListing({
        listing_id: 9701,
        metadata_cid: CID_LAGOS,
        created_at: now,
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9702,
        metadata_cid: CID_NAIROBI,
        created_at: now + 2,
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9703,
        metadata_cid: CID_BAOBAB,
        created_at: now + 1,
      }),
    );
  });

  test("sorts listings by newest and oldest first", async ({ page }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    // "Newest First" is the default sort — most recently created listing leads.
    await expect(page.getByText("Nairobi Streets")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("h3")).toHaveText([
      "Nairobi Streets",
      "Baobab Twilight",
      "Lagos Skyline",
    ]);

    await page.getByRole("combobox").first().selectOption("oldest");
    await expect(page.locator("h3")).toHaveText([
      "Lagos Skyline",
      "Baobab Twilight",
      "Nairobi Streets",
    ]);

    await page.getByRole("combobox").first().selectOption("newest");
    await expect(page.locator("h3")).toHaveText([
      "Nairobi Streets",
      "Baobab Twilight",
      "Lagos Skyline",
    ]);
  });
});

test.describe("Explore page applies category, price range, and status filters together (#584)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    // Sculpture, active, mid-priced — should survive every filter combination.
    store.upsertActive(
      makeListing({
        listing_id: 9801,
        metadata_cid: CID_BAOBAB,
        price: String(10 * 10_000_000),
        status: "Active",
      }),
    );
    // Wrong category — excluded once "Sculpture" is selected.
    store.upsertActive(
      makeListing({
        listing_id: 9802,
        metadata_cid: CID_LAGOS,
        price: String(10 * 10_000_000),
        status: "Active",
      }),
    );
    // Right category, too expensive — excluded once the price range is applied.
    store.upsertActive(
      makeListing({
        listing_id: 9803,
        metadata_cid: CID_KENTE,
        price: String(50 * 10_000_000),
        status: "Active",
      }),
    );
    // Right category and price, wrong status — excluded once "Active" is selected.
    store.upsertActive(
      makeListing({
        listing_id: 9804,
        metadata_cid: CID_ADINKRA,
        price: String(10 * 10_000_000),
        status: "Sold",
      }),
    );
  });

  test("narrows the grid to listings matching category, price range, and status simultaneously", async ({
    page,
  }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Baobab Twilight")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Lagos Skyline")).toBeVisible();
    await expect(page.getByText("Kente Weave")).toBeVisible();
    await expect(page.getByText("Adinkra Carving")).toBeVisible();

    await page.getByRole("button", { name: /advanced filters/i }).click();

    // Category filter
    await page.getByRole("combobox").nth(1).selectOption("Sculpture");
    await expect(page.getByText("Lagos Skyline")).toHaveCount(0);
    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(page.getByText("Kente Weave")).toBeVisible();
    await expect(page.getByText("Adinkra Carving")).toBeVisible();

    // Price range filter (stacks on top of category)
    const minPriceRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes(`minPrice=${5 * 10_000_000}`),
    );
    await page.getByPlaceholder("Min").fill(String(5 * 10_000_000));
    await minPriceRequest;

    const maxPriceRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes(`maxPrice=${15 * 10_000_000}`),
    );
    await page.getByPlaceholder("Max").fill(String(15 * 10_000_000));
    await maxPriceRequest;

    await expect(page.getByText("Kente Weave")).toHaveCount(0);
    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(page.getByText("Adinkra Carving")).toBeVisible();

    // Status filter (stacks on top of category + price range)
    const statusRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes("status=Active"),
    );
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await statusRequest;

    await expect(page.getByText("Adinkra Carving")).toHaveCount(0);
    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(
      page.getByText(/Found\s+1\s+results\s+matching\s+your\s+criteria/i),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      1,
    );
  });
});

test.describe("Clearing all filters on the Explore page resets the view to default (#585)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store, { categoryByCid });
    await mockExtraArtworkMetadata(page);
    await resetE2eListingsInBrowser(page);

    store.upsertActive(
      makeListing({
        listing_id: 9901,
        artist: TEST_PUBLIC_KEY,
        metadata_cid: CID_BAOBAB,
        price: String(10 * 10_000_000),
        status: "Active",
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9902,
        artist: BUYER_PUBLIC_KEY,
        metadata_cid: CID_LAGOS,
        price: String(50 * 10_000_000),
        status: "Active",
      }),
    );
    store.upsertActive(
      makeListing({
        listing_id: 9903,
        artist: BUYER_PUBLIC_KEY,
        metadata_cid: CID_NAIROBI,
        price: String(10 * 10_000_000),
        status: "Sold",
      }),
    );
  });

  test("resets search, category, price range, and status back to defaults", async ({
    page,
  }) => {
    const listingsRequest = waitForListingsRequest(page);
    await page.goto("/explore");
    await listingsRequest;

    await expect(page.getByText("Baobab Twilight")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(/Showing\s+1\s*-\s*3\s+of\s+3\s+artworks/i),
    ).toBeVisible();

    // Apply a mix of filters that narrows the grid down to a single result.
    const query = TEST_PUBLIC_KEY.slice(0, 10);
    const searchRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes(`search=${encodeURIComponent(query)}`),
    );
    await page
      .getByPlaceholder(/search by title, artist, or description/i)
      .fill(query);
    await searchRequest;

    await page.getByRole("button", { name: /advanced filters/i }).click();
    await page.getByRole("combobox").nth(1).selectOption("Sculpture");

    const statusRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes("status=Active"),
    );
    await page.getByRole("button", { name: "Active", exact: true }).click();
    await statusRequest;

    const minPriceRequest = page.waitForRequest(
      (req) =>
        req.method() === "GET" &&
        req.url().includes(`${INDEXER_URL}/listings`) &&
        req.url().includes(`minPrice=${5 * 10_000_000}`),
    );
    await page.getByPlaceholder("Min").fill(String(5 * 10_000_000));
    await minPriceRequest;

    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(page.getByText("Lagos Skyline")).toHaveCount(0);
    await expect(page.getByText("Nairobi Streets")).toHaveCount(0);
    await expect(
      page.getByText(/Showing\s+1\s*-\s*1\s+of\s+1\s+artwork/i),
    ).toBeVisible();

    // Clear all filters from the advanced filters panel.
    const resetRequest = waitForListingsRequest(page);
    await page.getByRole("button", { name: /reset all filters/i }).click();
    await resetRequest;

    // Every input/control is back to its default state.
    await expect(
      page.getByPlaceholder(/search by title, artist, or description/i),
    ).toHaveValue("");
    await expect(page.getByPlaceholder("Min")).toHaveValue("");
    await expect(page.getByRole("combobox").nth(1)).toHaveValue("All");
    await expect(
      page.getByRole("button", { name: "All", exact: true }),
    ).toHaveClass(/bg-brand-500/);
    await expect(
      page.getByRole("button", { name: /reset all filters/i }),
    ).toHaveCount(0);

    // The full, unfiltered result set is showing again.
    await expect(page.getByText("Baobab Twilight")).toBeVisible();
    await expect(page.getByText("Lagos Skyline")).toBeVisible();
    await expect(page.getByText("Nairobi Streets")).toBeVisible();
    await expect(
      page.getByText(/Showing\s+1\s*-\s*3\s+of\s+3\s+artworks/i),
    ).toBeVisible();
  });
});
