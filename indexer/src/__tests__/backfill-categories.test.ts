import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockResolve } = vi.hoisted(() => ({
  mockPrisma: {
    listing: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  mockResolve: vi.fn(),
}));

vi.mock('../db.js', () => ({ default: mockPrisma }));
vi.mock('../ipfs.js', () => ({ resolveMetadataCategory: mockResolve }));

import { runCategoryBackfill } from '../backfill-categories.js';

describe('runCategoryBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.listing.update.mockImplementation((args) => args);
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  it('applies a batch of updates in a single $transaction', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([
      { listingId: 1, metadataCid: 'cidA' },
      { listingId: 2, metadataCid: 'cidA' },
      { listingId: 3, metadataCid: 'cidB' },
    ]);
    mockResolve.mockImplementation(async (cid: string) => (cid === 'cidA' ? 'Art' : 'Music'));

    await runCategoryBackfill();

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(ops.map((o: any) => o.data.category)).toEqual(['Art', 'Art', 'Music']);
    expect(mockResolve).toHaveBeenCalledTimes(2); // CID cache
  });

  it('skips the transaction when no category can be resolved', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([{ listingId: 1, metadataCid: 'bad' }]);
    mockResolve.mockResolvedValue(null);

    await runCategoryBackfill();

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not throw when the batch transaction fails (rolled back, re-runnable)', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([{ listingId: 1, metadataCid: 'cidA' }]);
    mockResolve.mockResolvedValue('Art');
    mockPrisma.$transaction.mockRejectedValue(new Error('constraint violation'));

    await expect(runCategoryBackfill()).resolves.toBeUndefined();
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
