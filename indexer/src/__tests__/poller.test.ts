import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Prevent dotenv from loading .env so module-level CONTRACT_ID constants stay empty
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

// Prevent redis from trying to connect during import
vi.mock("../redis", () => ({
  default: {
    isReady: false,
    flushDb: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

// Prevent api/routes SSE emitter from being imported for real
vi.mock("../api/routes", () => ({ emitSSEEvent: vi.fn() }));

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockTx = vi.hoisted(() => ({
  marketplaceEvent: { deleteMany: vi.fn().mockResolvedValue({}) },
  listing: {
    deleteMany: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  auction: {
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  offer: {
    deleteMany: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  stakedNFT: {
    deleteMany: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  collection: { deleteMany: vi.fn().mockResolvedValue({}) },
  lendingListing: { deleteMany: vi.fn().mockResolvedValue({}) },
  lendingPosition: { deleteMany: vi.fn().mockResolvedValue({}) },
  whitelistedCurrency: { deleteMany: vi.fn().mockResolvedValue({}) },
  syncState: { update: vi.fn().mockResolvedValue({}) },
}));

const mockPrisma = vi.hoisted(() => ({
  marketplaceEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
  indexerError: {
    create: vi.fn().mockResolvedValue({}),
  },
  listing: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  auction: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  offer: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  collection: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  lendingListing: {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  lendingPosition: {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  whitelistedCurrency: {
    upsert: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  syncState: {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 1, lastLedger: 0 }),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi
      .fn()
      .mockResolvedValue({ id: 1, lastLedger: 0, lastLedgerHash: null }),
  },
  $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
}));

vi.mock("../db", () => ({ default: mockPrisma }));
vi.mock("../metrics.js", () => ({
  latestLedgerProcessedGauge: { set: vi.fn() },
  networkLatestLedgerGauge: { set: vi.fn() },
  syncLatencyGauge: { set: vi.fn() },
}));

const mockResolveMetadataCategory = vi.hoisted(() => vi.fn());
vi.mock("../ipfs.js", () => ({
  resolveMetadataCategory: mockResolveMetadataCategory,
}));

// Stellar SDK mocks for offline unit testing
vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      getEvents() {
        return Promise.resolve({ events: [] });
      }
      getLedgers() {
        return Promise.resolve({
          ledgers: [{ hash: "correct_network_hash", sequence: 100 }],
        });
      }
      getLatestLedger() {
        return Promise.resolve({ sequence: 1000 });
      }
      getAccount() {
        return Promise.resolve({ sequence: "1" });
      }
      simulateTransaction() {
        return Promise.resolve({ result: { retval: {} } });
      }
    },
    Api: {
      isSimulationError: () => false,
    },
  },
  Contract: class {
    call() {
      return {};
    }
  },
  TransactionBuilder: class {
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return {};
    }
  },
  BASE_FEE: "100",
  nativeToScVal: () => ({}),
  scValToNative: () => ({}),
  Address: class {
    constructor(public addr: string) {}
    toScVal() {
      return {};
    }
    toString() {
      return this.addr;
    }
  },
}));

import {
  processEvent,
  processEvents,
  revertLedgers,
  validateHashContinuity,
  buildSyncStateLedgerData,
  startPolling,
} from "../poller";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEvent(
  eventType: string,
  listingId: bigint | null,
  actor: string,
  data: Record<string, unknown>,
  ledger = 100,
) {
  return { eventType, listingId, actor, ledgerSequence: ledger, data };
}

// ── MarketplaceEvent log (all event types) ────────────────────────────────────

describe("processEvent — always logs to MarketplaceEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a MarketplaceEvent record for every event", async () => {
    const event = makeEvent("OFFER_MADE", null, "GA_OFFERER", {});
    await processEvent(event);

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledOnce();
    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "OFFER_MADE",
        actor: "GA_OFFERER",
        ledgerSequence: 100,
      }),
    });
  });

  it("stores the decoded data in the event record", async () => {
    const data = {
      price: "1000000",
      currency: "XLM",
      collection: "CCOLLECTION",
      token_id: 1,
    };
    const event = makeEvent("LISTING_CREATED", 1n, "GA_ARTIST", data);
    await processEvent(event);

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ data }),
    });
  });
});

// ── Error isolation / dead-letter handling ────────────────────────────────────

describe("processEvents — error isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("continues processing healthy events after a malformed event throws", async () => {
    const malformed = makeEvent("LISTING_CREATED", 99n, "GA", {}, 150);
    const healthy = makeEvent("LISTING_CANCELLED", 3n, "", {}, 151);

    mockPrisma.marketplaceEvent.create.mockRejectedValueOnce(
      new Error("malformed payload"),
    );

    await expect(processEvents([malformed, healthy])).resolves.not.toThrow();

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 3n },
      data: expect.objectContaining({ status: "Cancelled" }),
    });
  });

  it("records the failed event in indexerError for dead-letter handling", async () => {
    const malformed = makeEvent("BID_PLACED", 11n, "GB", { bad: true }, 160);
    mockPrisma.auction.updateMany.mockRejectedValueOnce(
      new Error("unexpected shape"),
    );

    await processEvents([malformed]);

    expect(mockPrisma.indexerError.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: "BID_PLACED",
        ledgerSequence: 160,
        errorMessage: expect.stringContaining("unexpected shape"),
      }),
    });
  });

  it("does not throw when recording the dead-letter entry itself fails", async () => {
    const malformed = makeEvent("OFFER_MADE", null, "GA", {}, 170);
    mockPrisma.marketplaceEvent.create.mockRejectedValueOnce(
      new Error("parse failure"),
    );
    mockPrisma.indexerError.create.mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    await expect(processEvents([malformed])).resolves.not.toThrow();
  });
});

// ── Listing upsert on LISTING_CREATED ────────────────────────────────────────

describe("processEvent — LISTING_CREATED", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMetadataCategory.mockResolvedValue(null);
  });

  it("upserts a new listing with Active status", async () => {
    const data = {
      artist: "GA_ARTIST",
      price: "10000000",
      currency: "XLM",
      collection: "CCOLLECTION",
      token_id: 1,
      token: "CTOKEN",
    };
    await processEvent(
      makeEvent("LISTING_CREATED", 42n, "GA_ARTIST", data, 200),
    );

    expect(mockPrisma.listing.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.listing.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ listingId: 42n });
    expect(call.create).toMatchObject({
      listingId: 42n,
      artist: "GA_ARTIST",
      status: "Active",
      createdAtLedger: 200,
    });
  });

  it("does not call listing.updateMany for LISTING_CREATED", async () => {
    await processEvent(
      makeEvent(
        "LISTING_CREATED",
        1n,
        "GA",
        { artist: "GA", collection: "C", token_id: 1 },
        1,
      ),
    );
    expect(mockPrisma.listing.updateMany).not.toHaveBeenCalled();
  });

  it("stores the category resolved from IPFS metadata on create", async () => {
    mockResolveMetadataCategory.mockResolvedValue("Painting");
    const data = {
      artist: "GA_ARTIST",
      price: "10000000",
      currency: "XLM",
      collection: "CCOLLECTION",
      token_id: 1,
      token: "CTOKEN",
    };
    await processEvent(
      makeEvent("LISTING_CREATED", 7n, "GA_ARTIST", data, 201),
    );

    const call = mockPrisma.listing.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ category: "Painting" });
  });

  it("stores null category when IPFS metadata cannot be resolved", async () => {
    const data = {
      artist: "GA_ARTIST",
      price: "10000000",
      currency: "XLM",
      collection: "CCOLLECTION",
      token_id: 1,
      token: "CTOKEN",
    };
    await processEvent(
      makeEvent("LISTING_CREATED", 8n, "GA_ARTIST", data, 202),
    );

    const call = mockPrisma.listing.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ category: null });
  });
});

// ── Listing update on LISTING_UPDATED ────────────────────────────────────────

describe("processEvent — LISTING_UPDATED", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates price and metadataCid", async () => {
    const data = {
      new_price: "20000000",
      collection: "CCOLLECTION",
      token_id: 1,
    };
    await processEvent(makeEvent("LISTING_UPDATED", 5n, "", data, 300));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 5n },
      data: expect.objectContaining({
        price: "20000000",
        collection: "CCOLLECTION",
        nftTokenId: 1n,
        updatedAtLedger: 300,
      }),
    });
  });
});

// ── ARTWORK_SOLD ──────────────────────────────────────────────────────────────

describe("processEvent — ARTWORK_SOLD", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets status to Sold and records the buyer as owner", async () => {
    const data = { buyer: "GB_BUYER" };
    await processEvent(makeEvent("ARTWORK_SOLD", 8n, "GB_BUYER", data, 400));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 8n },
      data: expect.objectContaining({ status: "Sold", owner: "GB_BUYER" }),
    });
  });
});

// ── LISTING_CANCELLED ─────────────────────────────────────────────────────────

describe("processEvent — LISTING_CANCELLED", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets status to Cancelled", async () => {
    await processEvent(makeEvent("LISTING_CANCELLED", 3n, "", {}, 500));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 3n },
      data: expect.objectContaining({ status: "Cancelled" }),
    });
  });
});
