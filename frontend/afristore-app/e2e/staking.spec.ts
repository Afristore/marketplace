import { test, expect } from "@playwright/test";
import { mockFreighter, TEST_PUBLIC_KEY } from "./freighter-mock";

test.describe("Staking Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighter(page);
  });

  test("staking page lists un-staked NFTs eligible for staking", async ({ page }) => {
    const TEST_COLLECTION_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const MOCK_POOL_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSCX";

    // Mock owned NFTs from the indexer
    const mockOwnedNFTs = [
      {
        collectionAddress: TEST_COLLECTION_ADDRESS,
        tokenId: 1,
        name: "Serengeti Lion #1",
        image: "ipfs://QmTestImage1",
      },
      {
        collectionAddress: TEST_COLLECTION_ADDRESS,
        tokenId: 2,
        name: "Kilimanjaro Sunset #2",
        image: "ipfs://QmTestImage2",
      },
      {
        collectionAddress: TEST_COLLECTION_ADDRESS,
        tokenId: 3,
        name: "Victoria Falls #3",
        image: "ipfs://QmTestImage3",
      },
    ];

    // Mock staked NFTs (empty - none staked yet)
    const mockStakedNFTs: object[] = [];

    // Mock staking pool config
    const mockPoolConfig = {
      rewardToken: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      rewardRate: "10000000", // 1 token per second
      minStakeDuration: 0,
      maxStakeDuration: 0,
    };

    // Setup route handlers
    await page.route("**/wallets/**/nfts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockOwnedNFTs),
      });
    });

    await page.route("**/wallets/**/staked**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockStakedNFTs),
      });
    });

    // Mock the launchpad API for staking pool lookup
    await page.route("**/launchpad/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("staking-pool")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ poolAddress: MOCK_POOL_ADDRESS }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock Soroban contract calls for staking pool config
    await page.route("**/staking/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockPoolConfig),
      });
    });

    // Navigate to staking page
    await page.goto("/staking");

    // Wait for page to load and wallet to connect
    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    // Verify staking page header is visible
    await expect(page.getByRole("heading", { name: /nft staking/i })).toBeVisible();

    // Enter collection address in the input field
    const collectionInput = page.getByPlaceholder(/paste nft contract address/i);
    await collectionInput.fill(TEST_COLLECTION_ADDRESS);

    // Click load pool button
    const loadPoolButton = page.getByRole("button", { name: /load pool/i });
    await loadPoolButton.click();

    // Wait for pool to load
    await expect(page.getByText(/reward token/i)).toBeVisible({ timeout: 10_000 });

    // Verify "Unstaked NFTs" tab is active by default or click it
    const unstakedTab = page.getByRole("button", { name: /unstaked nfts/i });
    await unstakedTab.click();

    // Verify unstaked NFTs are displayed
    // Check for the NFT names or token IDs
    await expect(page.getByText(/serengeti lion/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/kilimanjaro sunset/i)).toBeVisible();
    await expect(page.getByText(/victoria falls/i)).toBeVisible();

    // Verify NFT cards are selectable (eligible for staking)
    const nftCards = page.locator("[data-testid^='nft-card'], button[class*='rounded-2xl']").filter({
      hasText: /nft|serengeti|kilimanjaro|victoria/i,
    });

    // Count should match our mock data (3 NFTs)
    await expect(nftCards).toHaveCount(3, { timeout: 5_000 });

    // Verify each NFT card can be selected for staking
    const firstNftCard = nftCards.first();
    await firstNftCard.click();

    // Verify selection indicator appears
    await expect(page.getByText(/selected/i)).toBeVisible();

    // Verify "Stake Selected" button becomes available
    const stakeSelectedButton = page.getByRole("button", { name: /stake selected/i });
    await expect(stakeSelectedButton).toBeEnabled();

    // Verify stats show correct counts
    await expect(page.getByText("3")).toBeVisible(); // You Own count
    await expect(page.getByText("You Own")).toBeVisible();
    await expect(page.getByText("0")).toBeVisible(); // Your Staked count
    await expect(page.getByText("Your Staked")).toBeVisible();
  });

  test("staking page shows empty state when no NFTs owned", async ({ page }) => {
    // Mock empty owned NFTs
    await page.route("**/wallets/**/nfts**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.route("**/wallets/**/staked**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    await page.goto("/staking");

    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    // Verify empty state message
    await expect(
      page.getByText(/you don't own any nfts|no unstaked nfts|select a collection/i)
    ).toBeVisible({ timeout: 5_000 });
  });

  test("staking page shows connect wallet prompt when disconnected", async ({ page }) => {
    // Clear the mocked wallet to simulate disconnected state
    await page.addInitScript(() => {
      sessionStorage.removeItem("e2e_wallet_public_key");
      sessionStorage.removeItem("e2e_network_passphrase");
    });

    await page.goto("/staking");

    // Verify connect wallet prompt
    await expect(page.getByText(/connect your wallet/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /connect wallet/i })
    ).toBeVisible();
  });

  test("staking page handles pool not found gracefully", async ({ page }) => {
    const TEST_COLLECTION_ADDRESS = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    await page.route("**/launchpad/**", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "No staking pool found" }),
      });
    });

    await page.goto("/staking");

    const shortKey = `${TEST_PUBLIC_KEY.slice(0, 4)}…${TEST_PUBLIC_KEY.slice(-4)}`;
    await expect(page.getByText(shortKey)).toBeVisible({ timeout: 10_000 });

    // Enter collection address
    const collectionInput = page.getByPlaceholder(/paste nft contract address/i);
    await collectionInput.fill(TEST_COLLECTION_ADDRESS);

    const loadPoolButton = page.getByRole("button", { name: /load pool/i });
    await loadPoolButton.click();

    // Verify error message for no pool found
    await expect(
      page.getByText(/no staking pool found|deploy one/i)
    ).toBeVisible({ timeout: 5_000 });
  });
});
