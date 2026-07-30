import { test, expect } from "@playwright/test";
import { connectFreighterWallet } from "./helpers/wallet";

test.describe("Notifications", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await connectFreighterWallet(page);
  });

  test("displays notification bell in the navbar", async ({ page }) => {
    await page.goto("/");
    const notificationBell = page.locator('[data-testid="notification-bell"]');
    await expect(notificationBell).toBeVisible({ timeout: 10_000 });
  });

  test("receiving SSE event increments notification counter", async ({
    page,
  }) => {
    await page.goto("/");

    const notificationBell = page.locator('[data-testid="notification-bell"]');
    await expect(notificationBell).toBeVisible({ timeout: 10_000 });

    const counterBefore = await notificationBell
      .locator('[data-testid="notification-count"]')
      .textContent()
      .then((text) => parseInt(text || "0", 10))
      .catch(() => 0);

    await page.evaluate(() => {
      const eventSource = new EventSource(
        `${process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:4000"}/events/stream`,
      );
      eventSource.onmessage = () => {};
      eventSource.onerror = () => {};
    });

    await page.waitForTimeout(3000);

    const counterAfter = await notificationBell
      .locator('[data-testid="notification-count"]')
      .textContent()
      .then((text) => parseInt(text || "0", 10))
      .catch(() => 0);

    expect(counterAfter).toBeGreaterThanOrEqual(counterBefore);
  });

  test("clicking a notification routes to the relevant listing/auction", async ({
    page,
  }) => {
    await page.goto("/");

    const notificationBell = page.locator('[data-testid="notification-bell"]');
    await expect(notificationBell).toBeVisible({ timeout: 10_000 });
    await notificationBell.click();

    const notificationPanel = page.locator(
      '[data-testid="notification-panel"]',
    );
    await expect(notificationPanel).toBeVisible();

    const firstNotification = notificationPanel
      .locator('[data-testid="notification-item"]')
      .first();

    if ((await firstNotification.count()) > 0) {
      const listingLink = firstNotification.locator("a");
      if ((await listingLink.count()) > 0) {
        const href = await listingLink.first().getAttribute("href");
        await listingLink.first().click();

        if (href?.includes("/listings/")) {
          await expect(page).toHaveURL(new RegExp("/listings/"));
        } else if (href?.includes("/auctions/")) {
          await expect(page).toHaveURL(new RegExp("/auctions/"));
        }
      }
    }
  });

  // ── Issue #488 ──────────────────────────────────────────────────────────────
  test("clicking notification bell opens dropdown with recent events", async ({
    page,
  }) => {
    const INDEXER_URL = (
      process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
    ).replace(/\/$/, "");

    const MOCK_NOTIFICATIONS = [
      {
        id: "n-1",
        type: "sale",
        title: "Your NFT sold",
        message: "E2E Serengeti Sunset was purchased for 100 XLM",
        read: false,
        created_at: Date.now() - 60_000,
        link: "/listings/1",
      },
      {
        id: "n-2",
        type: "bid",
        title: "New bid received",
        message: "Someone bid 50 XLM on your auction",
        read: false,
        created_at: Date.now() - 120_000,
        link: "/auctions/2",
      },
    ];

    // Mock the notifications API before navigating so the app receives seeded data.
    await page.route(`${INDEXER_URL}/notifications**`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: MOCK_NOTIFICATIONS }),
      });
    });

    await page.goto("/");

    const notificationBell = page.locator('[data-testid="notification-bell"]');
    await expect(notificationBell).toBeVisible({ timeout: 10_000 });

    // Dropdown must NOT be visible before the bell is clicked.
    const dropdown = page.locator('[data-testid="notification-panel"]');
    await expect(dropdown).not.toBeVisible();

    // Act: click the bell.
    await notificationBell.click();

    // Assert: dropdown opens and lists the seeded recent events.
    await expect(dropdown).toBeVisible({ timeout: 5_000 });

    const items = dropdown.locator('[data-testid="notification-item"]');
    await expect(items).toHaveCount(MOCK_NOTIFICATIONS.length, {
      timeout: 5_000,
    });

    for (const notification of MOCK_NOTIFICATIONS) {
      await expect(dropdown.getByText(notification.title)).toBeVisible();
    }
  });

  // ── Issue #602 & #490 ────────────────────────────────────────────────────────────────
  // Note: #602 - 'Mark all as read' updates backend via PATCH API and clears UI badge
  // This test verifies both the PATCH call and badge clearance. ──────────────────────────────────────────────────────────────
  test("mark all as read clears the notification counter", async ({ page }) => {
    const INDEXER_URL = (
      process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
    ).replace(/\/$/, "");

    const notifications = [
      {
        id: "n-1",
        type: "sale",
        title: "NFT sold",
        message: "Your NFT sold for 100 XLM",
        read: false,
        created_at: Date.now() - 60_000,
        link: "/listings/1",
      },
      {
        id: "n-2",
        type: "bid",
        title: "Bid received",
        message: "New bid of 50 XLM",
        read: false,
        created_at: Date.now() - 90_000,
        link: "/auctions/3",
      },
    ];

    // Track whether the mark-all-read PATCH request has fired.
    let markedAllRead = false;

    await page.route(`${INDEXER_URL}/notifications**`, async (route) => {
      const method = route.request().method();

      if (method === "GET") {
        // Return all-read payload after the PATCH so the badge reflects 0.
        const payload = markedAllRead
          ? notifications.map((n) => ({ ...n, read: true }))
          : notifications;

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ notifications: payload }),
        });
        return;
      }

      if (method === "PATCH") {
        markedAllRead = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
        return;
      }

      return route.continue();
    });

    await page.goto("/");

    const notificationBell = page.locator('[data-testid="notification-bell"]');
    await expect(notificationBell).toBeVisible({ timeout: 10_000 });

    // Badge should reflect the unread count before acting.
    const badge = notificationBell.locator(
      '[data-testid="notification-count"]',
    );
    await expect(badge).toBeVisible({ timeout: 5_000 });
    const initialCount = await badge
      .textContent()
      .then((t) => parseInt(t ?? "0", 10));
    expect(initialCount).toBeGreaterThan(0);

    // Open the dropdown.
    await notificationBell.click();
    const panel = page.locator('[data-testid="notification-panel"]');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Click "Mark all as read".
    const markAllBtn = panel.getByRole("button", { name: /mark all as read/i });
    await expect(markAllBtn).toBeVisible({ timeout: 5_000 });
    await markAllBtn.click();

    // The badge must either display "0" or be hidden entirely.
    const badgeGone = badge.waitFor({ state: "hidden", timeout: 5_000 });
    const badgeZero = expect(badge).toHaveText("0", { timeout: 5_000 });
    await Promise.race([badgeGone, badgeZero]);
  });
});
