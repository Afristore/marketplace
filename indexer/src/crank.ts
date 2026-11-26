import {
  rpc,
  Contract,
  TransactionBuilder,
  Keypair,
  Account,
  Operation,
  StrKey,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import prisma from './db.js';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const log = logger.child({ component: 'crank' });

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const MARKETPLACE_CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID;
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID;
const LENDING_CONTRACT_ID = process.env.LENDING_CONTRACT_ID;
const CRANK_SECRET_KEY = process.env.CRANK_SECRET_KEY;
const CRANK_INTERVAL_MS = parseInt(process.env.CRANK_INTERVAL_MS || '300000');
const EXTEND_LEDGERS = 500_000;

export const rpcServer = new rpc.Server(RPC_URL, { allowHttp: false });

export function contractIdToLedgerKey(contractId: string): xdr.LedgerKey {
  const contractBytes = StrKey.decodeContract(contractId);
  const scAddress = xdr.ScAddress.scAddressTypeContract(contractBytes as unknown as xdr.Hash);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: scAddress,
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

// ── Friendbot funding (#1249) ────────────────────────────────────────────────

export const FRIENDBOT_URL = 'https://friendbot-testnet.stellar.org';

export interface FriendbotRetryOptions {
  /** Total attempts including the first (default 5, env FRIENDBOT_MAX_ATTEMPTS). */
  maxAttempts?: number;
  /** Delay before the first retry; doubles each attempt (default 1000 ms). */
  baseDelayMs?: number;
  /** Upper bound for any single delay, including Retry-After (default 30 s). */
  maxDelayMs?: number;
  /** Per-request timeout (default 15 s). */
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; returns [0, 1). */
  random?: () => number;
}

export class FriendbotFundingError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastError?: unknown,
  ) {
    super(message);
    this.name = 'FriendbotFundingError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exponential backoff with full jitter: a random delay in
 * [0, min(maxDelayMs, baseDelayMs * 2^(attempt-1))]. A server-provided
 * Retry-After (seconds) takes precedence, capped at maxDelayMs.
 */
export function friendbotBackoffDelay(
  attempt: number,
  opts: { baseDelayMs: number; maxDelayMs: number; random?: () => number },
  retryAfterHeader?: string | null,
): number {
  const retryAfterSecs = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSecs) && retryAfterSecs >= 0) {
    return Math.min(retryAfterSecs * 1000, opts.maxDelayMs);
  }
  const cap = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor((opts.random ?? Math.random)() * cap);
}

/** 429 (rate limited) and 5xx are transient; other 4xx are not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Friendbot answers 400 with `op_already_exists` when the account is funded. */
function isAlreadyFunded(body: any): boolean {
  const text = JSON.stringify(body ?? '');
  return text.includes('op_already_exists') || text.includes('createAccountAlreadyExist');
}

/**
 * Funds `publicKey` via Testnet Friendbot, retrying timeouts, network errors,
 * 429 and 5xx responses with exponential backoff (#1249). Throws
 * `FriendbotFundingError` once attempts are exhausted or on a non-retryable
 * response.
 */
export async function fundWithFriendbot(
  publicKey: string,
  options: FriendbotRetryOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? parseInt(process.env.FRIENDBOT_MAX_ATTEMPTS || '5', 10),
  );
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryAfter: string | null = null;
    try {
      const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body: any = await res.json().catch(() => null);

      if (res.ok) {
        log.info('Funded ephemeral keypair via Friendbot', { txHash: body?.hash, attempt });
        return;
      }
      if (isAlreadyFunded(body)) {
        log.info('Ephemeral keypair already funded', { publicKey, attempt });
        return;
      }
      if (!isRetryableStatus(res.status)) {
        throw new FriendbotFundingError(
          `Friendbot rejected funding request (HTTP ${res.status})`,
          attempt,
          body,
        );
      }
      retryAfter = res.headers?.get?.('retry-after') ?? null;
      lastError = new Error(`Friendbot responded HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof FriendbotFundingError) {
        log.error('Friendbot funding failed', { publicKey, err: err.message });
        throw err;
      }
      lastError = err; // network error or timeout
    }

    if (attempt < maxAttempts) {
      const delayMs = friendbotBackoffDelay(
        attempt,
        { baseDelayMs, maxDelayMs, random: options.random },
        retryAfter,
      );
      log.warn('Friendbot request failed; retrying', {
        publicKey,
        attempt,
        maxAttempts,
        delayMs,
        err: lastError instanceof Error ? lastError.message : String(lastError),
      });
      await sleep(delayMs);
    }
  }

  log.error('Friendbot funding failed after retries', { publicKey, attempts: maxAttempts });
  throw new FriendbotFundingError(
    `Friendbot funding failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError,
  );
}

export async function ensureCrankKeypair(
  server: rpc.Server = rpcServer,
  friendbot: FriendbotRetryOptions = {},
): Promise<Keypair> {
  const secretKey = process.env.CRANK_SECRET_KEY || CRANK_SECRET_KEY;
  if (secretKey) {
    return Keypair.fromSecret(secretKey);
  }

  const keypair = Keypair.random();
  const pubKey = keypair.publicKey();
  log.info('No CRANK_SECRET_KEY set; generated ephemeral keypair', { publicKey: pubKey });

  try {
    await server.getAccount(pubKey);
    return keypair;
  } catch {
    // Account doesn't exist — fund via Testnet Friendbot
  }

  await fundWithFriendbot(pubKey, friendbot);
  return keypair;
}

/**
 * Most contracts whose TTL is extended by one transaction. A single
 * extendFootprintTtl operation extends every entry in the transaction's
 * read-only footprint, but the network caps the entries a transaction may read
 * (100 on current Stellar networks), so larger lists are split into chunks.
 */
export const TTL_BATCH_SIZE = 25;

export interface TtlBumpResult {
  contractIds: string[];
  success: boolean;
  txHash?: string;
}

/**
 * Extends the instance TTL of every contract in `contractIds` with one
 * transaction per chunk of `batchSize`, instead of one transaction per
 * contract. Empty and duplicate ids are skipped.
 */
export async function bumpContractTtls(
  contractIds: Array<string | null | undefined>,
  crankKeypair: Keypair,
  server: rpc.Server = rpcServer,
  batchSize: number = TTL_BATCH_SIZE,
): Promise<TtlBumpResult[]> {
  const ids = [...new Set(contractIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return [];

  const size = Math.max(1, Math.floor(batchSize));
  const results: TtlBumpResult[] = [];
  for (let i = 0; i < ids.length; i += size) {
    results.push(await submitTtlBatch(ids.slice(i, i + size), crankKeypair, server));
  }
  return results;
}

/** Extends the instance TTL of one contract. Kept for callers that bump a single contract. */
export async function bumpContractTtl(
  contractId: string,
  crankKeypair: Keypair,
  server: rpc.Server = rpcServer,
) {
  if (!contractId) return;
  await bumpContractTtls([contractId], crankKeypair, server);
}

async function submitTtlBatch(
  contractIds: string[],
  crankKeypair: Keypair,
  server: rpc.Server,
): Promise<TtlBumpResult> {
  const failed: TtlBumpResult = { contractIds, success: false };
  try {
    const ledgerKeys: xdr.LedgerKey[] = [];
    for (const contractId of contractIds) {
      try {
        ledgerKeys.push(contractIdToLedgerKey(contractId));
      } catch (err) {
        // One bad address must not stop the rest of the batch from being kept alive.
        log.error('Invalid contract id; skipping TTL bump', { contractId, err });
      }
    }
    if (ledgerKeys.length === 0) return failed;

    const account = await server.getAccount(crankKeypair.publicKey());
    const currentLedger = (await server.getLatestLedger()).sequence;
    const extendTo = currentLedger + EXTEND_LEDGERS;

    const footprint = new xdr.LedgerFootprint({
      readOnly: ledgerKeys,
      readWrite: [],
    });

    const resources = new xdr.SorobanResources({
      footprint,
      instructions: 0,
      diskReadBytes: 0,
      writeBytes: 0,
    });

    const sorobanData = new xdr.SorobanTransactionData({
      ext: new xdr.SorobanTransactionDataExt(0),
      resources,
      resourceFee: xdr.Int64.fromString('0'),
    });

    const tx = new TransactionBuilder(account, {
      fee: '10000',
      networkPassphrase: NETWORK_PASSPHRASE,
      sorobanData,
    })
      .addOperation(Operation.extendFootprintTtl({ extendTo }))
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      log.error('Simulation failed', { contractIds });
      return failed;
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();
    assembled.sign(crankKeypair);

    const submitResult = await server.sendTransaction(assembled);

    if (submitResult.status === 'ERROR') {
      log.error('Submit error', { contractIds, errorResult: submitResult.errorResult });
      return failed;
    }

    // Poll for completion
    let txResult = await server.getTransaction(submitResult.hash);
    while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      txResult = await server.getTransaction(submitResult.hash);
    }

    if (txResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      log.info('TTL bumped', { contracts: ledgerKeys.length, contractIds, extendTo });
      return { contractIds, success: true, txHash: submitResult.hash };
    }
    log.error('TTL bump failed', { contractIds, txResult });
    return failed;
  } catch (err) {
    log.error('Failed to bump TTL', { contractIds, err });
    return failed;
  }
}

// ── Oracle (#1247) ───────────────────────────────────────────────────────────

/** Source account for read-only simulations; it never signs or submits. */
const SIMULATION_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** 7-decimal fixed-point scale used by the lending contract and Reflector. */
export const DECIMAL_SCALE = 10_000_000n;

export interface OraclePriceOptions {
  server?: rpc.Server;
  /** Reject quotes older than this (config.maxPriceStalenessSecs). */
  maxStalenessSecs?: bigint | number;
  nowSecs?: number;
}

/**
 * Reads the USD price (7-decimal fixed point) of `asset` from the configured
 * Soroban Reflector oracle contract, the same call the lending contract makes
 * (`price(asset: Address) -> Option<PriceData>`), via a read-only simulation.
 *
 * Mirrors `oracle::get_price_with_staleness`: returns null when the oracle has
 * no quote, the price is not positive, or the quote is older than
 * `maxStalenessSecs`. Never throws.
 */
export async function fetchOraclePrice(
  asset: string,
  oracleAddress: string,
  options: OraclePriceOptions = {},
): Promise<bigint | null> {
  if (!asset || !oracleAddress) return null;
  const server = options.server || rpcServer;

  try {
    const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, '0'), {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(oracleAddress).call('price', new Address(asset).toScVal()))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      log.warn('Oracle price simulation failed', { asset, oracleAddress });
      return null;
    }

    const quote = scValToNative(sim.result.retval) as
      | { price: bigint | number; timestamp: bigint | number }
      | null
      | undefined;
    if (quote == null) {
      log.warn('Oracle has no price for asset', { asset, oracleAddress });
      return null;
    }

    const price = BigInt(quote.price);
    if (price <= 0n) {
      log.warn('Oracle returned a non-positive price', { asset, price: price.toString() });
      return null;
    }

    if (options.maxStalenessSecs != null) {
      const now = BigInt(options.nowSecs ?? Math.floor(Date.now() / 1000));
      const age = now - BigInt(quote.timestamp);
      if (age > BigInt(options.maxStalenessSecs)) {
        log.warn('Oracle price is stale', {
          asset,
          ageSecs: age.toString(),
          maxStalenessSecs: options.maxStalenessSecs.toString(),
        });
        return null;
      }
    }

    return price;
  } catch (err) {
    log.error('Failed to fetch oracle price', { asset, oracleAddress, err });
    return null;
  }
}

export function calculateHealthFactor(collateralValue: number, loanAmount: number): number {
  if (loanAmount <= 0) return 999; // Edge case: no debt
  return collateralValue / loanAmount;
}

// ── Accrued interest & health factor (#1248) ─────────────────────────────────

/** Converts a stored 7-decimal fixed-point amount (Prisma Decimal/string/number/bigint) to bigint. */
export function toFixedPoint(value: unknown): bigint {
  if (value == null) return 0n;
  if (typeof value === 'bigint') return value;
  let text: string;
  if (typeof value === 'number') {
    text = Math.trunc(value).toString();
  } else if (typeof value === 'object' && typeof (value as any).toFixed === 'function') {
    // Prisma Decimal: toFixed() never uses exponent notation, unlike toString().
    text = (value as any).toFixed();
  } else {
    text = String(value).trim();
  }
  const [whole] = text.split('.');
  return BigInt(whole === '' || whole === '-' ? '0' : whole);
}

/**
 * Port of the lending contract's `accrued_interest_usd`
 * (contracts/lending/src/interest.rs), in 7-decimal fixed-point USD:
 *
 *   elapsed  = min(now - start, maxDuration); days = elapsed / 86400
 *   each full 30-day month m: declared * schedule[min(m, len-1)] / 10_000
 *   partial month: declared * schedule[min(fullMonths, len-1)] / 10_000 * days / 30
 *
 * Integer division matches the contract exactly. Returns 0 before start or
 * for an empty schedule (the contract never stores one).
 */
export function calculateAccruedInterest(
  position: {
    declaredPriceUsd: unknown;
    interestScheduleBps?: number[] | null;
    startTime?: bigint | number | string | null;
    maxDurationSecs?: bigint | number | string | null;
  },
  nowSecs: number | bigint,
): bigint {
  const schedule = position.interestScheduleBps ?? [];
  if (schedule.length === 0 || position.startTime == null) return 0n;

  const now = BigInt(nowSecs);
  const start = BigInt(position.startTime);
  if (now <= start) return 0n;

  const price = toFixedPoint(position.declaredPriceUsd);
  const len = BigInt(schedule.length);
  let elapsed = now - start;
  if (position.maxDurationSecs != null && elapsed > BigInt(position.maxDurationSecs)) {
    elapsed = BigInt(position.maxDurationSecs);
  }
  const elapsedDays = elapsed / 86_400n;
  const fullMonths = elapsedDays / 30n;
  const partialDays = elapsedDays % 30n;

  let total = 0n;
  const scheduledMonths = fullMonths < len - 1n ? fullMonths : len - 1n;
  for (let m = 0n; m < scheduledMonths; m++) {
    total += (price * BigInt(schedule[Number(m)])) / 10_000n;
  }
  const repeatedMonths = fullMonths - scheduledMonths;
  if (repeatedMonths > 0n) {
    total += ((price * BigInt(schedule[schedule.length - 1])) / 10_000n) * repeatedMonths;
  }
  if (partialDays > 0n) {
    const idx = Number(fullMonths < len - 1n ? fullMonths : len - 1n);
    total += (((price * BigInt(schedule[idx])) / 10_000n) * partialDays) / 30n;
  }
  return total;
}

/**
 * Health factor in basis points, computed exactly as the lending contract's
 * `health_factor` / `liquidate`:
 *
 *   collateralUsd = collateralAmount * oraclePrice / 10^7
 *   owedUsd       = declaredPriceUsd + accruedInterest
 *   hfBps         = owedUsd > 0 ? collateralUsd * 10_000 / owedUsd : 10_000
 */
export function calculateHealthFactorBps(
  collateralAmount: bigint,
  oraclePrice: bigint,
  declaredPriceUsd: bigint,
  accruedInterest: bigint,
): bigint {
  const collateralUsd = (collateralAmount * oraclePrice) / DECIMAL_SCALE;
  const owedUsd = declaredPriceUsd + accruedInterest;
  return owedUsd > 0n ? (collateralUsd * 10_000n) / owedUsd : 10_000n;
}

/** Formats basis points as the stored ratio string, e.g. 15000n -> "1.5". */
export function formatHealthFactor(bps: bigint): string {
  const sign = bps < 0n ? '-' : '';
  const abs = bps < 0n ? -bps : bps;
  const whole = abs / 10_000n;
  const frac = (abs % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

export function isPositionOverdue(
  position: { startTime?: bigint | number | string | null; maxDurationSecs?: bigint | number | string | null },
  nowSecs = Math.floor(Date.now() / 1000),
): boolean {
  if (position.startTime == null || position.maxDurationSecs == null) return false;
  return BigInt(position.startTime) + BigInt(position.maxDurationSecs) < BigInt(nowSecs);
}

export interface LiquidationCandidate {
  positionId: bigint;
  reason: 'overdue' | 'unhealthy';
  healthFactor?: string;
  isOverdue: boolean;
  belowThreshold: boolean;
}

export interface LiquidationResult {
  success: boolean;
  positionId: bigint;
  txHash?: string;
  attempts: number;
  error?: string;
}

export async function triggerLiquidation(
  positionId: bigint,
  crankKeypair?: Keypair,
  options?: {
    server?: rpc.Server;
    maxRetries?: number;
    retryDelayMs?: number;
    lendingContractId?: string;
  },
): Promise<LiquidationResult> {
  const contractId =
    options?.lendingContractId || process.env.LENDING_CONTRACT_ID || LENDING_CONTRACT_ID;

  if (!contractId) {
    log.warn('LENDING_CONTRACT_ID not set; skipping liquidation call', {
      positionId: positionId.toString(),
    });
    return {
      success: false,
      positionId,
      attempts: 0,
      error: 'LENDING_CONTRACT_ID not set',
    };
  }

  const server = options?.server || rpcServer;
  const keypair = crankKeypair || (await ensureCrankKeypair(server));
  const maxRetries = options?.maxRetries ?? 3;
  const retryDelayMs = options?.retryDelayMs ?? 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const account = await server.getAccount(keypair.publicKey());
      const contract = new Contract(contractId);

      const tx = new TransactionBuilder(account, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'liquidate',
            nativeToScVal(BigInt(positionId), { type: 'u64' }),
            new Address(keypair.publicKey()).toScVal(),
          ),
        )
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);

      if (!rpc.Api.isSimulationSuccess(simResult)) {
        throw new Error(`Simulation failed: ${JSON.stringify(simResult)}`);
      }

      const assembled = rpc.assembleTransaction(tx, simResult).build();
      assembled.sign(keypair);

      const submitResult = await server.sendTransaction(assembled);

      if (submitResult.status === 'ERROR') {
        throw new Error(`Submit error: ${JSON.stringify(submitResult.errorResult)}`);
      }

      // Poll for completion
      let txResult = await server.getTransaction(submitResult.hash);
      while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
        await new Promise((r) => setTimeout(r, Math.min(retryDelayMs, 1000)));
        txResult = await server.getTransaction(submitResult.hash);
      }

      if (txResult.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(`Transaction failed with status: ${txResult.status}`);
      }

      log.info('Position successfully liquidated', {
        positionId: positionId.toString(),
        txHash: submitResult.hash,
        attempts: attempt,
      });

      return {
        success: true,
        positionId,
        txHash: submitResult.hash,
        attempts: attempt,
      };
    } catch (err: any) {
      log.error('Liquidation attempt failed', {
        positionId: positionId.toString(),
        attempt,
        maxRetries,
        err: err?.message || err,
      });

      if (attempt >= maxRetries) {
        return {
          success: false,
          positionId,
          attempts: attempt,
          error: err?.message || String(err),
        };
      }

      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    success: false,
    positionId,
    attempts: maxRetries,
    error: 'Max retries reached',
  };
}

export async function updatePositionHealthFactors(
  crankKeypair?: Keypair,
  options?: {
    nowSecs?: number;
    server?: rpc.Server;
    maxRetries?: number;
    retryDelayMs?: number;
    lendingContractId?: string;
  },
) {
  try {
    // Snapshot active positions + config atomically so the health pass
    // cannot race with mid-cycle config/position mutations.
    const { positions, config } = await prisma.$transaction(async (tx) => {
      const positions = await tx.lendingPosition.findMany({
        where: { status: 'Active' },
      });
      const config = await tx.lendingConfig.findUnique({
        where: { id: 1 },
      });
      return { positions, config };
    });

    if (!config) {
      log.warn('LendingConfig not found; skipping health factor update');
      return { updates: [], liquidationQueue: [], liquidationResults: [] };
    }

    const now = options?.nowSecs ?? Math.floor(Date.now() / 1000);
    const updates: Array<{ positionId: bigint; healthFactor: string; belowThreshold: boolean }> = [];
    const liquidationQueue: LiquidationCandidate[] = [];

    const server = options?.server || rpcServer;
    // Positions often share a collateral currency; quote each asset once per pass.
    const priceCache = new Map<string, Promise<bigint | null>>();
    const priceFor = (asset: string) => {
      let quote = priceCache.get(asset);
      if (!quote) {
        quote = fetchOraclePrice(asset, config.oracleAddress, {
          server,
          maxStalenessSecs: config.maxPriceStalenessSecs,
          nowSecs: now,
        });
        priceCache.set(asset, quote);
      }
      return quote;
    };

    for (const position of positions) {
      const isOverdue = isPositionOverdue(position, now);

      // The collateral is the borrower's token (collateralCurrency), not the NFT.
      const collateralPrice = await priceFor(position.collateralCurrency);
      let healthFactor: string | null = null;
      let belowThreshold = false;

      if (collateralPrice !== null) {
        // Debt includes accrued interest, as in the contract's liquidate().
        const accrued = calculateAccruedInterest(position, now);
        const hfBps = calculateHealthFactorBps(
          toFixedPoint(position.collateralAmount),
          collateralPrice,
          toFixedPoint(position.declaredPriceUsd),
          accrued,
        );
        healthFactor = formatHealthFactor(hfBps);
        const thresholdBps = position.liquidationThresholdBps || config.minLiqThresholdBps;
        // The contract liquidates when hf_bps <= liquidation_threshold_bps.
        belowThreshold = hfBps <= BigInt(thresholdBps);

        updates.push({
          positionId: position.positionId,
          healthFactor,
          belowThreshold,
        });
      } else {
        log.warn('Could not fetch collateral price', {
          positionId: position.positionId.toString(),
          collateralCurrency: position.collateralCurrency,
        });
      }

      if (isOverdue) {
        liquidationQueue.push({
          positionId: position.positionId,
          reason: 'overdue',
          healthFactor: healthFactor ?? undefined,
          isOverdue: true,
          belowThreshold,
        });
      } else if (belowThreshold) {
        liquidationQueue.push({
          positionId: position.positionId,
          reason: 'unhealthy',
          healthFactor: healthFactor ?? undefined,
          isOverdue: false,
          belowThreshold: true,
        });
      }
    }

    if (updates.length > 0) {
      // Apply all health-factor writes atomically so a mid-loop failure
      // cannot leave only a subset of positions updated.
      await prisma.$transaction(
        updates.map((u) =>
          prisma.lendingPosition.update({
            where: { positionId: u.positionId },
            data: { healthFactor: u.healthFactor },
          }),
        ),
      );

      for (const u of updates) {
        if (u.belowThreshold) {
          log.warn('Position below liquidation threshold', {
            positionId: u.positionId,
            healthFactor: Number(u.healthFactor),
          });
        }
      }
    }

    const liquidationResults: LiquidationResult[] = [];
    const contractId =
      options?.lendingContractId || process.env.LENDING_CONTRACT_ID || LENDING_CONTRACT_ID;

    if (liquidationQueue.length > 0) {
      log.info(`Queued ${liquidationQueue.length} positions for liquidation`, {
        queue: liquidationQueue.map((c) => ({ id: c.positionId.toString(), reason: c.reason })),
      });

      if (contractId) {
        const keypair = crankKeypair || (await ensureCrankKeypair(server));
        for (const candidate of liquidationQueue) {
          const res = await triggerLiquidation(candidate.positionId, keypair, options);
          liquidationResults.push(res);
        }
      } else {
        log.warn('LENDING_CONTRACT_ID not set; positions queued but liquidation not triggered');
      }
    }

    return {
      updates,
      liquidationQueue,
      liquidationResults,
    };
  } catch (err) {
    log.error('Error updating health factors', { err });
    return {
      updates: [],
      liquidationQueue: [],
      liquidationResults: [],
      error: err,
    };
  }
}

export const scanAndLiquidatePositions = updatePositionHealthFactors;

export async function runCrank() {
  log.info('Starting keep-alive bot', { intervalMs: CRANK_INTERVAL_MS });

  const crankKeypair = await ensureCrankKeypair();

  while (true) {
    try {
      log.info('Running TTL extension cycle');

      const recentCollections = await prisma.collection.findMany({
        take: 20,
        orderBy: { deployedAtLedger: 'desc' },
      });

      // One batched transaction for the platform contracts and recent
      // collections, instead of one transaction per contract.
      await bumpContractTtls(
        [
          MARKETPLACE_CONTRACT_ID,
          LAUNCHPAD_CONTRACT_ID,
          ...recentCollections.map((col) => col.contractAddress),
        ],
        crankKeypair,
      );

      await updatePositionHealthFactors(crankKeypair);
    } catch (err) {
      log.error('Error during crank iteration', { err });
    }

    await new Promise((resolve) => setTimeout(resolve, CRANK_INTERVAL_MS));
  }
}

let shuttingDown = false;
export const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('Shutting down');
  prisma.$disconnect().finally(() => {
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.exit(0);
    }
  });
};

if (typeof process !== 'undefined') {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (
    process.argv[1] &&
    (process.argv[1].endsWith('crank.ts') || process.argv[1].endsWith('crank.js')) &&
    !process.env.VITEST
  ) {
    runCrank().catch((err) => {
      log.error('Crank bot failed', { err });
      process.exit(1);
    });
  }
}

