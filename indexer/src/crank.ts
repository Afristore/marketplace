import {
  rpc,
  TransactionBuilder,
  Keypair,
  Account,
  Operation,
  StrKey,
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
const CRANK_SECRET_KEY = process.env.CRANK_SECRET_KEY;
const CRANK_INTERVAL_MS = parseInt(process.env.CRANK_INTERVAL_MS || '300000');
const EXTEND_LEDGERS = 500_000;

const rpcServer = new rpc.Server(RPC_URL, { allowHttp: false });

function contractIdToLedgerKey(contractId: string): xdr.LedgerKey {
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

async function ensureCrankKeypair(): Promise<Keypair> {
  if (CRANK_SECRET_KEY) {
    return Keypair.fromSecret(CRANK_SECRET_KEY);
  }

  const keypair = Keypair.random();
  const pubKey = keypair.publicKey();
  log.info('No CRANK_SECRET_KEY set; generated ephemeral keypair', { publicKey: pubKey });

  try {
    await rpcServer.getAccount(pubKey);
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

async function bumpContractTtl(contractId: string, crankKeypair: Keypair) {
  if (!contractId) return;

  try {
    const account = await rpcServer.getAccount(crankKeypair.publicKey());
    const currentLedger = (await rpcServer.getLatestLedger()).sequence;
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

    const simResult = await rpcServer.simulateTransaction(tx);

    if (!rpc.Api.isSimulationSuccess(simResult)) {
      log.error('Simulation failed', { contractId });
      return;
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();
    assembled.sign(crankKeypair);

    const submitResult = await rpcServer.sendTransaction(assembled);

    if (submitResult.status === 'ERROR') {
      log.error('Submit error', { contractId, errorResult: submitResult.errorResult });
      return;
    }

    // Poll for completion
    let txResult = await rpcServer.getTransaction(submitResult.hash);
    while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      txResult = await rpcServer.getTransaction(submitResult.hash);
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

async function fetchOraclePrice(token: string): Promise<number | null> {
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

function calculateHealthFactor(collateralValue: number, loanAmount: number): number {
  if (loanAmount <= 0) return 999; // Edge case: no debt
  return collateralValue / loanAmount;
}

async function updatePositionHealthFactors() {
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
      return;
    }

    const updates: Array<{ positionId: bigint; healthFactor: string; belowThreshold: boolean }> = [];

    for (const position of positions) {
      const collateralPrice = await fetchOraclePrice(position.nftContract);
      if (collateralPrice === null) {
        log.warn('Could not fetch price', { nftContract: position.nftContract });
        continue;
      }

      const collateralValue = collateralPrice * Number(position.collateralAmount);
      const healthFactor = calculateHealthFactor(collateralValue, Number(position.declaredPriceUsd));

      updates.push({
        positionId: position.positionId,
        healthFactor: healthFactor.toString(),
        belowThreshold: healthFactor < config.minLiqThresholdBps / 10000,
      });
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
  } catch (err) {
    log.error('Error updating health factors', { err });
  }
}

async function runCrank() {
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

      await updatePositionHealthFactors();
    } catch (err) {
      log.error('Error during crank iteration', { err });
    }

    await new Promise((resolve) => setTimeout(resolve, CRANK_INTERVAL_MS));
  }
}

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info('Shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runCrank();
