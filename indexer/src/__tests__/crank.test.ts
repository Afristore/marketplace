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
  calculateAccruedInterest,
  calculateHealthFactorBps,
  formatHealthFactor,
  toFixedPoint,
  isPositionOverdue,
  fetchOraclePrice,
  fundWithFriendbot,
  friendbotBackoffDelay,
  FriendbotFundingError,
  contractIdToLedgerKey,
  ensureCrankKeypair,
  bumpContractTtl,
  bumpContractTtls,
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
  Address,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const VALID_LENDING_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const VALID_MARKETPLACE_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 2));
const VALID_LAUNCHPAD_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
const ORACLE_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 4));
const TOKEN_A = StrKey.encodeContract(Buffer.alloc(32, 5));
const TOKEN_B = StrKey.encodeContract(Buffer.alloc(32, 6));
const TOKEN_C = StrKey.encodeContract(Buffer.alloc(32, 7));

/** 7-decimal fixed point, e.g. usd(1.5) === 15_000_000n. */
const usd = (n: number) => BigInt(Math.round(n * 1e7));

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

/** Reflector `PriceData { price: i128, timestamp: u64 }` as returned by the oracle. */
function priceDataScVal(price: bigint, timestamp: bigint) {
  return nativeToScVal(
    { price, timestamp },
    { type: { price: ['symbol', 'i128'], timestamp: ['symbol', 'u64'] } }
  );
}

/** Decodes the contract call in a simulated transaction. */
function decodeInvocation(tx: any) {
  const invoke = tx.operations[0].func.invokeContract();
  return {
    contract: Address.fromScAddress(invoke.contractAddress()).toString(),
    fn: invoke.functionName().toString(),
    args: invoke.args(),
  };
}

/**
 * simulateTransaction mock: answers oracle `price(asset)` calls from `quotes`
 * (asset -> [price, timestamp] or null for "no quote"), and anything else
 * (liquidate, TTL bump) with a plain successful simulation.
 */
function mockOracle(quotes: Record<string, [bigint, bigint] | null>) {
  mockRpcServerInstance.simulateTransaction.mockImplementation((tx: any) => {
    const call = decodeInvocation(tx);
    if (call.fn !== 'price') return Promise.resolve(makeSuccessSimulation());
    const asset = Address.fromScVal(call.args[0]).toString();
    const quote = quotes[asset];
    const sim = makeSuccessSimulation();
    sim.result.retval = quote ? priceDataScVal(quote[0], quote[1]) : xdr.ScVal.scvVoid();
    return Promise.resolve(sim);
  });
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
  describe('fetchOraclePrice (Reflector oracle contract, #1247)', () => {
    it('simulates price(asset) on the configured oracle contract and returns the i128 price', async () => {
      mockOracle({ [TOKEN_A]: [usd(1.5), 1_900n] });

      const price = await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID, {
        maxStalenessSecs: 300,
        nowSecs: 2_000,
      });

      expect(price).toBe(15_000_000n);
      const tx = mockRpcServerInstance.simulateTransaction.mock.calls[0][0];
      const call = decodeInvocation(tx);
      expect(call.contract).toBe(ORACLE_CONTRACT_ID);
      expect(call.fn).toBe('price');
      expect(Address.fromScVal(call.args[0]).toString()).toBe(TOKEN_A);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockRpcServerInstance.sendTransaction).not.toHaveBeenCalled();
    });

    it('returns null when the oracle has no quote (Option::None)', async () => {
      mockOracle({ [TOKEN_A]: null });
      expect(await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID)).toBeNull();
    });

    it('returns null for a non-positive price', async () => {
      mockOracle({ [TOKEN_A]: [0n, 2_000n] });
      expect(await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID)).toBeNull();
    });

    it('returns null when the quote is older than maxStalenessSecs', async () => {
      mockOracle({ [TOKEN_A]: [usd(1), 1_000n] });

      expect(
        await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID, { maxStalenessSecs: 300, nowSecs: 1_301 })
      ).toBeNull();
      expect(
        await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID, { maxStalenessSecs: 300, nowSecs: 1_300 })
      ).toBe(usd(1));
    });

    it('returns null when the simulation reports an error', async () => {
      mockRpcServerInstance.simulateTransaction.mockResolvedValue({ error: 'HostError', events: [] });
      expect(await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID)).toBeNull();
    });

    it('returns null without throwing when the RPC call rejects', async () => {
      mockRpcServerInstance.simulateTransaction.mockRejectedValue(new Error('RPC down'));
      expect(await fetchOraclePrice(TOKEN_A, ORACLE_CONTRACT_ID)).toBeNull();
    });

    it('returns null for a missing or invalid asset / oracle address', async () => {
      expect(await fetchOraclePrice('', ORACLE_CONTRACT_ID)).toBeNull();
      expect(await fetchOraclePrice(TOKEN_A, '')).toBeNull();
      expect(await fetchOraclePrice('NOT_AN_ADDRESS', ORACLE_CONTRACT_ID)).toBeNull();
      expect(mockRpcServerInstance.simulateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('calculateAccruedInterest (port of interest.rs, #1248)', () => {
    // Same vectors as contracts/lending/src/interest.rs tests.
    const base = {
      declaredPriceUsd: '100000000', // 100 USD, 7 decimals
      startTime: 0n,
      maxDurationSecs: BigInt(86400 * 90),
    };
    const day = 86_400;

    it('is zero at or before start', () => {
      expect(calculateAccruedInterest({ ...base, startTime: 1000n, interestScheduleBps: [500] }, 1000)).toBe(0n);
      expect(calculateAccruedInterest({ ...base, startTime: 2000n, interestScheduleBps: [500] }, 1000)).toBe(0n);
    });

    it('matches the contract for partial, full and mixed months', () => {
      const s500 = { ...base, interestScheduleBps: [500] };
      expect(calculateAccruedInterest(s500, 15 * day)).toBe(2_500_000n);
      expect(calculateAccruedInterest(s500, 30 * day)).toBe(5_000_000n);
      expect(calculateAccruedInterest(s500, 35 * day)).toBe(5_833_333n);
    });

    it('switches to the next scheduled rate and repeats the last one', () => {
      const s = { ...base, interestScheduleBps: [500, 800] };
      expect(calculateAccruedInterest(s, 31 * day)).toBe(5_266_666n);
      expect(calculateAccruedInterest(s, 90 * day)).toBe(21_000_000n);
      expect(
        calculateAccruedInterest(
          { ...base, interestScheduleBps: [100, 200], maxDurationSecs: BigInt(day * 30 * 120) },
          day * 30 * 120
        )
      ).toBe(239_000_000n);
    });

    it('stops accruing at maxDurationSecs', () => {
      const s = { ...base, interestScheduleBps: [500] };
      expect(calculateAccruedInterest(s, 120 * day)).toBe(calculateAccruedInterest(s, 90 * day));
    });

    it('accepts Prisma-style Decimal/string amounts and returns 0 for an empty schedule', () => {
      const decimalLike = { toFixed: () => '100000000', toString: () => '1e+8' };
      expect(
        calculateAccruedInterest({ ...base, declaredPriceUsd: decimalLike, interestScheduleBps: [500] }, 30 * day)
      ).toBe(5_000_000n);
      expect(calculateAccruedInterest({ ...base, interestScheduleBps: [] }, 30 * day)).toBe(0n);
    });
  });

  describe('calculateHealthFactorBps / formatHealthFactor (#1248)', () => {
    it('divides collateral USD by principal plus accrued interest', () => {
      // 150 tokens @ 1.0 USD = 150 USD; owed 100 + 25 = 125 -> 1.2 (12000 bps)
      expect(calculateHealthFactorBps(usd(150), usd(1), usd(100), usd(25))).toBe(12_000n);
      // Same position ignoring interest would read 1.5
      expect(calculateHealthFactorBps(usd(150), usd(1), usd(100), 0n)).toBe(15_000n);
    });

    it('returns 10000 bps when nothing is owed', () => {
      expect(calculateHealthFactorBps(usd(1), usd(1), 0n, 0n)).toBe(10_000n);
    });

    it('formats bps as the stored ratio string', () => {
      expect(formatHealthFactor(15_000n)).toBe('1.5');
      expect(formatHealthFactor(10_000n)).toBe('1');
      expect(formatHealthFactor(12_345n)).toBe('1.2345');
      expect(formatHealthFactor(9_999n)).toBe('0.9999');
      expect(formatHealthFactor(0n)).toBe('0');
    });

    it('toFixedPoint parses stored 7-decimal amounts', () => {
      expect(toFixedPoint('150000000')).toBe(150_000_000n);
      expect(toFixedPoint('150000000.0000000')).toBe(150_000_000n);
      expect(toFixedPoint(42)).toBe(42n);
      expect(toFixedPoint(7n)).toBe(7n);
      expect(toFixedPoint(null)).toBe(0n);
    });
  });

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
      oracleAddress: ORACLE_CONTRACT_ID,
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
          collateralCurrency: TOKEN_A,
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
          collateralCurrency: TOKEN_B,
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
          collateralCurrency: TOKEN_C,
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

      // Oracle quotes keyed by collateral currency (7-decimal USD).
      mockOracle({
        [TOKEN_A]: [usd(1.5), 1_900n],
        [TOKEN_B]: [usd(1.0), 1_900n],
        [TOKEN_C]: [usd(1.5), 1_900n],
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
          collateralCurrency: TOKEN_A,
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

      // Oracle has no quote for the collateral
      mockOracle({ [TOKEN_A]: null });

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
          collateralCurrency: TOKEN_A,
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
      mockOracle({ [TOKEN_A]: [usd(1.0), 1_900n] });

      const result = await updatePositionHealthFactors(keypair, {
        nowSecs: 2000,
        lendingContractId: '',
      });

      expect(result.liquidationQueue).toHaveLength(1);
      expect(result.liquidationResults).toHaveLength(0);
      expect(mockRpcServerInstance.sendTransaction).not.toHaveBeenCalled();
    });

    it('includes accrued interest in debt and flags a position that is only unhealthy with interest (#1248)', async () => {
      const day = 86_400;
      const start = 1_000_000;
      const now = start + 60 * day; // two full months
      // 125 tokens @ 1.0 = 125 USD collateral; principal 100 USD; 10%/month.
      // Principal-only HF = 1.25 (> 1.2 threshold); with 20 USD interest HF = 125/120 ≈ 1.0416.
      const position = {
        positionId: 7n,
        nftContract: 'C_NFT_7',
        collateralCurrency: TOKEN_A,
        collateralAmount: usd(125).toString(),
        declaredPriceUsd: usd(100).toString(),
        interestScheduleBps: [1_000],
        liquidationThresholdBps: 12_000,
        startTime: BigInt(start),
        maxDurationSecs: BigInt(90 * day),
        status: 'Active',
      };
      mockTx.lendingPosition.findMany.mockResolvedValue([position]);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);
      mockPrisma.lendingPosition.update.mockResolvedValue({});
      mockOracle({ [TOKEN_A]: [usd(1.0), BigInt(now - 10)] });

      expect(calculateAccruedInterest(position, now)).toBe(usd(20));
      const result = await updatePositionHealthFactors(keypair, { nowSecs: now, retryDelayMs: 1 });

      expect(result.updates).toEqual([
        { positionId: 7n, healthFactor: '1.0416', belowThreshold: true },
      ]);
      expect(result.liquidationQueue).toEqual([
        {
          positionId: 7n,
          reason: 'unhealthy',
          healthFactor: '1.0416',
          isOverdue: false,
          belowThreshold: true,
        },
      ]);
      expect(mockPrisma.lendingPosition.update).toHaveBeenCalledWith({
        where: { positionId: 7n },
        data: { healthFactor: '1.0416' },
      });
    });

    it('treats a health factor exactly at the threshold as liquidatable, like the contract', async () => {
      const position = {
        positionId: 8n,
        nftContract: 'C_NFT_8',
        collateralCurrency: TOKEN_A,
        collateralAmount: usd(120).toString(),
        declaredPriceUsd: usd(100).toString(),
        interestScheduleBps: [500],
        liquidationThresholdBps: 12_000,
        startTime: 2_000n, // no time elapsed -> no interest
        maxDurationSecs: 100_000n,
        status: 'Active',
      };
      mockTx.lendingPosition.findMany.mockResolvedValue([position]);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig);
      mockPrisma.lendingPosition.update.mockResolvedValue({});
      mockOracle({ [TOKEN_A]: [usd(1.0), 1_990n] });

      const result = await updatePositionHealthFactors(keypair, { nowSecs: 2_000, retryDelayMs: 1 });

      expect(result.updates).toEqual([{ positionId: 8n, healthFactor: '1.2', belowThreshold: true }]);
      expect(result.liquidationQueue[0].reason).toBe('unhealthy');
    });

    it('skips the health update for a stale oracle quote and queries each asset once', async () => {
      const mk = (id: bigint) => ({
        positionId: id,
        nftContract: `C_NFT_${id}`,
        collateralCurrency: TOKEN_A,
        collateralAmount: usd(100).toString(),
        declaredPriceUsd: usd(100).toString(),
        interestScheduleBps: [500],
        liquidationThresholdBps: 12_000,
        startTime: 1_000n,
        maxDurationSecs: 100_000n,
        status: 'Active',
      });
      mockTx.lendingPosition.findMany.mockResolvedValue([mk(10n), mk(11n)]);
      mockTx.lendingConfig.findUnique.mockResolvedValue(mockConfig); // staleness 3600s
      mockOracle({ [TOKEN_A]: [usd(1.0), 1_000n] });

      const result = await updatePositionHealthFactors(keypair, { nowSecs: 1_000 + 3_601 });

      expect(result.updates).toEqual([]);
      expect(result.liquidationQueue).toEqual([]);
      const priceCalls = mockRpcServerInstance.simulateTransaction.mock.calls.filter(
        ([tx]: any[]) => decodeInvocation(tx).fn === 'price'
      );
      expect(priceCalls).toHaveLength(1);
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

    it('ensureCrankKeypair retries a rate-limited Friendbot and then succeeds (#1249)', async () => {
      delete process.env.CRANK_SECRET_KEY;
      mockRpcServerInstance.getAccount.mockRejectedValueOnce(new Error('Account not found'));
      const sleep = vi.fn().mockResolvedValue(undefined);
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '2' }),
          json: async () => ({ detail: 'rate limited' }),
        })
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ hash: 'h' }) });

      const kp = await ensureCrankKeypair(undefined, { sleep, random: () => 0.5, baseDelayMs: 100 });

      expect(kp.publicKey()).toMatch(/^G/);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      // 1st retry honours Retry-After (2s); 2nd uses jittered backoff 0.5 * 100 * 2^1.
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([2_000, 100]);
    });
  });

  describe('fundWithFriendbot (#1249)', () => {
    const PUB = Keypair.random().publicKey();

    it('passes a timeout signal and URL-encodes the address', async () => {
      (global.fetch as any).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

      await fundWithFriendbot(PUB, { sleep: vi.fn() });

      const [url, init] = (global.fetch as any).mock.calls[0];
      expect(url).toBe(`https://friendbot-testnet.stellar.org?addr=${PUB}`);
      expect(init.method).toBe('GET');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('throws FriendbotFundingError after maxAttempts transient failures', async () => {
      const sleep = vi.fn().mockResolvedValue(undefined);
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({}),
      });

      const err = await fundWithFriendbot(PUB, { maxAttempts: 4, sleep, random: () => 1 }).catch(
        (e) => e
      );

      expect(err).toBeInstanceOf(FriendbotFundingError);
      expect(err.attempts).toBe(4);
      expect(global.fetch).toHaveBeenCalledTimes(4);
      // Exponential: 1s, 2s, 4s (random = 1 → full cap), no sleep after the last attempt.
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([1_000, 2_000, 4_000]);
    });

    it('does not retry a non-retryable 4xx', async () => {
      const sleep = vi.fn();
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ detail: 'invalid address' }),
      });

      await expect(fundWithFriendbot(PUB, { sleep })).rejects.toBeInstanceOf(FriendbotFundingError);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('treats "account already exists" as success', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ extras: { result_codes: { operations: ['op_already_exists'] } } }),
      });

      await expect(fundWithFriendbot(PUB, { sleep: vi.fn() })).resolves.toBeUndefined();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('friendbotBackoffDelay caps exponential growth and Retry-After at maxDelayMs', () => {
      const opts = { baseDelayMs: 1_000, maxDelayMs: 5_000, random: () => 1 };
      expect(friendbotBackoffDelay(1, opts)).toBe(1_000);
      expect(friendbotBackoffDelay(3, opts)).toBe(4_000);
      expect(friendbotBackoffDelay(10, opts)).toBe(5_000);
      expect(friendbotBackoffDelay(1, opts, '60')).toBe(5_000);
      expect(friendbotBackoffDelay(1, { ...opts, random: () => 0 })).toBe(0);
    });
  });

  describe('bumpContractTtl', () => {
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

    it('bumpContractTtls extends many contracts with one transaction', async () => {
      const ids = Array.from({ length: 20 }, (_, i) => StrKey.encodeContract(Buffer.alloc(32, i + 10)));

      const results = await bumpContractTtls(ids, Keypair.random());

      expect(mockRpcServerInstance.simulateTransaction).toHaveBeenCalledTimes(1);
      expect(mockRpcServerInstance.sendTransaction).toHaveBeenCalledTimes(1);
      expect(results).toEqual([{ contractIds: ids, success: true, txHash: 'tx_hash_12345' }]);

      const built = mockRpcServerInstance.simulateTransaction.mock.calls[0][0];
      expect(built.operations).toHaveLength(1);
      expect(built.operations[0].type).toBe('extendFootprintTtl');
      const readOnly = built.toEnvelope().v1().tx().ext().sorobanData().resources().footprint().readOnly();
      expect(readOnly).toHaveLength(20);
    });

    it('bumpContractTtls splits large lists into chunks of batchSize', async () => {
      const ids = Array.from({ length: 5 }, (_, i) => StrKey.encodeContract(Buffer.alloc(32, i + 40)));

      const results = await bumpContractTtls(ids, Keypair.random(), undefined, 2);

      expect(mockRpcServerInstance.sendTransaction).toHaveBeenCalledTimes(3);
      expect(results.map((r) => r.contractIds.length)).toEqual([2, 2, 1]);
    });

    it('bumpContractTtls skips empty and duplicate ids and does nothing for an empty list', async () => {
      expect(await bumpContractTtls([undefined, '', null], Keypair.random())).toEqual([]);
      expect(mockRpcServerInstance.getAccount).not.toHaveBeenCalled();

      const results = await bumpContractTtls(
        [VALID_MARKETPLACE_CONTRACT_ID, VALID_MARKETPLACE_CONTRACT_ID, VALID_LAUNCHPAD_CONTRACT_ID],
        Keypair.random(),
      );
      expect(results[0].contractIds).toEqual([VALID_MARKETPLACE_CONTRACT_ID, VALID_LAUNCHPAD_CONTRACT_ID]);
    });

    it('bumpContractTtls keeps the valid contracts in a batch with an invalid id', async () => {
      await bumpContractTtls(['not-a-contract', VALID_MARKETPLACE_CONTRACT_ID], Keypair.random());

      const built = mockRpcServerInstance.simulateTransaction.mock.calls[0][0];
      const readOnly = built.toEnvelope().v1().tx().ext().sorobanData().resources().footprint().readOnly();
      expect(readOnly).toHaveLength(1);
    });

    it('bumpContractTtls reports a failed batch without throwing', async () => {
      mockRpcServerInstance.simulateTransaction.mockResolvedValueOnce({ error: 'boom' });

      const results = await bumpContractTtls([VALID_MARKETPLACE_CONTRACT_ID], Keypair.random());

      expect(results).toEqual([{ contractIds: [VALID_MARKETPLACE_CONTRACT_ID], success: false }]);
      expect(mockRpcServerInstance.sendTransaction).not.toHaveBeenCalled();
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
