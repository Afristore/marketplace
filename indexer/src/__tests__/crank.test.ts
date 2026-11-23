import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent dotenv from loading actual environment variables
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// Hoisted mocks for Prisma, RPC Server, and Logger
const { mockPrisma, mockTx, mockRpcServerInstance, mockLogger } = vi.hoisted(() => {
  const mockTx = {
    lendingPosition: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    lendingConfig: {
      findUnique: vi.fn(),
    },
    collection: {
      findMany: vi.fn(),
    },
  };

  const mockPrisma = {
    $transaction: vi.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(mockTx);
      }
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg;
    }),
    lendingPosition: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    lendingConfig: {
      findUnique: vi.fn(),
    },
    collection: {
      findMany: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };

  const mockRpcServerInstance = {
    getAccount: vi.fn(),
    getLatestLedger: vi.fn(),
    simulateTransaction: vi.fn(),
    sendTransaction: vi.fn(),
    getTransaction: vi.fn(),
  };

  const mockLogger = {
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  };

  return { mockPrisma, mockTx, mockRpcServerInstance, mockLogger };
});

vi.mock('../db.js', () => ({ default: mockPrisma }));
vi.mock('../logger.js', () => ({ logger: mockLogger }));

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();

  class MockRpcServer {
    getAccount = mockRpcServerInstance.getAccount;
    getLatestLedger = mockRpcServerInstance.getLatestLedger;
    simulateTransaction = mockRpcServerInstance.simulateTransaction;
    sendTransaction = mockRpcServerInstance.sendTransaction;
    getTransaction = mockRpcServerInstance.getTransaction;
  }

  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: MockRpcServer,
    },
  };
});

import {
  calculateHealthFactor,
  isPositionOverdue,
  fetchOraclePrice,
  contractIdToLedgerKey,
  ensureCrankKeypair,
  bumpContractTtl,
  triggerLiquidation,
  updatePositionHealthFactors,
  scanAndLiquidatePositions,
  shutdown,
} from '../crank.js';
import {
  Keypair,
  rpc,
  StrKey,
  Account,
  xdr,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk';

const VALID_LENDING_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const VALID_MARKETPLACE_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const VALID_LAUNCHPAD_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));

function makeSuccessSimulation() {
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: xdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, 1) as unknown as xdr.Hash),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
  const footprint = new xdr.LedgerFootprint({ readOnly: [ledgerKey], readWrite: [] });
  const resources = new xdr.SorobanResources({
    footprint,
    instructions: 100,
    diskReadBytes: 100,
    writeBytes: 100,
  });
  const sorobanData = new xdr.SorobanTransactionData({
    ext: new xdr.SorobanTransactionDataExt(0),
    resources,
    resourceFee: xdr.Int64.fromString('100'),
  });

  return {
    _parsed: true,
    transactionData: new SorobanDataBuilder(sorobanData),
    minResourceFee: '100',
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  };
}

describe('Indexer crank.ts - Liquidation Scanning and Health Factor Detection', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.LENDING_CONTRACT_ID = VALID_LENDING_CONTRACT_ID;
    process.env.MARKETPLACE_CONTRACT_ID = VALID_MARKETPLACE_CONTRACT_ID;
    process.env.LAUNCHPAD_CONTRACT_ID = VALID_LAUNCHPAD_CONTRACT_ID;

    // Default mock implementations
    mockRpcServerInstance.getAccount.mockImplementation((pubKey: string) => {
      return Promise.resolve(new Account(pubKey, '100'));
    });
    mockRpcServerInstance.getLatestLedger.mockResolvedValue({ sequence: 50000 });
    mockRpcServerInstance.simulateTransaction.mockImplementation(() =>
      Promise.resolve(makeSuccessSimulation())
    );
    mockRpcServerInstance.sendTransaction.mockResolvedValue({
      status: 'PENDING',
      hash: 'tx_hash_12345',
    });
    mockRpcServerInstance.getTransaction.mockResolvedValue({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    });

    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Health Factor Math & Detection
  // ─────────────────────────────────────────────────────────────────────────────
  describe('calculateHealthFactor', () => {
    it('calculates collateralValue / loanAmount correctly', () => {
      // 150 collateral / 100 loan = 1.5
      expect(calculateHealthFactor(150, 100)).toBe(1.5);
      // 110 collateral / 100 loan = 1.1
      expect(calculateHealthFactor(110, 100)).toBeCloseTo(1.1);
      // 80 collateral / 100 loan = 0.8 (undercollateralized)
      expect(calculateHealthFactor(80, 100)).toBe(0.8);
    });

    it('returns 999 when loan amount is zero (no debt edge-case)', () => {
      expect(calculateHealthFactor(150, 0)).toBe(999);
    });

    it('returns 999 when loan amount is negative', () => {
      expect(calculateHealthFactor(150, -10)).toBe(999);
    });

    it('returns 0 when collateral value is zero and loan amount is positive', () => {
      expect(calculateHealthFactor(0, 100)).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Overdue Position Detection
  // ─────────────────────────────────────────────────────────────────────────────
  describe('isPositionOverdue', () => {
    it('returns true when current timestamp exceeds startTime + maxDurationSecs', () => {
      const position = {
        startTime: 1000n,
        maxDurationSecs: 500n,
      };
      // Expires at 1500, now is 1501
      expect(isPositionOverdue(position, 1501)).toBe(true);
      expect(isPositionOverdue(position, 2000)).toBe(true);
    });

    it('returns false when current timestamp is before or equal to expiration', () => {
      const position = {
        startTime: 1000n,
        maxDurationSecs: 500n,
      };
      // Expires at 1500, now is 1499
      expect(isPositionOverdue(position, 1499)).toBe(false);
      // Exact boundary: 1500 is not > 1500
      expect(isPositionOverdue(position, 1500)).toBe(false);
    });

    it('supports number and string types for startTime and maxDurationSecs', () => {
      const positionWithNumbers = { startTime: 1000, maxDurationSecs: 500 };
      expect(isPositionOverdue(positionWithNumbers, 1600)).toBe(true);

      const positionWithStrings = { startTime: '1000', maxDurationSecs: '500' };
      expect(isPositionOverdue(positionWithStrings, 1600)).toBe(true);
      expect(isPositionOverdue(positionWithStrings, 1400)).toBe(false);
    });

    it('returns false when startTime or maxDurationSecs is missing or null', () => {
      expect(isPositionOverdue({ startTime: null, maxDurationSecs: 500n }, 1600)).toBe(false);
      expect(isPositionOverdue({ startTime: 1000n, maxDurationSecs: null }, 1600)).toBe(false);
      expect(isPositionOverdue({ startTime: undefined, maxDurationSecs: undefined }, 1600)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Oracle Price Fetching
  // ─────────────────────────────────────────────────────────────────────────────
  describe('fetchOraclePrice', () => {
    it('fetches price successfully from explorer API', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ price: 2.75 }),
      });

      const price = await fetchOraclePrice('C_TEST_NFT_CONTRACT');
      expect(price).toBe(2.75);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.stellar.expert/explorer/api/v2/asset/C_TEST_NFT_CONTRACT'
      );
    });

    it('returns null if response is not ok', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
      });

      const price = await fetchOraclePrice('C_UNKNOWN_TOKEN');
      expect(price).toBeNull();
    });

    it('returns null if response does not contain price field', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ supply: 1000 }),
      });

      const price = await fetchOraclePrice('C_NO_PRICE_TOKEN');
      expect(price).toBeNull();
    });

    it('catches network error and returns null without throwing', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const price = await fetchOraclePrice('C_ERROR_TOKEN');
      expect(price).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Liquidation Trigger & Transaction Retries
  // ─────────────────────────────────────────────────────────────────────────────
  describe('triggerLiquidation', () => {
    const keypair = Keypair.random();

    it('returns error when LENDING_CONTRACT_ID is not configured', async () => {
      delete process.env.LENDING_CONTRACT_ID;

      const result = await triggerLiquidation(101n, keypair, {
        lendingContractId: '',
        retryDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('LENDING_CONTRACT_ID not set');
      expect(result.attempts).toBe(0);
    });

    it('successfully triggers liquidation on first attempt', async () => {
      mockRpcServerInstance.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_success_1',
      });
      mockRpcServerInstance.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      });

      const result = await triggerLiquidation(101n, keypair, {
        retryDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.positionId).toBe(101n);
      expect(result.txHash).toBe('tx_hash_success_1');
      expect(result.attempts).toBe(1);
      expect(mockRpcServerInstance.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('retries when simulation fails and succeeds on next attempt', async () => {
      // First simulation fails (e.g. temporary RPC state sync lag)
      mockRpcServerInstance.simulateTransaction
        .mockResolvedValueOnce({
          error: 'RPC simulation temporary failure',
        })
        .mockResolvedValueOnce(makeSuccessSimulation());

      mockRpcServerInstance.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_retry_sim',
      });
      mockRpcServerInstance.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      });

      const result = await triggerLiquidation(102n, keypair, {
        maxRetries: 3,
        retryDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.txHash).toBe('tx_hash_retry_sim');
      expect(mockRpcServerInstance.simulateTransaction).toHaveBeenCalledTimes(2);
    });

    it('retries when sendTransaction returns ERROR status and succeeds on subsequent attempt', async () => {
      // First send returns ERROR status
      mockRpcServerInstance.sendTransaction
        .mockResolvedValueOnce({
          status: 'ERROR',
          errorResult: 'tx_bad_seq',
        })
        .mockResolvedValueOnce({
          status: 'PENDING',
          hash: 'tx_hash_recovered',
        });

      mockRpcServerInstance.getTransaction.mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      });

      const result = await triggerLiquidation(103n, keypair, {
        maxRetries: 3,
        retryDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.txHash).toBe('tx_hash_recovered');
      expect(mockRpcServerInstance.sendTransaction).toHaveBeenCalledTimes(2);
    });

    it('retries when getTransaction returns FAILED status and succeeds on subsequent attempt', async () => {
      mockRpcServerInstance.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_poll_fail',
      });

      // Attempt 1: Tx poll reports FAILED
      // Attempt 2: Tx poll reports SUCCESS
      mockRpcServerInstance.getTransaction
        .mockResolvedValueOnce({
          status: rpc.Api.GetTransactionStatus.FAILED,
        })
        .mockResolvedValueOnce({
          status: rpc.Api.GetTransactionStatus.SUCCESS,
        });

      const result = await triggerLiquidation(104n, keypair, {
        maxRetries: 3,
        retryDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('polls while transaction status is NOT_FOUND until confirmed', async () => {
      mockRpcServerInstance.sendTransaction.mockResolvedValue({
        status: 'PENDING',
        hash: 'tx_hash_pending_poll',
      });

      mockRpcServerInstance.getTransaction
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.NOT_FOUND })
        .mockResolvedValueOnce({ status: rpc.Api.GetTransactionStatus.SUCCESS });

      const result = await triggerLiquidation(105n, keypair, {
        retryDelayMs: 1,
      });

      expect(result.success).toBe(true);
      expect(mockRpcServerInstance.getTransaction).toHaveBeenCalledTimes(3);
    });

    it('exhausts all retries and returns failure result if all attempts fail', async () => {
      mockRpcServerInstance.simulateTransaction.mockRejectedValue(
        new Error('Permanent contract failure: position already liquidated')
      );

      const result = await triggerLiquidation(106n, keypair, {
        maxRetries: 3,
        retryDelayMs: 1,
      });

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('Permanent contract failure');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Liquidation Scanning & Health Factor Updates Integration
  // ─────────────────────────────────────────────────────────────────────────────
  describe('updatePositionHealthFactors & scanAndLiquidatePositions', () => {
    const keypair = Keypair.random();
    const mockConfig = {
      id: 1,
      admin: 'G_ADMIN',
      feeReceiver: 'G_RECEIVER',
      platformFeeBps: 100,
      liquidatorFeeBps: 500,
      minBufferBps: 2000,
      maxBufferBps: 5000,
      minLiqThresholdBps: 12000, // 120% = 1.20 minimum liquidation threshold
      maxLiqThresholdBps: 15000,
      oracleAddress: 'C_ORACLE',
      maxPriceStalenessSecs: 3600n,
      updatedAtLedger: 1000,
    };

    it('skips scan and warns when LendingConfig record does not exist', async () => {
      mockTx.lendingPosition.findMany.mockResolvedValue([]);
      mockTx.lendingConfig.findUnique.mockResolvedValue(null);

      const result = await updatePositionHealthFactors(keypair);

      expect(result.updates).toEqual([]);
      expect(result.liquidationQueue).toEqual([]);
      expect(result.liquidationResults).toEqual([]);
    });

    it('correctly scans active positions, identifies unhealthy ones, updates DB, and triggers liquidation', async () => {
      const activePositions = [
        // Position 1: Healthy (HF = 1.5, threshold = 1.2)
        {
          positionId: 1n,
          nftContract: 'C_NFT_1',
          collateralAmount: '100',
          declaredPriceUsd: '100',
          liquidationThresholdBps: 12000,
          startTime: 1000n,
          maxDurationSecs: 100000n, // Not expired
          status: 'Active',
        },
        // Position 2: Unhealthy (HF = 1.0 < 1.25 position threshold) -> Eligible for liquidation
        {
          positionId: 2n,
          nftContract: 'C_NFT_2',
          collateralAmount: '100',
          declaredPriceUsd: '100',
          liquidationThresholdBps: 12500,
          startTime: 1000n,
          maxDurationSecs: 100000n, // Not expired
          status: 'Active',
        },
        // Position 3: Overdue (Expired, even though HF = 1.5) -> Eligible for liquidation
        {
          positionId: 3n,
          nftContract: 'C_NFT_3',
          collateralAmount: '100',
          declaredPriceUsd: '100',
          liquidationThresholdBps: 12000,
          startTime: 1000n,
          maxDurationSecs: 500n, // Expired at 1500; now is 2000
          status: 'Active',
        },
      ];

      mockTx.lendingPosition.findMany.mockResolvedValue(activePositions);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);
      mockPrisma.lendingPosition.update.mockResolvedValue({});

      // Mock Oracle responses
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('C_NFT_1')) {
          return Promise.resolve({ ok: true, json: async () => ({ price: 1.5 }) });
        }
        if (url.includes('C_NFT_2')) {
          return Promise.resolve({ ok: true, json: async () => ({ price: 1.0 }) });
        }
        if (url.includes('C_NFT_3')) {
          return Promise.resolve({ ok: true, json: async () => ({ price: 1.5 }) });
        }
        return Promise.resolve({ ok: false });
      });

      const result = await updatePositionHealthFactors(keypair, {
        nowSecs: 2000,
        retryDelayMs: 1,
      });

      // 1. Check database updates
      expect(result.updates).toHaveLength(3);
      expect(result.updates).toEqual([
        { positionId: 1n, healthFactor: '1.5', belowThreshold: false },
        { positionId: 2n, healthFactor: '1', belowThreshold: true },
        { positionId: 3n, healthFactor: '1.5', belowThreshold: false },
      ]);

      // 2. Check liquidation queue: Position 2 (unhealthy) and Position 3 (overdue)
      expect(result.liquidationQueue).toHaveLength(2);
      expect(result.liquidationQueue).toEqual([
        {
          positionId: 2n,
          reason: 'unhealthy',
          healthFactor: '1',
          isOverdue: false,
          belowThreshold: true,
        },
        {
          positionId: 3n,
          reason: 'overdue',
          healthFactor: '1.5',
          isOverdue: true,
          belowThreshold: false,
        },
      ]);

      // 3. Verify liquidations were triggered on-chain via Soroban RPC
      expect(result.liquidationResults).toHaveLength(2);
      expect(result.liquidationResults[0].success).toBe(true);
      expect(result.liquidationResults[0].positionId).toBe(2n);
      expect(result.liquidationResults[1].success).toBe(true);
      expect(result.liquidationResults[1].positionId).toBe(3n);
    });

    it('queues overdue position even if oracle price fetch fails', async () => {
      const activePositions = [
        {
          positionId: 4n,
          nftContract: 'C_NFT_ORACLE_FAIL',
          collateralAmount: '100',
          declaredPriceUsd: '100',
          liquidationThresholdBps: 12000,
          startTime: 1000n,
          maxDurationSecs: 500n, // Expired at 1500, now is 2000
          status: 'Active',
        },
      ];

      mockTx.lendingPosition.findMany.mockResolvedValue(activePositions);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);

      // Oracle fetch fails
      (global.fetch as any).mockResolvedValue({ ok: false });

      const result = await scanAndLiquidatePositions(keypair, {
        nowSecs: 2000,
        retryDelayMs: 1,
      });

      expect(result.updates).toHaveLength(0); // No price update
      expect(result.liquidationQueue).toHaveLength(1);
      expect(result.liquidationQueue[0]).toEqual({
        positionId: 4n,
        reason: 'overdue',
        healthFactor: undefined,
        isOverdue: true,
        belowThreshold: false,
      });
      expect(result.liquidationResults[0].success).toBe(true);
    });

    it('skips liquidation trigger call when LENDING_CONTRACT_ID is empty but keeps positions in queue', async () => {
      delete process.env.LENDING_CONTRACT_ID;

      const activePositions = [
        {
          positionId: 5n,
          nftContract: 'C_NFT_5',
          collateralAmount: '100',
          declaredPriceUsd: '100',
          liquidationThresholdBps: 12000,
          startTime: 1000n,
          maxDurationSecs: 200n,
          status: 'Active',
        },
      ];

      mockTx.lendingPosition.findMany.mockResolvedValue(activePositions);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ price: 1.0 }),
      });

      const result = await updatePositionHealthFactors(keypair, {
        nowSecs: 2000,
        lendingContractId: '',
      });

      expect(result.liquidationQueue).toHaveLength(1);
      expect(result.liquidationResults).toHaveLength(0);
      expect(mockRpcServerInstance.sendTransaction).not.toHaveBeenCalled();
    });

    it('handles empty active positions list gracefully', async () => {
      mockTx.lendingPosition.findMany.mockResolvedValue([]);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await updatePositionHealthFactors(keypair);

      expect(result.updates).toEqual([]);
      expect(result.liquidationQueue).toEqual([]);
      expect(result.liquidationResults).toEqual([]);
    });

    it('catches database error and returns empty structures with error object', async () => {
      mockTx.lendingPosition.findMany.mockRejectedValue(new Error('DB Connection lost'));

      const result = await updatePositionHealthFactors(keypair);

      expect(result.updates).toEqual([]);
      expect(result.liquidationQueue).toEqual([]);
      expect(result.liquidationResults).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Contract TTL Bumping & Ephemeral Keypair
  // ─────────────────────────────────────────────────────────────────────────────
  describe('bumpContractTtl & ensureCrankKeypair', () => {
    it('ensureCrankKeypair loads from CRANK_SECRET_KEY if provided', async () => {
      const testKp = Keypair.random();
      process.env.CRANK_SECRET_KEY = testKp.secret();

      const kp = await ensureCrankKeypair();
      expect(kp.publicKey()).toBe(testKp.publicKey());
    });

    it('ensureCrankKeypair generates ephemeral keypair and funds via Friendbot if account not found', async () => {
      delete process.env.CRANK_SECRET_KEY;
      mockRpcServerInstance.getAccount.mockRejectedValueOnce(new Error('Account not found'));
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ hash: 'friendbot_tx_hash' }),
      });

      const kp = await ensureCrankKeypair();
      expect(kp.publicKey()).toBeDefined();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://friendbot-testnet.stellar.org?addr='),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('bumpContractTtl skips when contractId is empty', async () => {
      await bumpContractTtl('', Keypair.random());
      expect(mockRpcServerInstance.getAccount).not.toHaveBeenCalled();
    });

    it('bumpContractTtl sends extendFootprintTtl transaction and polls until SUCCESS', async () => {
      await bumpContractTtl(
        VALID_MARKETPLACE_CONTRACT_ID,
        Keypair.random()
      );

      expect(mockRpcServerInstance.simulateTransaction).toHaveBeenCalled();
      expect(mockRpcServerInstance.sendTransaction).toHaveBeenCalled();
      expect(mockRpcServerInstance.getTransaction).toHaveBeenCalledWith('tx_hash_12345');
    });

    it('contractIdToLedgerKey produces valid xdr.LedgerKey', () => {
      const key = contractIdToLedgerKey(VALID_LAUNCHPAD_CONTRACT_ID);
      expect(key).toBeDefined();
      expect(key.switch().name).toBe('contractData');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Graceful Shutdown
  // ─────────────────────────────────────────────────────────────────────────────
  describe('shutdown', () => {
    it('disconnects Prisma on shutdown', async () => {
      shutdown();
      expect(mockPrisma.$disconnect).toHaveBeenCalled();
    });
  });
});
