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

export async function ensureCrankKeypair(server: rpc.Server = rpcServer): Promise<Keypair> {
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

  try {
    const res = await fetch(`https://friendbot-testnet.stellar.org?addr=${pubKey}`, {
      method: 'GET',
    });
    const body: any = await res.json();
    if (body?.hash) {
      log.info('Funded ephemeral keypair via Friendbot', { txHash: body.hash });
    }
  } catch (err) {
    log.error('Friendbot funding failed', { publicKey: pubKey, err });
    throw err;
  }

  return keypair;
}

export async function bumpContractTtl(
  contractId: string,
  crankKeypair: Keypair,
  server: rpc.Server = rpcServer,
) {
  if (!contractId) return;

  try {
    const account = await server.getAccount(crankKeypair.publicKey());
    const currentLedger = (await server.getLatestLedger()).sequence;
    const extendTo = currentLedger + EXTEND_LEDGERS;

    const ledgerKey = contractIdToLedgerKey(contractId);

    const footprint = new xdr.LedgerFootprint({
      readOnly: [ledgerKey],
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
      log.error('Simulation failed', { contractId });
      return;
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();
    assembled.sign(crankKeypair);

    const submitResult = await server.sendTransaction(assembled);

    if (submitResult.status === 'ERROR') {
      log.error('Submit error', { contractId, errorResult: submitResult.errorResult });
      return;
    }

    // Poll for completion
    let txResult = await server.getTransaction(submitResult.hash);
    while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      txResult = await server.getTransaction(submitResult.hash);
    }

    if (txResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      log.info('TTL bumped', { contractId, extendTo });
    } else {
      log.error('TTL bump failed', { contractId, txResult });
    }
  } catch (err) {
    log.error('Failed to bump TTL', { contractId, err });
  }
}

export async function fetchOraclePrice(token: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.stellar.expert/explorer/api/v2/asset/${token}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.price || null;
  } catch (err) {
    log.error('Failed to fetch oracle price', { token, err });
    return null;
  }
}

export function calculateHealthFactor(collateralValue: number, loanAmount: number): number {
  if (loanAmount <= 0) return 999; // Edge case: no debt
  return collateralValue / loanAmount;
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

    for (const position of positions) {
      const isOverdue = isPositionOverdue(position, now);

      const collateralPrice = await fetchOraclePrice(position.nftContract);
      let healthFactor: number | null = null;
      let belowThreshold = false;

      if (collateralPrice !== null) {
        const collateralValue = collateralPrice * Number(position.collateralAmount);
        healthFactor = calculateHealthFactor(collateralValue, Number(position.declaredPriceUsd));
        const thresholdBps = position.liquidationThresholdBps || config.minLiqThresholdBps;
        belowThreshold = healthFactor < thresholdBps / 10000;

        updates.push({
          positionId: position.positionId,
          healthFactor: healthFactor.toString(),
          belowThreshold,
        });
      } else {
        log.warn('Could not fetch price', { nftContract: position.nftContract });
      }

      if (isOverdue) {
        liquidationQueue.push({
          positionId: position.positionId,
          reason: 'overdue',
          healthFactor: healthFactor !== null ? healthFactor.toString() : undefined,
          isOverdue: true,
          belowThreshold,
        });
      } else if (belowThreshold) {
        liquidationQueue.push({
          positionId: position.positionId,
          reason: 'unhealthy',
          healthFactor: healthFactor !== null ? healthFactor.toString() : undefined,
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
        const server = options?.server || rpcServer;
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

      if (MARKETPLACE_CONTRACT_ID) {
        await bumpContractTtl(MARKETPLACE_CONTRACT_ID, crankKeypair);
      }

      if (LAUNCHPAD_CONTRACT_ID) {
        await bumpContractTtl(LAUNCHPAD_CONTRACT_ID, crankKeypair);
      }

      const recentCollections = await prisma.collection.findMany({
        take: 20,
        orderBy: { deployedAtLedger: 'desc' },
      });

      for (const col of recentCollections) {
        await bumpContractTtl(col.contractAddress, crankKeypair);
      }

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

