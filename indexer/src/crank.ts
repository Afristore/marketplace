import { rpc, Contract, TransactionBuilder, Keypair, Account } from '@stellar/stellar-sdk';
import prisma from './db.js';
import dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const MARKETPLACE_CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID;
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID;
// Run every 5 minutes by default
const CRANK_INTERVAL_MS = parseInt(process.env.CRANK_INTERVAL_MS || '300000'); 

const rpcServer = new rpc.Server(RPC_URL, { allowHttp: false });

/**
 * Simulates a simple read operation on the contract to ensure its state is
 * loaded by the RPC, preventing archiving due to inactivity.
 */
async function simulateRead(contractId: string, functionName: string) {
  if (!contractId) return;
  try {
    const contract = new Contract(contractId);
    const dummy = Keypair.random();
    const account = await rpcServer.getAccount(dummy.publicKey()).catch(() => new Account(dummy.publicKey(), "0"));
    
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(functionName))
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(simResult)) {
        console.log(`[Crank] Pinged ${contractId} via ${functionName}. Status: Success`);
    } else {
        console.log(`[Crank] Pinged ${contractId} via ${functionName}. Status: Error (but footprint loaded)`);
    }
  } catch (err) {
    console.error(`[Crank] Failed to ping contract ${contractId}:`, err);
  }
}

async function runCrank() {
  console.log(`[Crank] Starting keep-alive bot. Interval: ${CRANK_INTERVAL_MS}ms`);

  while (true) {
    try {
      console.log(`[Crank] Running keep-alive ping...`);
      if (MARKETPLACE_CONTRACT_ID) {
        // get_protocol_fee is a read-only fn on marketplace
        await simulateRead(MARKETPLACE_CONTRACT_ID, "get_protocol_fee");
      }

      if (LAUNCHPAD_CONTRACT_ID) {
        // get_platform_fee is a read-only fn on the launchpad
        await simulateRead(LAUNCHPAD_CONTRACT_ID, "get_platform_fee");
      }
      
      // Ping a few recent active collections to keep them alive too
      const recentCollections = await prisma.collection.findMany({
        take: 20,
        orderBy: { deployedAtLedger: 'desc' }
      });
      for (const col of recentCollections) {
        // name is a standard read-only fn on NFT collections
        await simulateRead(col.contractAddress, "name");
      }
    } catch (err) {
      console.error(`[Crank] Error during keep-alive iteration:`, err);
    }
    
    await new Promise(resolve => setTimeout(resolve, CRANK_INTERVAL_MS));
  }
}

// Handle graceful shutdown
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
