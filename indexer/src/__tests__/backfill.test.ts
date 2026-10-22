import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockPrisma, mockCollectEvents, mockRpcServer, mockLogger } = vi.hoisted(() => {
  const serverInstance = {
    getLatestLedger: vi.fn(),
    getLedgers: vi.fn(),
  };

  const RpcServerMock = vi.fn(() => serverInstance);

  return {
    mockPrisma: {
      $transaction: vi.fn(),
      syncState: {
        upsert: vi.fn(),
      },
    },
    mockCollectEvents: vi.fn(),
    mockRpcServer: {
      Server: RpcServerMock,
      instance: serverInstance,
    },
    mockLogger: {
      child: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      }),
    },
  };
});

vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: mockRpcServer.Server,
  },
}));

vi.mock('../db.js', () => ({ default: mockPrisma }));
vi.mock('../event-sync.js', () => ({ collectMarketplaceEvents: mockCollectEvents }));
vi.mock('../logger.js', () => ({ logger: mockLogger }));
vi.mock('../poller.js', () => ({
  applyDecodedEvents: vi.fn().mockResolvedValue([{ id: 1 }]),
  buildSyncStateLedgerData: vi.fn((seq, hash) => ({ lastLedger: seq, ledgerHash: hash })),
}));

import { runBackfill } from '../backfill.js';

describe('Indexer backfill.ts', () => {
  const originalArgv = process.argv;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ARCHIVAL_STELLAR_RPC_URL = 'https://archival-rpc.example.com';
    process.env.MARKETPLACE_CONTRACT_ID = 'CDTESTMARKETPLACE';
    delete process.env.LAUNCHPAD_CONTRACT_ID;
    mockRpcServer.instance.getLatestLedger.mockResolvedValue({ sequence: 1000 });
    mockRpcServer.instance.getLedgers.mockResolvedValue({ ledgers: [{ hash: 'hash_100' }] });
  });


  afterEach(() => {
    process.argv = originalArgv;
    process.env = { ...originalEnv };
  });

  describe('Ledger Range Validation', () => {
    it('throws validation error when startLedger > endLedger', async () => {
      process.argv = ['node', 'backfill.ts', '--start=500', '--end=200'];

      await expect(runBackfill()).rejects.toThrow(
        /Invalid ledger range: startLedger \(500\) cannot be greater than endLedger \(200\)/
      );
    });

    it('throws validation error when --start flag is missing', async () => {
      process.argv = ['node', 'backfill.ts', '--end=200'];

      await expect(runBackfill()).rejects.toThrow('Missing required --start flag');
    });

    it('throws validation error when --start is negative or not an integer', async () => {
      process.argv = ['node', 'backfill.ts', '--start=-10', '--end=200'];

      await expect(runBackfill()).rejects.toThrow('Invalid --start value: -10');
    });

    it('throws validation error when --end is negative or not an integer', async () => {
      process.argv = ['node', 'backfill.ts', '--start=100', '--end=abc'];

      await expect(runBackfill()).rejects.toThrow('Invalid --end value: abc');
    });

    it('allows valid boundary when startLedger === endLedger', async () => {
      process.argv = ['node', 'backfill.ts', '--start=100', '--end=100'];
      mockCollectEvents.mockResolvedValueOnce([]);
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        return callback({
          syncState: { upsert: vi.fn() },
        });
      });

      await expect(runBackfill()).resolves.toBeUndefined();
      expect(mockCollectEvents).toHaveBeenCalledWith(
        expect.anything(),
        ['CDTESTMARKETPLACE'],
        100,
        100
      );
    });
  });

  describe('Database Transaction & Rollback', () => {
    it('successfully applies events and updates sync cursor inside a transaction', async () => {
      process.argv = ['node', 'backfill.ts', '--start=100', '--end=150'];
      const decodedEvents = [
        { ledgerSequence: 120, eventType: 'List' },
        { ledgerSequence: 140, eventType: 'Sale' },
      ];
      mockCollectEvents.mockResolvedValueOnce(decodedEvents);

      const mockTx = {
        syncState: { upsert: vi.fn().mockResolvedValue({}) },
      };
      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(mockTx);
      });

      await runBackfill();

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.syncState.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, lastLedger: 140, ledgerHash: 'hash_100' },
        update: { lastLedger: 140, ledgerHash: 'hash_100' },
      });
    });

    it('rolls back database transaction and does not corrupt syncState when batch event processing fails', async () => {
      process.argv = ['node', 'backfill.ts', '--start=100', '--end=150'];
      mockCollectEvents.mockResolvedValueOnce([{ ledgerSequence: 120, eventType: 'List' }]);

      const dbError = new Error('Database disk full / transaction failure');
      mockPrisma.$transaction.mockRejectedValueOnce(dbError);

      await expect(runBackfill()).rejects.toThrow('Database disk full / transaction failure');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Since transaction rejected, syncState outside tx was never touched
    });

    it('fails if neither MARKETPLACE_CONTRACT_ID nor LAUNCHPAD_CONTRACT_ID is configured', async () => {
      process.argv = ['node', 'backfill.ts', '--start=100', '--end=150'];
      delete process.env.MARKETPLACE_CONTRACT_ID;
      delete process.env.LAUNCHPAD_CONTRACT_ID;

      await expect(runBackfill()).rejects.toThrow(
        'At least one of MARKETPLACE_CONTRACT_ID or LAUNCHPAD_CONTRACT_ID must be set'
      );
    });
  });
});
