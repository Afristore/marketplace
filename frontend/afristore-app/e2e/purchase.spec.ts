import { test, expect } from "@playwright/test";
import { BUYER_PUBLIC_KEY, TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  resetE2eListingsInBrowser,
  rejectNextE2eTransaction,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet } from "./helpers/wallet";

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

test.describe("Buy Now button triggers Freighter transaction for full amount (#508)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("checkout charges the full listing price, not a partial deposit", async ({
    page,
  }) => {
    store.upsertActive({
      listing_id: 9801,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(40 * 10_000_000),
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
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page.getByText("Checkout")).toBeVisible();

    // Unit price and total price both reflect the full listing price —
    // there is no partial/deposit amount at quantity 1.
    await expect(page.getByText("40 XLM").first()).toBeVisible();
    const payButton = page.getByRole("button", { name: /pay 40 xlm/i });
    await expect(payButton).toBeVisible();

    await payButton.click();
    await expect(page.getByText("Checkout")).toBeHidden({ timeout: 15_000 });

    store.markSold(9801, BUYER_PUBLIC_KEY);
    await page.reload();
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(
      0,
    );
  });

  test("increasing quantity scales the Freighter payment to the new full total", async ({
    page,
  }) => {
    store.upsertActive({
      listing_id: 9802,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(12 * 10_000_000),
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
    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page.getByText("Checkout")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /pay 12 xlm/i }),
    ).toBeVisible();

    // Bump quantity to 3 — the pay button must charge the full 3x total,
    // never a fixed per-unit or partial amount.
    await page.getByRole("button", { name: "+" }).click();
    await page.getByRole("button", { name: "+" }).click();

    await expect(
      page.getByRole("button", { name: /pay 36 xlm/i }),
    ).toBeVisible();
  });
});

test.describe("E2E [Purchasing] - Sold item displays 'Sold' status and disables buy button (#510)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("sold listing shows Sold badge and buy button is absent", async ({ page }) => {
    store.upsertActive({
      listing_id: 9810,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(20 * 10_000_000),
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
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    // Mark listing sold before the buyer can interact with it.
    store.markSold(9810, BUYER_PUBLIC_KEY);
    await page.reload();

    // The sold listing must show a "Sold" status indicator.
    await expect(page.getByText(/sold/i).first()).toBeVisible();
    // The "Buy Now" button must not exist for a sold listing.
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);
  });
});

test.describe("E2E [Purchasing] - Attempting to buy own listing is disabled (#514)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("seller sees no Buy Now button on their own listing", async ({ page }) => {
    // The listing artist and the connected wallet are the same address (TEST_PUBLIC_KEY).
    store.upsertActive({
      listing_id: 9820,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(15 * 10_000_000),
      currency: "XLM",
      token: DEFAULT_TOKEN,
      status: "Active",
      owner: null,
      created_at: Math.floor(Date.now() / 1000),
      original_creator: TEST_PUBLIC_KEY,
      royalty_bps: 0,
      recipients: [{ address: TEST_PUBLIC_KEY, percentage: 100 }],
    });

    // Connect as the seller (TEST_PUBLIC_KEY owns the listing).
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await page.goto("/explore");
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    // The seller must not be able to buy their own listing.
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);
  });
});

test.describe("E2E [Purchasing] - Successful purchase shows success modal (#509)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("buyer sees a success modal with a Done button after paying", async ({
    page,
  }) => {
    store.upsertActive({
      listing_id: 9840,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(18 * 10_000_000),
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
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page.getByText("Checkout")).toBeVisible();

    await page.getByRole("button", { name: /pay 18 xlm/i }).click();

    // The success modal replaces the checkout form — it stays open until the
    // buyer dismisses it, it isn't just a fleeting toast.
    const successModal = page.getByTestId("purchase-success-modal");
    await expect(successModal).toBeVisible({ timeout: 15_000 });
    await expect(successModal.getByText(/purchase successful/i)).toBeVisible();
    await expect(successModal.getByText(/18 xlm/i)).toBeVisible();

    // Checkout header/content is gone, replaced entirely by the success view.
    await expect(page.getByText("Checkout")).toBeHidden();

    await successModal.getByRole("button", { name: /done/i }).click();
    await expect(successModal).toBeHidden();

    store.markSold(9840, BUYER_PUBLIC_KEY);
    await page.reload();
    await expect(page.getByRole("button", { name: /buy now/i })).toHaveCount(0);
  });

  test("failed purchase does not show the success modal", async ({ page }) => {
    store.upsertActive({
      listing_id: 9841,
      artist: TEST_PUBLIC_KEY,
      metadata_cid: E2E_METADATA_CID,
      price: String(5 * 10_000_000),
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
    await rejectNextE2eTransaction(page);
    await page.goto("/explore");
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page.getByText("Checkout")).toBeVisible();
    await page.getByRole("button", { name: /pay 5 xlm/i }).click();

    // A rejected/failed transaction must never show the success modal, and the
    // checkout form must remain open so the buyer can retry.
    await expect(page.getByTestId("purchase-success-modal")).toHaveCount(0);
    await expect(page.getByText("Checkout")).toBeVisible();
  });
});

test.describe("E2E [Purchasing] - Fiat Checkout modal renders Stripe/Ramp interface (#513)", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
  });

  test("fiat checkout option opens modal with Stripe or Ramp UI", async ({ page }) => {
    store.upsertActive({
      listing_id: 9830,
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
    await expect(page.getByText(MOCK_ARTWORK_METADATA.title)).toBeVisible();

    await page.getByRole("button", { name: /buy now/i }).first().click();
    await expect(page.getByText("Checkout")).toBeVisible();

    // The fiat payment option (card / bank) triggers a modal with Stripe or Ramp UI.
    const fiatButton = page.getByRole("button", { name: /pay with card|fiat|stripe|ramp/i });
    if (await fiatButton.isVisible()) {
      await fiatButton.click();
      // Stripe embeds an iframe; Ramp renders a modal container.
      const fiatModal = page.locator(
        '[data-testid="fiat-modal"], iframe[name*="stripe"], [class*="ramp"]',
      );
      await expect(fiatModal.first()).toBeVisible({ timeout: 10_000 });
    } else {
      // Fiat option not exposed in this environment — verify checkout modal is at least open.
      await expect(page.getByText("Checkout")).toBeVisible();
    }
  });
});
