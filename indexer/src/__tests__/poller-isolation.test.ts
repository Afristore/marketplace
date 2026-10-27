import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-event error isolation in the poll loop (#1174).
//
// These tests drive the real batch path (indexEventBatch -> applyDecodedEvents
// -> processEvent) against an in-memory fake of the Prisma client that models
// Postgres transaction semantics: writes inside $transaction are only visible
// after commit, a thrown error rolls the whole transaction back, and
// SAVEPOINT / ROLLBACK TO SAVEPOINT / RELEASE SAVEPOINT restore state.

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

const mockCollect = vi.hoisted(() => vi.fn());
vi.mock("../event-sync.js", () => ({
  collectMarketplaceEvents: mockCollect,
  MAX_LEDGER_WINDOW: 17_000,
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: class {
      getLedgers() {
        return Promise.resolve({ ledgers: [{ hash: "h", sequence: 1 }] });
      }
      getLatestLedger() {
        return Promise.resolve({ sequence: 1000 });
      }
    },
    Api: { isSimulationError: () => false },
  },
  Contract: class {},
  TransactionBuilder: class {},
  BASE_FEE: "100",
  nativeToScVal: () => ({}),
  scValToNative: () => ({}),
  Keypair: { random: () => ({ publicKey: () => "G" }) },
  Account: class {},
}));

// ── In-memory fake Prisma with transaction + savepoint semantics ─────────────

type State = {
  events: any[];
  listings: Map<string, any>;
  indexerErrors: any[];
  syncState: { id: number; lastLedger: number; lastLedgerHash: string | null };
};

const fake = vi.hoisted(() => {
  const clone = (s: any) => structuredClone(s);
  const hooks: {
    listingUpdate?: (args: any) => void;
    indexerErrorCreate?: (args: any) => void;
  } = {};

  const db: { committed: any } = {
    committed: {
      events: [],
      listings: new Map(),
      indexerErrors: [],
      syncState: { id: 1, lastLedger: 0, lastLedgerHash: null },
    },
  };

  function makeClient(getState: () => any, setState?: (s: any) => void) {
    const savepoints = new Map<string, any>();
    return {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        if (!setState) throw new Error("savepoint outside transaction");
        const [, op, name] =
          /^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) (\w+)$/.exec(sql) ?? [];
        if (op === "SAVEPOINT") savepoints.set(name, clone(getState()));
        else if (op === "ROLLBACK TO SAVEPOINT") {
          if (!savepoints.has(name)) throw new Error(`no savepoint ${name}`);
          setState(clone(savepoints.get(name)));
        } else if (op === "RELEASE SAVEPOINT") savepoints.delete(name);
        else throw new Error(`unexpected sql ${sql}`);
        return 0;
      }),
      marketplaceEvent: {
        findMany: vi.fn(async ({ where }: any) =>
          getState().events.filter((e: any) =>
            where.OR.some(
              (c: any) =>
                c.listingId === e.listingId &&
                c.eventType === e.eventType &&
                c.ledgerSequence === e.ledgerSequence,
            ),
          ),
        ),
        createMany: vi.fn(async ({ data }: any) => {
          for (const row of data) getState().events.push({ ...row });
          return { count: data.length };
        }),
      },
      listing: {
        updateMany: vi.fn(async (args: any) => {
          hooks.listingUpdate?.(args);
          const key = String(args.where.listingId);
          const current = getState().listings.get(key) ?? {};
          getState().listings.set(key, { ...current, ...args.data });
          return { count: 1 };
        }),
      },
      indexerError: {
        create: vi.fn(async (args: any) => {
          hooks.indexerErrorCreate?.(args);
          getState().indexerErrors.push(args.data);
          return args.data;
        }),
      },
      syncState: {
        upsert: vi.fn(async () => clone(getState().syncState)),
        update: vi.fn(async ({ data }: any) => {
          Object.assign(getState().syncState, data);
          return clone(getState().syncState);
        }),
      },
    };
  }

  const prisma: any = {
    ...makeClient(() => db.committed),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      let working = clone(db.committed);
      const tx = makeClient(
        () => working,
        (s) => {
          working = s;
        },
      );
      const result = await fn(tx); // throws -> working discarded (rollback)
      db.committed = working; // commit
      return result;
    }),
  };

  return { db, prisma, hooks };
});

vi.mock("../db", () => ({ default: fake.prisma }));

import { indexEventBatch } from "../poller";

function ev(eventType: string, listingId: bigint, data: any, ledger: number) {
  return { eventType, listingId, actor: "GA", ledgerSequence: ledger, data };
}

const committed = (): State => fake.db.committed;

function resetDb(lastLedger = 100, lastLedgerHash = "old_hash") {
  fake.db.committed = {
    events: [],
    listings: new Map(),
    indexerErrors: [],
    syncState: { id: 1, lastLedger, lastLedgerHash },
  };
  fake.hooks.listingUpdate = undefined;
  fake.hooks.indexerErrorCreate = undefined;
}

// LISTING_UPDATED with a non-numeric token_id makes processEvent throw
// `SyntaxError: Cannot convert abc to a BigInt` — a genuinely malformed payload.
const good1 = ev("LISTING_UPDATED", 1n, { new_price: "10", token_id: "1" }, 101);
const bad = ev("LISTING_UPDATED", 2n, { new_price: 5n, token_id: "abc" }, 102);
const good2 = ev("LISTING_CANCELLED", 3n, {}, 103);

describe("indexEventBatch — per-event isolation (#1174)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("applies good events around a malformed one, dead-letters it and advances the cursor", async () => {
    const { updatedState, newEvents } = await indexEventBatch(
      [good1, bad, good2],
      103,
      "new_hash",
    );

    const state = committed();
    // Good events before and after the bad one are applied
    expect(state.listings.get("1")).toMatchObject({ price: "10", nftTokenId: 1n });
    expect(state.listings.get("3")).toMatchObject({ status: "Cancelled" });
    // The malformed event left no partial writes behind
    expect(state.listings.has("2")).toBe(false);
    expect(state.events.map((e) => e.listingId)).toEqual([1n, 3n]);
    // ...and was recorded in IndexerError
    expect(state.indexerErrors).toHaveLength(1);
    expect(state.indexerErrors[0]).toMatchObject({
      eventType: "LISTING_UPDATED",
      listingId: 2n,
      ledgerSequence: 102,
      payload: { new_price: "5", token_id: "abc" },
      error: expect.stringContaining("BigInt"),
    });
    // Cursor moved past the whole batch
    expect(state.syncState).toMatchObject({ lastLedger: 103, lastLedgerHash: "new_hash" });
    expect(updatedState.lastLedger).toBe(103);
    // Only applied events are emitted downstream
    expect(newEvents).toEqual([good1, good2]);
  });

  it("is idempotent on retry: already-indexed events are skipped", async () => {
    await indexEventBatch([good1, bad, good2], 103, "new_hash");
    const { newEvents } = await indexEventBatch([good1, good2], 103, "new_hash");
    expect(newEvents).toEqual([]);
    expect(committed().events).toHaveLength(2);
  });

  it("fails the whole batch on an infrastructure error and leaves the cursor untouched", async () => {
    fake.hooks.listingUpdate = (args) => {
      if (args.where.listingId === 3n) {
        throw new Error("Connection terminated unexpectedly");
      }
    };

    await expect(
      indexEventBatch([good1, bad, good2], 103, "new_hash"),
    ).rejects.toThrow("Connection terminated unexpectedly");

    const state = committed();
    expect(state.syncState).toMatchObject({ lastLedger: 100, lastLedgerHash: "old_hash" });
    // Nothing from the batch was committed, including the earlier good event
    // and the dead-letter row, so the retry replays the batch cleanly.
    expect(state.listings.size).toBe(0);
    expect(state.events).toHaveLength(0);
    expect(state.indexerErrors).toHaveLength(0);
  });

  it("treats a Prisma connection error (P1001) as infrastructure", async () => {
    fake.hooks.listingUpdate = () => {
      throw Object.assign(new Error("Can't reach database server"), {
        name: "PrismaClientKnownRequestError",
        code: "P1001",
      });
    };
    await expect(indexEventBatch([good1], 101, "h")).rejects.toThrow(
      "Can't reach database server",
    );
    expect(committed().syncState.lastLedger).toBe(100);
  });

  it("keeps going when writing the IndexerError row itself fails", async () => {
    fake.hooks.indexerErrorCreate = () => {
      throw Object.assign(new Error('relation "IndexerError" does not exist'), {
        name: "PrismaClientKnownRequestError",
        code: "P2021",
      });
    };

    const { newEvents } = await indexEventBatch([good1, bad, good2], 103, "new_hash");

    const state = committed();
    expect(newEvents).toEqual([good1, good2]);
    expect(state.listings.get("3")).toMatchObject({ status: "Cancelled" });
    expect(state.indexerErrors).toHaveLength(0);
    expect(state.syncState.lastLedger).toBe(103);
  });
});

describe("startPolling — loop survives malformed events (#1174)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Hash matches what the mocked RPC returns, so no reorg is triggered.
    resetDb(100, "h");
    process.env.MARKETPLACE_CONTRACT_ID = "CTEST";
    process.env.POLL_INTERVAL_MS = "10";
  });

  afterEach(() => {
    delete process.env.MARKETPLACE_CONTRACT_ID;
    delete process.env.POLL_INTERVAL_MS;
  });

  it("advances the cursor past a bad event and keeps polling even if dead-lettering fails", async () => {
    fake.hooks.indexerErrorCreate = () => {
      throw new Error("db unavailable");
    };
    let calls = 0;
    mockCollect.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve([good1, bad, good2]);
      if (calls === 2) return Promise.resolve([]);
      return new Promise(() => {}); // park the loop so it stops spinning
    });

    vi.resetModules();
    const { startPolling } = await import("../poller");
    startPolling().catch(() => {});

    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(3), {
      timeout: 3000,
    });

    const state = committed();
    expect(state.listings.get("1")).toBeDefined();
    expect(state.listings.get("3")).toMatchObject({ status: "Cancelled" });
    expect(state.syncState.lastLedger).toBeGreaterThanOrEqual(103);
    // Second poll resumed after the batch rather than replaying it
    expect(mockCollect.mock.calls[1][2]).toBeGreaterThan(103);
  }, 8000);
});
