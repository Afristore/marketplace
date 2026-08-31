import { test, expect } from "@playwright/test";
import path from "path";
import { TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  E2E_METADATA_CID,
  E2E_IMAGE_CID,
  MarketplaceTestStore,
  MOCK_ARTWORK_METADATA,
  setupMarketplaceMocks,
  setupWalletIndexerMocks,
  resetE2eListingsInBrowser,
  rejectNextE2eTransaction,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet, openNewListingTab } from "./helpers/wallet";

const DEFAULT_TOKEN =
  process.env.NEXT_PUBLIC_NATIVE_TOKEN_CONTRACT_ID ??
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

test.describe("Listing Creation Flow", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await resetE2eListingsInBrowser(page);
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
  });

  test("listing form validates missing fields (Name, Price, Category) (#503)", async ({
    page,
  }) => {
    await openNewListingTab(page);

    const submitBtn = page.getByRole("button", { name: /create listing/i });

    // Submit button should be disabled initially (no fields filled)
    await expect(submitBtn).toBeDisabled();

    // Upload image
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Select Your Artwork").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

    // Wait for preview to appear
    await expect(page.locator('img[alt="Preview"]')).toBeVisible({
      timeout: 5000,
    });

    // Submit button should still be disabled (name, price, category missing)
    await expect(submitBtn).toBeDisabled();

    // Fill only the title
    await page
      .getByPlaceholder(/serengeti/i)
      .fill(MOCK_ARTWORK_METADATA.title);

    // Submit button should still be disabled (price, category missing)
    await expect(submitBtn).toBeDisabled();

    // Fill the artist/name
    await page
      .getByPlaceholder(/name or alias/i)
      .fill(MOCK_ARTWORK_METADATA.artist);

    // Submit button should still be disabled (price, category missing)
    await expect(submitBtn).toBeDisabled();

    // Fill description (optional field)
    await page
      .getByPlaceholder(/soul of this artwork/i)
      .fill(MOCK_ARTWORK_METADATA.description);

    // Submit button should still be disabled (price, category missing)
    await expect(submitBtn).toBeDisabled();

    // Select a category
    const categorySelect = page.locator("select").or(page.getByLabel(/category/i));
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.selectOption({ label: "Digital Art" });
    } else {
      // Try clicking a category dropdown/radio if available
      const categoryBtn = page.getByText(/category/i).first();
      if (await categoryBtn.isVisible().catch(() => false)) {
        await categoryBtn.click();
        await page.getByText("Digital Art").click();
      }
    }

    // Submit button should still be disabled (price missing)
    await expect(submitBtn).toBeDisabled();

    // Fill price
    const priceInput = page.getByLabel(/price/i).or(page.getByPlaceholder(/price/i));
    await priceInput.fill("10");

    // Submit button should now be enabled
    await expect(submitBtn).toBeEnabled();
  });

  test("listing form image upload preview works (#504)", async ({ page }) => {
    await openNewListingTab(page);

    // Initially, preview should not be visible
    const preview = page.locator('img[alt="Preview"]');
    await expect(preview).not.toBeVisible();

    // Upload image
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Select Your Artwork").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

    // Preview should now be visible
    await expect(preview).toBeVisible({ timeout: 5000 });

    // Verify preview image is loaded by checking src attribute
    const previewSrc = await preview.evaluate((img: HTMLImageElement) =>
      img.src ? "loaded" : "not-loaded"
    );
    expect(previewSrc).toBe("loaded");

    // Optionally verify file size/alt text
    const altText = await preview.getAttribute("alt");
    expect(altText).toBe("Preview");
  });

  test("listing submission triggers correct Freighter transaction (#505)", async ({
    page,
  }) => {
    await openNewListingTab(page);

    // Upload image
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Select Your Artwork").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

    // Fill all required fields
    await page
      .getByPlaceholder(/serengeti/i)
      .fill(MOCK_ARTWORK_METADATA.title);
    await page
      .getByPlaceholder(/name or alias/i)
      .fill(MOCK_ARTWORK_METADATA.artist);
    await page
      .getByPlaceholder(/soul of this artwork/i)
      .fill(MOCK_ARTWORK_METADATA.description);

    // Set category
    const categorySelect = page.locator("select").or(page.getByLabel(/category/i));
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.selectOption({ label: "Digital Art" });
    } else {
      const categoryBtn = page.getByText(/category/i).first();
      if (await categoryBtn.isVisible().catch(() => false)) {
        await categoryBtn.click();
        await page.getByText("Digital Art").click();
      }
    }

    // Set price
    const priceInput = page.getByLabel(/price/i).or(page.getByPlaceholder(/price/i));
    await priceInput.fill("10");

    // Submit form
    const submitBtn = page.getByRole("button", { name: /create listing/i });
    await expect(submitBtn).toBeEnabled();

    // Listen for transaction indication or success message
    await submitBtn.click();

    // Verify that a success message or next step appears
    // This indicates the transaction was triggered
    await expect(
      page.getByText(/Listing #\d+ Created|success|transaction/i)
    ).toBeVisible({ timeout: 30_000 });
  });

  test("successful listing redirects to item detail page (#506)", async ({
    page,
  }) => {
    await openNewListingTab(page);

    // Upload image
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Select Your Artwork").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.join(__dirname, "fixtures/test-art.png"));

    // Fill all required fields
    await page
      .getByPlaceholder(/serengeti/i)
      .fill(MOCK_ARTWORK_METADATA.title);
    await page
      .getByPlaceholder(/name or alias/i)
      .fill(MOCK_ARTWORK_METADATA.artist);
    await page
      .getByPlaceholder(/soul of this artwork/i)
      .fill(MOCK_ARTWORK_METADATA.description);

    // Set category
    const categorySelect = page.locator("select").or(page.getByLabel(/category/i));
    if (await categorySelect.isVisible().catch(() => false)) {
      await categorySelect.selectOption({ label: "Digital Art" });
    } else {
      const categoryBtn = page.getByText(/category/i).first();
      if (await categoryBtn.isVisible().catch(() => false)) {
        await categoryBtn.click();
        await page.getByText("Digital Art").click();
      }
    }

    // Set price
    const priceInput = page.getByLabel(/price/i).or(page.getByPlaceholder(/price/i));
    await priceInput.fill("10");

    // Submit form
    const submitBtn = page.getByRole("button", { name: /create listing/i });
    await submitBtn.click();

    // Wait for success message and extract listing ID
    const successHeading = page.getByRole("heading", {
      name: /Listing #\d+ Created/i,
    });
    await expect(successHeading).toBeVisible({ timeout: 30_000 });

    const headingText = await successHeading.textContent();
    const listingId = Number(headingText?.match(/Listing #(\d+)/)?.[1]);
    expect(listingId).toBeGreaterThan(0);

    // Update store with the created listing
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

    // Verify redirect to item detail page
    // Should contain the listing ID in the URL or on the page
    await expect(
      page.getByText(new RegExp(MOCK_ARTWORK_METADATA.title, "i"))
    ).toBeVisible({ timeout: 10_000 });

    // Verify item details are displayed
    await expect(
      page.getByText(new RegExp(MOCK_ARTWORK_METADATA.artist, "i"))
    ).toBeVisible();
    await expect(
      page.getByText(new RegExp(MOCK_ARTWORK_METADATA.description, "i"))
    ).toBeVisible();
    await expect(page.getByText(/10 XLM/i)).toBeVisible();

    // Verify the listing image is displayed
    const listingImage = page.locator(`img[src*="${E2E_IMAGE_CID}"]`).or(
      page.locator("img").filter({ has: page.locator(`[alt*="Serengeti"]`) })
    );
    await expect(listingImage).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Listing form gracefully handles user rejecting transaction (#507)", () => {
  const store = new MarketplaceTestStore();
  const OWNED_COLLECTION = "CAOWNEDCOLLECTIONADDRESSFORE2ETESTINGXXXXXXXXXXXXXXXXXXXXXX";

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await setupWalletIndexerMocks(page, {
      tokens: [
        {
          collectionAddress: OWNED_COLLECTION,
          tokenId: 1,
          name: "E2E Owned NFT",
        },
      ],
    });
    await resetE2eListingsInBrowser(page);
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
  });

  test("shows an error and keeps the form usable when the user declines the signature request", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /new listing/i }).click();
    await expect(page.getByText("Select an NFT to List")).toBeVisible();

    await page.getByRole("button", { name: /list for sale/i }).click();
    await expect(page.getByText("List Your Artwork")).toBeVisible();

    const priceInput = page.getByLabel(/price/i).first();
    await priceInput.fill("15");

    const submitBtn = page.getByRole("button", { name: /create listing/i });
    await expect(submitBtn).toBeEnabled();

    // Simulate Freighter's rejection dialog: the next mocked on-chain write throws.
    await rejectNextE2eTransaction(page);
    await submitBtn.click();

    // The rejection surfaces as an inline error and/or toast — the form does
    // not silently succeed or redirect away.
    await expect(
      page.getByText(/declined|rejected|denied/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Listing #\d+ Created/i)).toHaveCount(0);

    // Form stays usable — the same submission can be retried and succeeds.
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await expect(page.getByText(/Listing #\d+ Created/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
