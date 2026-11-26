import {
  Address,
  BASE_FEE,
  nativeToScVal,
  Operation,
  scValToNative,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import { invokeContract, submitTransaction } from "./contract";
import {
  e2eMockDeployRoyaltySplitter,
  isE2eMockChain,
} from "./e2e-chain-mock";

export interface SplitterRecipient {
  address: string;
  percentage: number;
}

function getRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
}

function getNetworkPassphrase(): string {
  return config.networkPassphrase;
}

function randomSalt(): Buffer {
  const salt = Buffer.alloc(32);
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < 32; i++) salt[i] = Math.floor(Math.random() * 256);
  }
  return salt;
}

function extractContractAddress(
  result: SorobanRpc.Api.GetSuccessfulTransactionResponse,
): string {
  const returnVal = result.returnValue;
  if (!returnVal) {
    throw new Error("No contract address returned from deployment.");
  }

  const native = scValToNative(returnVal);

  if (native instanceof Address) {
    return native.toString();
  }

  if (typeof native === "string") {
    return native;
  }

  throw new Error("Could not determine deployed contract address.");
}

export async function deployRoyaltySplitter(
  deployerPublicKey: string,
  recipients: SplitterRecipient[],
): Promise<string> {
  try {
    if (isE2eMockChain()) {
      return e2eMockDeployRoyaltySplitter(deployerPublicKey, recipients);
    }

    const wasmHashHex = config.splitterWasmHash;
    if (!wasmHashHex) {
      throw new Error(
        "Royalty Splitter WASM hash not configured. Set NEXT_PUBLIC_SPLITTER_WASM_HASH.",
      );
    }

    const wasmHash = Buffer.from(wasmHashHex, "hex");
    if (wasmHash.length !== 32) {
      throw new Error("Invalid WASM hash length — expected 32 bytes.");
    }

    const salt = randomSalt();
    const rpc = getRpc();
    const deployerAddress = new Address(deployerPublicKey);

    const account = await rpc.getAccount(deployerPublicKey);

    const createContractArgs = new xdr.CreateContractArgs({
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: deployerAddress.toScAddress(),
          salt,
        }),
      ),
      executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    });

    const deployFunc = xdr.HostFunction.hostFunctionTypeCreateContract(createContractArgs);

    // Deploying is a create-contract host function, not a contract call, so
    // it cannot go through invokeContract; submitTransaction covers the rest.
    const deployTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: deployFunc,
          auth: [],
        }),
      )
      .setTimeout(30)
      .build();

    const deployResult = await submitTransaction(deployTx);
    const contractAddress = extractContractAddress(deployResult);

    await initializeSplitter(deployerPublicKey, contractAddress, recipients);

    return contractAddress;
  } catch (error) {
    console.error("Failed to deploy royalty splitter:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function initializeSplitter(
  callerPublicKey: string,
  contractId: string,
  recipients: SplitterRecipient[],
): Promise<void> {
  const tokenAddress = new Address(config.usdcContractAddress || callerPublicKey);
  const beneficiaryAddresses = recipients.map((r) => new Address(r.address));
  const shares = recipients.map((r) => r.percentage);

  await invokeContract(
    callerPublicKey,
    "initialize",
    [
      tokenAddress.toScVal(),
      nativeToScVal(beneficiaryAddresses, { type: "vec" }),
      nativeToScVal(shares, { type: "vec" }),
    ],
    false,
    contractId,
  );
}

export async function getSplitterRecipients(
  contractId: string,
  publicKey?: string,
): Promise<SplitterRecipient[]> {
  try {
    if (!publicKey) {
      throw new Error("Public key is required to fetch splitter recipients. Please connect your wallet.");
    }

    const [beneficiariesVal, sharesVal] = await Promise.all([
      invokeContract(publicKey, "get_beneficiaries", [], true, contractId),
      invokeContract(publicKey, "get_shares", [], true, contractId),
    ]);

    const beneficiaries = scValToNative(beneficiariesVal) as Address[];
    const shares = scValToNative(sharesVal) as number[];

    return beneficiaries.map((addr, i) => ({
      address: addr instanceof Address ? addr.toString() : String(addr),
      percentage: Number(shares[i] || 0),
    }));
  } catch (error) {
    console.error("Failed to fetch splitter recipients:", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function getPendingBalance(
  contractId: string,
  publicKey?: string,
): Promise<number> {
  if (!publicKey) {
    throw new Error("Public key is required to fetch pending balance. Please connect your wallet.");
  }

  // Token the splitter pays out in
  const tokenVal = await invokeContract(publicKey, "get_token", [], true, contractId);
  const tokenAddress = scValToNative(tokenVal);
  const tokenAddressStr =
    tokenAddress instanceof Address ? tokenAddress.toString() : String(tokenAddress);

  // Splitter's current balance of that token
  const balanceVal = await invokeContract(
    publicKey,
    "balance",
    [new Address(contractId).toScVal()],
    true,
    tokenAddressStr,
  );

  return scValToNative(balanceVal) as number;
}

export async function distributeRoyalties(
  userPublicKey: string,
  contractId: string,
): Promise<void> {
  const tokenAddress = new Address(config.usdcContractAddress || userPublicKey);
  const callerAddress = new Address(userPublicKey);

  await invokeContract(
    userPublicKey,
    "distribute",
    [tokenAddress.toScVal(), callerAddress.toScVal()],
    false,
    contractId,
  );
}
