import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Operation,
  scValToNative,
  SorobanRpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import { signWithFreighter } from "./freighter";
import { mapSorobanErrorMessage } from "./errors";

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

function readableError(raw: string, fallback: string): Error {
  const mapped = mapSorobanErrorMessage(raw);
  return new Error(mapped ?? fallback);
}

async function submitAndPoll(
  tx: any,
  rpc: SorobanRpc.Server,
): Promise<SorobanRpc.Api.GetSuccessfulTransactionResponse> {
  const simResult = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const raw = String(simResult.error ?? "");
    throw readableError(raw, "Transaction simulation failed.");
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  const txXdr = preparedTx.toXDR();

  const signedXdr = await signWithFreighter(txXdr, getNetworkPassphrase());

  const submitted = await rpc.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase()),
  );

  if (submitted.status === "ERROR") {
    const raw = String(submitted.errorResult ?? "");
    throw readableError(raw, "Transaction submission failed.");
  }

  let getResult = await rpc.getTransaction(submitted.hash);
  while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    getResult = await rpc.getTransaction(submitted.hash);
  }

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    const raw = JSON.stringify(getResult);
    throw readableError(raw, "Transaction failed on-chain.");
  }

  return getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
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

  const deployResult = await submitAndPoll(deployTx, rpc);
  const contractAddress = extractContractAddress(deployResult);

  await initializeSplitter(deployerPublicKey, contractAddress, recipients, rpc);

  return contractAddress;
}

async function initializeSplitter(
  callerPublicKey: string,
  contractId: string,
  recipients: SplitterRecipient[],
  rpc: SorobanRpc.Server,
): Promise<void> {
  const contract = new Contract(contractId);

  const args: xdr.ScVal[] = [
    new Address(callerPublicKey).toScVal(),
    nativeToScVal(
      recipients.map((r) => ({
        address: new Address(r.address),
        percentage: r.percentage,
      })),
      { type: "vec" },
    ),
  ];

  const account = await rpc.getAccount(callerPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("initialize", ...args))
    .setTimeout(30)
    .build();

  await submitAndPoll(tx, rpc);
}

export async function getSplitterRecipients(
  contractId: string,
): Promise<SplitterRecipient[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const contract = new Contract(contractId);
  const rpc = getRpc();
  const account = await rpc.getAccount(DUMMY_KEY);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("get_recipients"))
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error("Unable to fetch splitter recipients.");
  }

  const retVal = (
    simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
  ).result?.retval;
  if (!retVal) throw new Error("No return value.");

  const native = scValToNative(retVal) as any[];
  return native.map((obj: any) => ({
    address:
      obj.address instanceof Address
        ? obj.address.toString()
        : String(obj.address),
    percentage: Number(obj.percentage),
  }));
}

export async function getPendingBalance(
  contractId: string,
): Promise<number> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const contract = new Contract(contractId);
  const rpc = getRpc();
  const account = await rpc.getAccount(DUMMY_KEY);

  // Get the token address from the contract
  const tokenTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("get_token"))
    .setTimeout(30)
    .build();

  const simResult = await rpc.simulateTransaction(tokenTx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error("Unable to fetch token address from splitter.");
  }

  const tokenRetVal = (
    simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
  ).result?.retval;
  if (!tokenRetVal) throw new Error("No token address returned.");

  const tokenAddress = scValToNative(tokenRetVal) as any;
  const tokenAddressStr =
    tokenAddress instanceof Address ? tokenAddress.toString() : String(tokenAddress);

  // Get the balance of the contract with the token
  const tokenContract = new Contract(tokenAddressStr);
  const balanceTx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(tokenContract.call("balance", new Address(contractId).toScVal()))
    .setTimeout(30)
    .build();

  const balanceSimResult = await rpc.simulateTransaction(balanceTx);

  if (SorobanRpc.Api.isSimulationError(balanceSimResult)) {
    throw new Error("Unable to fetch pending balance.");
  }

  const balanceRetVal = (
    balanceSimResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
  ).result?.retval;
  if (!balanceRetVal) throw new Error("No balance returned.");

  const balance = scValToNative(balanceRetVal) as number;
  return balance;
}

export async function distributeRoyalties(
  userPublicKey: string,
  contractId: string,
): Promise<void> {
  const contract = new Contract(contractId);
  const rpc = getRpc();
  const account = await rpc.getAccount(userPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call("distribute"))
    .setTimeout(30)
    .build();

  await submitAndPoll(tx, rpc);
}
