import { Page } from "@playwright/test";

export const E2E_METADATA_CID = "QmE2eTestMetadataCid";
export const E2E_IMAGE_CID = "QmE2eTestImageCid";

export const MOCK_ARTWORK_METADATA = {
  title: "E2E Serengeti Sunset",
  description: "Automated test listing",
  artist: "E2E Artist",
  image: `ipfs://${E2E_IMAGE_CID}`,
  year: "2024",
  category: "Digital Art",
};

export interface E2eIndexerListing {
  listing_id: number;
  artist: string;
  metadata_cid: string;
  price: string;
  currency: string;
  token: string;
  status: string;
  owner: string | null;
  created_at: number;
  original_creator: string;
  royalty_bps: number;
  recipients: Array<{ address: string; percentage: number }>;
}

/** Shared across pages in a test — indexer mock reads from here. */
export class MarketplaceTestStore {
  listings: E2eIndexerListing[] = [];

  reset() {
    this.listings = [];
  }

  upsertActive(listing: E2eIndexerListing) {
    this.listings = this.listings.filter(
      (l) => l.listing_id !== listing.listing_id,
    );
    this.listings.push(listing);
  }

  markSold(listingId: number, buyer: string) {
    this.listings = this.listings.map((l) =>
      l.listing_id === listingId ? { ...l, status: "Sold", owner: buyer } : l,
    );
  }

  activeListings() {
    return this.listings.filter((l) => l.status === "Active");
  }
}

const INDEXER_URL = (
  process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

/**
 * Mocks IPFS uploads, metadata gateway reads, and indexer listing API.
 * Chain calls use NEXT_PUBLIC_E2E_MOCK_CHAIN on the dev server.
 */
export async function setupMarketplaceMocks(
  page: Page,
  store: MarketplaceTestStore,
  options?: { categoryByCid?: Record<string, string> },
) {
  await page.route("**/api/ipfs/upload-image", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cid: E2E_IMAGE_CID }),
    });
  });

  await page.route("**/api/ipfs/upload-metadata", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cid: E2E_METADATA_CID }),
    });
  });

  const fulfillMetadata = async (route: {
    fulfill: (opts: object) => Promise<void>;
  }) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_ARTWORK_METADATA),
    });
  };

  await page.route("**/gateway.pinata.cloud/ipfs/**", fulfillMetadata);
  await page.route("**/ipfs.io/ipfs/**", fulfillMetadata);

  const categoryByCid = options?.categoryByCid ?? {};

  const applyListingFilters = (url: URL): E2eIndexerListing[] => {
    let rows = store.listings;

    const statusFilter = url.searchParams.get("status");
    if (statusFilter && statusFilter !== "All") {
      rows = rows.filter((l) => l.status === statusFilter);
    }

    const artistFilter = url.searchParams.get("artist");
    if (artistFilter) {
      rows = rows.filter((l) => l.artist === artistFilter);
    }

    const ownerFilter = url.searchParams.get("owner");
    if (ownerFilter) {
      rows = rows.filter((l) => l.owner === ownerFilter);
    }

    const search = url.searchParams.get("search");
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((l) => l.artist.toLowerCase().includes(q));
    }

    const minPrice = url.searchParams.get("minPrice");
    const maxPrice = url.searchParams.get("maxPrice");
    if (minPrice || maxPrice) {
      rows = rows.filter((l) => {
        const p = Number(l.price);
        if (minPrice && p < Number(minPrice)) return false;
        if (maxPrice && p > Number(maxPrice)) return false;
        return true;
      });
    }

    const category = url.searchParams.get("category");
    if (category && category !== "All") {
      rows = rows.filter((l) => categoryByCid[l.metadata_cid] === category);
    }

    return rows;
  };

  const sortListings = (rows: E2eIndexerListing[], sort: string | null) => {
    const copy = [...rows];
    switch (sort) {
      case "oldest":
        return copy.sort((a, b) => a.created_at - b.created_at);
      case "price_asc":
        return copy.sort((a, b) => Number(a.price) - Number(b.price));
      case "price_desc":
        return copy.sort((a, b) => Number(b.price) - Number(a.price));
      default: // "newest"
        return copy.sort((a, b) => b.created_at - a.created_at);
    }
  };

  await page.route(`${INDEXER_URL}/listings**`, async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }

    const url = new URL(route.request().url());

    let rows = applyListingFilters(url);
    const total = rows.length;

    rows = sortListings(rows, url.searchParams.get("sort"));

    const rawLimit = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 1000)
        : 50;
    const rawOffset = Number(url.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
    rows = rows.slice(offset, offset + limit);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ listings: rows, total }),
    });
  });

  await page.route(`${INDEXER_URL}/stats**`, async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totalListings: store.listings.length,
        activeListings: store.activeListings().length,
        totalSales: store.listings.filter((l) => l.status === "Sold").length,
        totalVolume: "0",
        activeUsers: 0,
        totalEvents: 0,
      }),
    });
  });

  await page.route(`${INDEXER_URL}/auctions**`, async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

/** Mock wallet token / activity / staked / preferences endpoints used by dashboard, profile & staking. */
export async function setupWalletIndexerMocks(
  page: Page,
  options?: {
    tokens?: unknown;
    activity?: unknown[];
    royaltyStats?: {
      totalEarned: string;
      payoutCount: number;
      lastPayout: number;
    };
    staked?: unknown[];
    preferences?: {
      theme?: string;
      currency?: string;
      priceAlerts?: boolean;
    };
  },
) {
  const tokens = options?.tokens ?? [];
  const activity = options?.activity ?? [];
  const royaltyStats = options?.royaltyStats ?? {
    totalEarned: "0.00",
    payoutCount: 0,
    lastPayout: 0,
  };
  const staked = options?.staked ?? [];
  const preferences = options?.preferences ?? {};

  await page.route("**/wallets/*/tokens", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tokens),
    });
  });

  await page.route("**/wallets/*/activity**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(activity),
    });
  });

  await page.route("**/wallets/*/royalty-stats**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(royaltyStats),
    });
  });

  await page.route("**/wallets/*/staked", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const staked = options?.staked ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(staked),
    });
  });

  await page.route("**/wallets/*/preferences", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(preferences),
      });
      return;
    }
    if (method === "PUT") {
      const body = route.request().postDataJSON() ?? {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...preferences, ...body }),
      });
      return;
    }
    return route.continue();
  });
}

export async function resetE2eListingsInBrowser(page: Page) {
  await page.evaluate(() => {
    (
      window as Window & { __E2E_RESET_LISTINGS__?: () => void }
    ).__E2E_RESET_LISTINGS__?.();
  });
}

/** Forces the next mocked on-chain write to throw as if Freighter's signature prompt was rejected. */
export async function rejectNextE2eTransaction(page: Page) {
  await page.evaluate(() => {
    (window as Window & { __E2E_REJECT_NEXT_TX__?: boolean }).__E2E_REJECT_NEXT_TX__ =
      true;
  });
}

/** Forces the next mocked on-chain write to throw with a custom error message. */
export async function failNextE2eTransaction(page: Page, message: string) {
  await page.evaluate((msg) => {
    (window as Window & { __E2E_NEXT_TX_ERROR__?: string }).__E2E_NEXT_TX_ERROR__ =
      msg;
  }, message);
}

export async function seedE2eStakingPoolInBrowser(
  page: Page,
  nftAddress: string,
  rewardRate?: number,
): Promise<string> {
  return page.evaluate(
    ({ addr, rate }) => {
      const fn = (
        window as Window & {
          __E2E_SEED_STAKING_POOL__?: (
            nftAddress: string,
            rewardRate: bigint,
          ) => string;
        }
      ).__E2E_SEED_STAKING_POOL__;
      if (!fn) throw new Error("__E2E_SEED_STAKING_POOL__ not available");
      return fn(addr, BigInt(rate ?? 100));
    },
    { addr: nftAddress, rate: rewardRate ?? 100 },
  );
}

export async function seedE2eAuctionInBrowser(
  page: Page,
  auction: {
    auction_id: number;
    creator: string;
    metadata_cid?: string;
    collection: string;
    token_id: number;
    token: string;
    reserve_price: bigint;
    highest_bid: bigint;
    highest_bidder: string | null;
    end_time: number;
    status: "Active" | "Finalized" | "Cancelled";
    recipients: Array<{ address: string; percentage: number }>;
    created_at: number;
  },
) {
  await page.addInitScript((a) => {
    const fn = (window as Window & { __E2E_SEED_AUCTION__?: (auction: any) => void }).__E2E_SEED_AUCTION__;
    const obj = {
      ...a,
      reserve_price: BigInt(a.reserve_price),
      highest_bid: BigInt(a.highest_bid),
    };
    if (fn) {
      fn(obj);
    } else {
      (window as any).__E2E_PENDING_AUCTIONS__ = (window as any).__E2E_PENDING_AUCTIONS__ || [];
      (window as any).__E2E_PENDING_AUCTIONS__.push(obj);
    }
  }, {
    ...auction,
    reserve_price: String(auction.reserve_price),
    highest_bid: String(auction.highest_bid),
  });
}
