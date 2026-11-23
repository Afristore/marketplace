import { describe, it, expect, vi, beforeEach } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";

// Malformed XDR in a ledger block (#1306). Unlike poller-isolation.test.ts,
// the real @stellar/stellar-sdk and the real parser run here, so the events
// are real XDR: the collection step decodes each one, drops the malformed
// ones, and the batch path persists the valid ones and advances the cursor.

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
vi.mock("../redis", () => ({
  default: {
    isReady: false,
    flushDb: vi.fn().mockResolvedValue("OK"),
    disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../api/routes", () => ({ emitSSEEvent: vi.fn() }));
vi.mock("../metrics.js", () => ({
  latestLedgerProcessedGauge: { set: vi.fn() },
  networkLatestLedgerGauge: { set: vi.fn() },
  syncLatencyGauge: { set: vi.fn() },
}));
vi.mock("../ipfs.js", () => ({ resolveMetadataCategory: vi.fn() }));

// Minimal in-memory Prisma: enough for LISTING_CANCELLED, which is the only
// event type in these fixtures. No failures are injected, so no savepoint
// rollback is needed.
type Row = Record<string, unknown>;
const store = vi.hoisted(() => {
  const state = {
    events: [] as Row[],
    listings: new Map<string, Row>(),
    indexerErrors: [] as Row[],
    syncState: { id: 1, lastLedger: 0, lastLedgerHash: null as string | null },
  };
  const client = {
    $executeRawUnsafe: vi.fn(async () => 0),
    marketplaceEvent: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        state.events.push(...data.map((row) => ({ ...row })));
        return { count: data.length };
      }),
    },
    listing: {
      updateMany: vi.fn(async (args: { where: { listingId: bigint }; data: Row }) => {
        const key = String(args.where.listingId);
        state.listings.set(key, { ...(state.listings.get(key) ?? {}), ...args.data });
        return { count: 1 };
      }),
    },
    indexerError: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        state.indexerErrors.push(data);
        return data;
      }),
    },
    syncState: {
      upsert: vi.fn(async () => ({ ...state.syncState })),
      update: vi.fn(async ({ data }: { data: Partial<typeof state.syncState> }) => {
        Object.assign(state.syncState, data);
        return { ...state.syncState };
      }),
    },
  };
  const prisma = {
    ...client,
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
  };
  return { state, prisma };
});

vi.mock("../db", () => ({ default: store.prisma }));

const getEventsPages = vi.hoisted(() => ({ pages: [] as unknown[] }));
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: class {
        getEvents() {
          return Promise.resolve(getEventsPages.pages.shift() ?? { events: [], paginationToken: null });
        }
        getLedgers() {
          return Promise.resolve({ ledgers: [{ hash: "h", sequence: 1 }] });
        }
        getLatestLedger() {
          return Promise.resolve({ sequence: 1000 });
        }
      },
    },
  };
});

import { collectMarketplaceEvents } from "../event-sync";
import { indexEventBatch } from "../poller";
import { rpc } from "@stellar/stellar-sdk";

/** A real RPC event: symbol topic and a map value, both as ScVals. */
function rpcEvent(topic: string, value: Record<string, unknown>, ledger: number) {
  return {
    topic: [nativeToScVal(topic, { type: "symbol" })],
    value: nativeToScVal(value),
    ledger,
  };
}

/** Malformed value: the topic is valid but the value is not base64 XDR. */
function malformedEvent(ledger: number) {
  return { topic: [nativeToScVal("lst_cncl", { type: "symbol" })], value: "not-base64-xdr!!", ledger };
}

describe("poller: malformed XDR in a ledger block (#1306)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEventsPages.pages = [];
    store.state.events = [];
    store.state.listings = new Map();
    store.state.indexerErrors = [];
    store.state.syncState = { id: 1, lastLedger: 100, lastLedgerHash: "h" };
  });

  it("drops the malformed event, persists the valid ones in the same block and advances the cursor", async () => {
    getEventsPages.pages = [
      {
        events: [
          rpcEvent("lst_cncl", { listing_id: 7n }, 101),
          malformedEvent(102),
          rpcEvent("lst_cncl", { listing_id: 9n }, 102),
        ],
        paginationToken: null,
      },
    ];

    const server = new rpc.Server("https://rpc.test") as unknown as rpc.Server;
    const decoded = await collectMarketplaceEvents(server, ["CTEST"], 101, 102);

    // The malformed value is ignored during decoding, not thrown.
    expect(decoded.map((event) => event.listingId)).toEqual([7n, 9n]);

    const result = await indexEventBatch(decoded, 102, "new_hash");

    expect(store.state.listings.get("7")).toMatchObject({ status: "Cancelled" });
    expect(store.state.listings.get("9")).toMatchObject({ status: "Cancelled" });
    expect(store.state.events.map((row) => row.listingId)).toEqual([7n, 9n]);
    expect(store.state.indexerErrors).toHaveLength(0);
    expect(store.state.syncState).toMatchObject({ lastLedger: 102, lastLedgerHash: "new_hash" });
    expect(result.newEvents).toHaveLength(2);
  });

  it("keeps decoding later pages when one page holds only malformed events", async () => {
    getEventsPages.pages = [
      { events: [malformedEvent(101), malformedEvent(101)], paginationToken: "next" },
      { events: [rpcEvent("lst_cncl", { listing_id: 3n }, 101)], paginationToken: null },
    ];

    const server = new rpc.Server("https://rpc.test") as unknown as rpc.Server;
    const decoded = await collectMarketplaceEvents(server, ["CTEST"], 101, 101);

    expect(decoded.map((event) => event.listingId)).toEqual([3n]);
    await indexEventBatch(decoded, 101, "h2");
    expect(store.state.listings.get("3")).toMatchObject({ status: "Cancelled" });
  });
});
