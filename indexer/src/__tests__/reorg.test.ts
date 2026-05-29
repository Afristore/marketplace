import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock objects to be initialized before vi.mock executes
const { mockGetLedgers, mockPrisma } = vi.hoisted(() => {
  const mGetLedgers = vi.fn().mockResolvedValue({
    ledgers: [{ hash: 'correct_network_hash', sequence: 100 }]
  });
  
  const mPrisma: any = {
    marketplaceEvent: {
      findMany: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    listing: {
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    syncState: {
      update: vi.fn().mockResolvedValue({}),
    },
    collection: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auction: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    offer: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  
  mPrisma.$transaction = vi.fn((callback) => callback(mPrisma));
  
  return { mockGetLedgers: mGetLedgers, mockPrisma: mPrisma };
});

vi.mock('../db', () => ({ default: mockPrisma }));

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: class {
      getLedgers = mockGetLedgers;
    },
  },
}));

import { revertLedgers } from '../poller';

describe('Chain Re-organization Rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly reverts listings, collections, and events to target ledger', async () => {
    const toLedger = 100;

    // Mock listings that were updated in the reverted ledgers (i.e. > 100)
    mockPrisma.listing.findMany.mockResolvedValue([
      { listingId: 1n, createdAtLedger: 105 }, // Created after toLedger (should be deleted)
      { listingId: 2n, createdAtLedger: 90 },  // Created before, updated after (should be replayed)
    ]);

    // Mock history events for listing 2n (the one that should be replayed)
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue([
      {
        id: 1,
        eventType: 'LISTING_CREATED',
        ledgerSequence: 90,
        data: {
          artist: 'GA_ARTIST',
          price: '10000000',
          currency: 'XLM',
          metadata_cid: 'QmOriginal',
          token: 'TOKEN1',
          royalty_bps: 500,
        },
      },
      {
        id: 2,
        eventType: 'LISTING_UPDATED',
        ledgerSequence: 95,
        data: {
          new_price: '12000000',
          metadata_cid: 'QmUpdated',
        },
      },
    ]);

    // Execute the rollback
    await revertLedgers(toLedger);

    // 1. Transaction should have been called
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();

    // 2. Listing created after toLedger (1n) should be deleted
    expect(mockPrisma.listing.delete).toHaveBeenCalledWith({
      where: { listingId: 1n },
    });

    // 3. Listing 2n events should be fetched to replay
    expect(mockPrisma.marketplaceEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          listingId: 2n,
          ledgerSequence: { lte: toLedger },
        }),
      })
    );

    // 4. Listing 2n should be updated with the replayed state as of ledger 95
    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
      where: { listingId: 2n },
      data: expect.objectContaining({
        status: 'Active',
        price: '12000000',
        metadataCid: 'QmUpdated',
        updatedAtLedger: 95,
      }),
    });

    // 5. Collections deployed after toLedger should be deleted
    expect(mockPrisma.collection.deleteMany).toHaveBeenCalledWith({
      where: { deployedAtLedger: { gt: toLedger } },
    });

    // 6. Events occurred after toLedger should be deleted
    expect(mockPrisma.marketplaceEvent.deleteMany).toHaveBeenCalledWith({
      where: { ledgerSequence: { gt: toLedger } },
    });

    // 7. SyncState lastLedger and ledgerHash should be updated
    expect(mockPrisma.syncState.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        lastLedger: toLedger,
        ledgerHash: 'correct_network_hash',
      },
    });
  });
});
