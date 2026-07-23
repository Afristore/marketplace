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

dotenv.config();

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
  console.log(`[Crank] No CRANK_SECRET_KEY set. Generated ephemeral keypair: ${pubKey}`);

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
      console.log(`[Crank] Funded ephemeral keypair via Friendbot (tx: ${body.hash})`);
    }
  } catch (err) {
    console.error(`[Crank] Friendbot funding failed for ${pubKey}:`, err);
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
      console.error(`[Crank] Simulation failed for ${contractId}`);
      return;
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();
    assembled.sign(crankKeypair);

    const submitResult = await rpcServer.sendTransaction(assembled);

    if (submitResult.status === 'ERROR') {
      console.error(`[Crank] Submit error for ${contractId}:`, submitResult.errorResult);
      return;
    }

    // Poll for completion
    let txResult = await rpcServer.getTransaction(submitResult.hash);
    while (txResult.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      await new Promise((r) => setTimeout(r, 1000));
      txResult = await rpcServer.getTransaction(submitResult.hash);
    }

    if (txResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log(`[Crank] TTL bumped for ${contractId} to ledger ${extendTo}`);
    } else {
      console.error(`[Crank] TTL bump failed for ${contractId}:`, txResult);
    }
  } catch (err) {
    console.error(`[Crank] Failed to bump TTL for ${contractId}:`, err);
  }
}

async function runCrank() {
  console.log(`[Crank] Starting keep-alive bot. Interval: ${CRANK_INTERVAL_MS}ms`);

  const crankKeypair = await ensureCrankKeypair();

  while (true) {
    try {
      console.log(`[Crank] Running TTL extension cycle...`);

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
    } catch (err) {
      console.error(`[Crank] Error during keep-alive iteration:`, err);
    }

    await new Promise((resolve) => setTimeout(resolve, CRANK_INTERVAL_MS));
  }
}

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[Crank] Shutting down');
  prisma.$disconnect().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

runCrank();
