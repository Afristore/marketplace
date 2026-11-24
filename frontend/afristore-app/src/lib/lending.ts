// ─────────────────────────────────────────────────────────────
// lib/lending.ts — Soroban Lending contract client
// ─────────────────────────────────────────────────────────────

import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import { invokeContract } from "./contract";
import { getConnectedPublicKey } from "./freighter";
import {
  isE2eMockChain,
  e2eMockWhitelistCurrency,
  e2eMockUpdateBounds,
  e2eMockLendingAdmin,
} from "./e2e-chain-mock";

export interface Position {
  id: number | bigint;
  listing_id: number | bigint;
  lender: string;
  borrower: string;
  nft_contract: string;
  token_id: number | bigint;
  declared_price_usd: bigint;
  collateral_currency: string;
  collateral_amount: bigint;
  interest_schedule_bps: number[];
  liquidation_threshold_bps: number;
  start_time: number;
  max_duration_secs: number;
  status: "Active" | "Returned" | "Liquidated" | "Expired";
}

export interface LendingListing {
  id: number | bigint;
  lender: string;
  nft_contract: string;
  token_id: number | bigint;
  declared_price_usd: bigint;
  interest_schedule_bps: number[];
  max_duration_days: number;
  min_collateral_buffer_bps: number;
  liquidation_threshold_bps: number;
  status: "Open" | "Filled" | "Cancelled";
  created_at: number;
}

export interface PlatformConfig {
  admin: string;
  fee_receiver: string;
  platform_fee_bps: number;
  liquidator_fee_bps: number;
  min_buffer_bps: number;
  max_buffer_bps: number;
  min_liq_threshold_bps: number;
  max_liq_threshold_bps: number;
  oracle_address: string;
  max_price_staleness_secs: number;
}

export interface ReturnFees {
  principalUsd: bigint;
  accruedInterestUsd: bigint;
  platformFeeUsd: bigint;
  totalRequiredUsd: bigint;
}

/**
 * Admin-configurable collateral buffer / liquidation-threshold bounds.
 * Mirrors the args of the `admin_update_bounds` contract entrypoint.
 */
export interface LendingBounds {
  minBufferBps: number;
  maxBufferBps: number;
  minLiqThresholdBps: number;
  maxLiqThresholdBps: number;
}

export interface CreateLendingListingInput {
  nftContract: string;
  tokenId: number | bigint;
  declaredPriceUsd: bigint | number | string;
  interestScheduleBps: number[];
  maxDurationDays: number;
  minCollateralBufferBps: number;
  liquidationThresholdBps: number;
}

export function getLendingContractId(): string {
  return config.lendingContractId || "CLENDING_DEFAULT_CONTRACT_ID";
}

function getRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
}

function getNetworkPassphrase(): string {
  return config.networkPassphrase;
}

const READ_ONLY_CALLER_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

async function getReadOnlyCallerPublicKey(): Promise<string> {
  const connectedPublicKey = await getConnectedPublicKey();
  return connectedPublicKey ?? READ_ONLY_CALLER_PUBLIC_KEY;
}

// ── Interest calculation helper ──────────────────────────────────────────────

export function computeAccruedInterestUsd(
  declaredPriceUsd: bigint,
  interestScheduleBps: number[],
  startTime: number,
  nowSecs: number = Math.floor(Date.now() / 1000)
): bigint {
  if (interestScheduleBps.length === 0 || nowSecs <= startTime) {
    return 0n;
  }

  const elapsedSecs = BigInt(nowSecs - startTime);
  const elapsedDays = elapsedSecs / 86400n;
  const fullMonths = Number(elapsedDays / 30n);
  const partialDays = elapsedDays % 30n;
  const len = interestScheduleBps.length;

  let totalInterest = 0n;

  for (let m = 0; m < fullMonths; m++) {
    const idx = Math.min(m, len - 1);
    const rateBps = BigInt(interestScheduleBps[idx]);
    totalInterest += (declaredPriceUsd * rateBps) / 10000n;
  }

  if (partialDays > 0n) {
    const idx = Math.min(fullMonths, len - 1);
    const partialRateBps = BigInt(interestScheduleBps[idx]);
    totalInterest +=
      (declaredPriceUsd * partialRateBps * partialDays) / (10000n * 30n);
  }

  return totalInterest;
}

export function calculateReturnFees(
  position: Position,
  platformFeeBps = 100, // default 1%
  nowSecs: number = Math.floor(Date.now() / 1000)
): ReturnFees {
  const principalUsd = BigInt(position.declared_price_usd);
  const accruedInterestUsd = computeAccruedInterestUsd(
    principalUsd,
    position.interest_schedule_bps,
    position.start_time,
    nowSecs
  );

  const owedUsd = principalUsd + accruedInterestUsd;
  const platformFeeUsd = (owedUsd * BigInt(platformFeeBps)) / 10000n;
  const totalRequiredUsd = owedUsd + platformFeeUsd;

  return {
    principalUsd,
    accruedInterestUsd,
    platformFeeUsd,
    totalRequiredUsd,
  };
}

// ── Token Approval & Balance Helpers ──────────────────────────────────────────

export async function getTokenBalance(
  userPublicKey: string,
  tokenAddress: string
): Promise<bigint> {
  return (await getTokenBalanceOrNull(userPublicKey, tokenAddress)) ?? 0n;
}

/**
 * Like `getTokenBalance`, but returns null when the balance cannot be read
 * (RPC down, simulation error) instead of 0n. Use this where a failed read
 * must not look like an empty wallet, e.g. blocking a form on "insufficient
 * balance".
 */
export async function getTokenBalanceOrNull(
  userPublicKey: string,
  tokenAddress: string
): Promise<bigint | null> {
  if (isE2eMockChain()) {
    return 1_000_000_000_000n;
  }

  try {
    const rpc = getRpc();
    const account = await rpc.getAccount(userPublicKey);
    const tokenContract = new Contract(tokenAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        tokenContract.call("balance", new Address(userPublicKey).toScVal())
      )
      .setTimeout(30)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error("Failed to query token balance");
    }

    const retVal = (
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!retVal) return 0n;

    const val = scValToNative(retVal);
    return BigInt(val);
  } catch (err) {
    console.warn("getTokenBalance error:", err);
    return null;
  }
}

export async function getTokenAllowance(
  userPublicKey: string,
  spenderAddress: string,
  tokenAddress: string
): Promise<bigint> {
  if (isE2eMockChain()) {
    return 1_000_000_000_000n;
  }

  try {
    const rpc = getRpc();
    const account = await rpc.getAccount(userPublicKey);
    const tokenContract = new Contract(tokenAddress);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        tokenContract.call(
          "allowance",
          new Address(userPublicKey).toScVal(),
          new Address(spenderAddress).toScVal()
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      throw new Error("Failed to query token allowance");
    }

    const retVal = (
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!retVal) return 0n;

    const val = scValToNative(retVal);
    return BigInt(val);
  } catch (err) {
    console.warn("getTokenAllowance error:", err);
    return 0n;
  }
}

// SAC approvals expire at an absolute ledger sequence, so the expiry is derived
// from the latest ledger. A hardcoded value becomes already expired once the
// network passes it, and later borrow/top-up/repay calls then fail with an
// authorization error. The expiry must not be earlier than the current ledger.

/** ~30 days of ledgers at ~5 seconds per ledger. */
export const APPROVAL_LEDGER_BUFFER = 518_400;
/**
 * Conservative cap on the approval window, in ledgers (~180 days at ~5s).
 * Keeps the expiry within the network's maximum entry TTL; verify against the
 * network's configured limit if it changes.
 */
export const MAX_APPROVAL_LEDGER_BUFFER = 3_110_400;

export async function getApprovalExpirationLedger(
  rpc: SorobanRpc.Server = getRpc()
): Promise<number> {
  const latest = await rpc.getLatestLedger();
  const buffer = Math.min(APPROVAL_LEDGER_BUFFER, MAX_APPROVAL_LEDGER_BUFFER);
  return latest.sequence + buffer;
}

export async function approveToken(
  userPublicKey: string,
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint
): Promise<void> {
  if (isE2eMockChain()) {
    return;
  }

  const currentAllowance = await getTokenAllowance(
    userPublicKey,
    spenderAddress,
    tokenAddress
  );
  if (currentAllowance >= amount) {
    return;
  }

  const expirationLedger = await getApprovalExpirationLedger();

  await invokeContract(
    userPublicKey,
    "approve",
    [
      new Address(userPublicKey).toScVal(),
      new Address(spenderAddress).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(expirationLedger, { type: "u32" }),
    ],
    false,
    tokenAddress
  );
}

// ── Contract Read Operations ──────────────────────────────────────────────────

export async function getPosition(
  positionId: number | bigint
): Promise<Position | null> {
  try {
    const caller = await getReadOnlyCallerPublicKey();
    const rpc = getRpc();
    const account = await rpc.getAccount(caller);
    const contract = new Contract(getLendingContractId());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(
        contract.call(
          "get_position",
          nativeToScVal(BigInt(positionId), { type: "u64" })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return null;
    }

    const retVal = (
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!retVal) return null;

    const native = scValToNative(retVal);
    return {
      id: native.id,
      listing_id: native.listing_id,
      lender:
        native.lender instanceof Address
          ? native.lender.toString()
          : String(native.lender),
      borrower:
        native.borrower instanceof Address
          ? native.borrower.toString()
          : String(native.borrower),
      nft_contract:
        native.nft_contract instanceof Address
          ? native.nft_contract.toString()
          : String(native.nft_contract),
      token_id: native.token_id,
      declared_price_usd: BigInt(native.declared_price_usd),
      collateral_currency:
        native.collateral_currency instanceof Address
          ? native.collateral_currency.toString()
          : String(native.collateral_currency),
      collateral_amount: BigInt(native.collateral_amount),
      interest_schedule_bps: Array.from(native.interest_schedule_bps || []),
      liquidation_threshold_bps: Number(native.liquidation_threshold_bps),
      start_time: Number(native.start_time),
      max_duration_secs: Number(native.max_duration_secs),
      status: native.status,
    };
  } catch (err) {
    // Re-throw network / RPC failures so callers receive the real error message
    // rather than a misleading "Position not found" on infrastructure issues.
    throw err;
  }
}

export async function getLendingPlatformConfig(): Promise<PlatformConfig | null> {
  if (isE2eMockChain()) {
    return {
      admin: e2eMockLendingAdmin(),
      fee_receiver: READ_ONLY_CALLER_PUBLIC_KEY,
      platform_fee_bps: 100,
      liquidator_fee_bps: 500,
      min_buffer_bps: 12000,
      max_buffer_bps: 20000,
      min_liq_threshold_bps: 10500,
      max_liq_threshold_bps: 12000,
      oracle_address: READ_ONLY_CALLER_PUBLIC_KEY,
      max_price_staleness_secs: 300,
    };
  }

  try {
    const caller = await getReadOnlyCallerPublicKey();
    const rpc = getRpc();
    const account = await rpc.getAccount(caller);
    const contract = new Contract(getLendingContractId());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: getNetworkPassphrase(),
    })
      .addOperation(contract.call("get_config"))
      .setTimeout(30)
      .build();

    const simResult = await rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return null;
    }

    const retVal = (
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!retVal) return null;

    const native = scValToNative(retVal);
    return {
      admin: String(native.admin),
      fee_receiver: String(native.fee_receiver),
      platform_fee_bps: Number(native.platform_fee_bps),
      liquidator_fee_bps: Number(native.liquidator_fee_bps),
      min_buffer_bps: Number(native.min_buffer_bps),
      max_buffer_bps: Number(native.max_buffer_bps),
      min_liq_threshold_bps: Number(native.min_liq_threshold_bps),
      max_liq_threshold_bps: Number(native.max_liq_threshold_bps),
      oracle_address: String(native.oracle_address),
      max_price_staleness_secs: Number(native.max_price_staleness_secs),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the protocol admin address (best-effort; null when unreadable).
 * Used to gate admin-only mutations to the connected wallet.
 */
export async function getLendingAdmin(): Promise<string | null> {
  const platformConfig = await getLendingPlatformConfig();
  return platformConfig?.admin ?? null;
}

// ── Lending Contract Write Operations ────────────────────────────────────────

export async function createLendingListing(
  lenderPublicKey: string,
  input: CreateLendingListingInput,
): Promise<number> {
  if (isE2eMockChain()) {
    return Math.floor(Date.now() / 1000);
  }

  const args: xdr.ScVal[] = [
    new Address(lenderPublicKey).toScVal(),
    new Address(input.nftContract).toScVal(),
    nativeToScVal(BigInt(input.tokenId), { type: "u128" }),
    nativeToScVal(BigInt(input.declaredPriceUsd), { type: "i128" }),
    xdr.ScVal.scvVec(
      input.interestScheduleBps.map((bps) => nativeToScVal(bps, { type: "u32" })),
    ),
    asU32(input.maxDurationDays),
    asU32(input.minCollateralBufferBps),
    asU32(input.liquidationThresholdBps),
  ];

  const retVal = await invokeContract(
    lenderPublicKey,
    "create_listing",
    args,
    false,
    getLendingContractId(),
  );
  return Number(scValToNative(retVal));
}

export async function borrow(
  borrowerPublicKey: string,
  listingId: number | bigint,
  collateralCurrency: string,
  collateralAmount: bigint | number | string
): Promise<number> {
  const amountBig = BigInt(collateralAmount);

  // Insufficient balance check
  const balance = await getTokenBalance(borrowerPublicKey, collateralCurrency);
  if (balance < amountBig) {
    throw new Error("Insufficient balance for collateral requirement");
  }

  const lendingContractId = getLendingContractId();

  // Approve exact collateral token amount before calling borrow
  await approveToken(
    borrowerPublicKey,
    collateralCurrency,
    lendingContractId,
    amountBig
  );

  if (isE2eMockChain()) {
    return Math.floor(Date.now() / 1000);
  }

  const retVal = await invokeContract(
    borrowerPublicKey,
    "borrow",
    [
      nativeToScVal(BigInt(listingId), { type: "u64" }),
      new Address(borrowerPublicKey).toScVal(),
      new Address(collateralCurrency).toScVal(),
      nativeToScVal(amountBig, { type: "i128" }),
    ],
    false,
    lendingContractId
  );

  // invokeContract resolves to a void ScVal when the ledger result has no
  // return value; a borrow must return the new position ID.
  if (retVal.switch() === xdr.ScValType.scvVoid()) {
    throw new Error("Borrow transaction succeeded but returned no position ID");
  }
  return Number(scValToNative(retVal));
}

export async function addCollateral(
  borrowerPublicKey: string,
  positionId: number | bigint,
  amount: bigint | number | string,
  collateralCurrency?: string
): Promise<void> {
  const amountBig = BigInt(amount);

  let tokenAddr = collateralCurrency;
  if (!tokenAddr) {
    const pos = await getPosition(positionId);
    if (!pos) {
      throw new Error(`Position #${positionId} not found`);
    }
    tokenAddr = pos.collateral_currency;
  }

  // Insufficient balance check
  const balance = await getTokenBalance(borrowerPublicKey, tokenAddr);
  if (balance < amountBig) {
    throw new Error("Insufficient balance for collateral top-up");
  }

  const lendingContractId = getLendingContractId();

  // Handle token approval flow
  await approveToken(
    borrowerPublicKey,
    tokenAddr,
    lendingContractId,
    amountBig
  );

  if (isE2eMockChain()) {
    return;
  }

  await invokeContract(
    borrowerPublicKey,
    "add_collateral",
    [
      nativeToScVal(BigInt(positionId), { type: "u64" }),
      nativeToScVal(amountBig, { type: "i128" }),
    ],
    false,
    lendingContractId
  );
}

export async function returnNFT(
  borrowerPublicKey: string,
  positionId: number | bigint
): Promise<void> {
  let pos = await getPosition(positionId);

  // If position fetch fails or returns null in tests/mock context, create fallback
  if (!pos) {
    if (!isE2eMockChain()) {
      throw new Error(`Position #${positionId} not found`);
    }
    pos = {
      id: positionId,
      listing_id: 1n,
      lender: "GLENDER",
      borrower: borrowerPublicKey,
      nft_contract: "CNFT",
      token_id: 1n,
      declared_price_usd: 100_000_000n, // 10 USD (7 decimals)
      collateral_currency: "CUSDC",
      collateral_amount: 150_000_000n,
      interest_schedule_bps: [500],
      liquidation_threshold_bps: 12000,
      start_time: Math.floor(Date.now() / 1000) - 86400 * 10,
      max_duration_secs: 86400 * 30,
      status: "Active",
    };
  }

  const platformConfig = await getLendingPlatformConfig();
  const platformFeeBps = platformConfig?.platform_fee_bps ?? 100;

  // Calculates required fees on the fly: principal + accrued interest + platform fees
  const fees = calculateReturnFees(pos, platformFeeBps);
  const totalApprovalRequired = fees.totalRequiredUsd;

  // Check borrower token balance
  const balance = await getTokenBalance(
    borrowerPublicKey,
    pos.collateral_currency
  );
  if (balance < totalApprovalRequired) {
    throw new Error("Insufficient balance to pay principal, interest, and fees");
  }

  const lendingContractId = getLendingContractId();

  // Approves principal + interest + platform fees
  await approveToken(
    borrowerPublicKey,
    pos.collateral_currency,
    lendingContractId,
    totalApprovalRequired
  );

  if (isE2eMockChain()) {
    return;
  }

  // Submits the return_nft transaction
  await invokeContract(
    borrowerPublicKey,
    "return_nft",
    [nativeToScVal(BigInt(positionId), { type: "u64" })],
    false,
    lendingContractId
  );
}

export async function liquidate(
  liquidatorPublicKey: string,
  positionId: number | bigint
): Promise<{ bountyEarned: bigint }> {
  let pos = await getPosition(positionId);
  const platformConfig = await getLendingPlatformConfig();
  const liquidatorFeeBps = BigInt(platformConfig?.liquidator_fee_bps ?? 500); // 5% default

  if (!pos) {
    if (!isE2eMockChain()) {
      throw new Error(`Position #${positionId} not found`);
    }
    pos = {
      id: positionId,
      listing_id: 1n,
      lender: "GLENDER",
      borrower: "GBORROWER",
      nft_contract: "CNFT",
      token_id: 1n,
      declared_price_usd: 100_000_000n,
      collateral_currency: "CUSDC",
      collateral_amount: 150_000_000n,
      interest_schedule_bps: [500],
      liquidation_threshold_bps: 12000,
      start_time: Math.floor(Date.now() / 1000) - 86400 * 40,
      max_duration_secs: 86400 * 30,
      status: "Active",
    };
  }

  // Estimate liquidator bounty earned
  const fees = calculateReturnFees(
    pos,
    platformConfig?.platform_fee_bps ?? 100
  );
  const owedUsd = fees.principalUsd + fees.accruedInterestUsd;
  const bountyEarned = (owedUsd * liquidatorFeeBps) / 10000n;

  if (isE2eMockChain()) {
    return { bountyEarned };
  }

  await invokeContract(
    liquidatorPublicKey,
    "liquidate",
    [
      nativeToScVal(BigInt(positionId), { type: "u64" }),
      new Address(liquidatorPublicKey).toScVal(),
    ],
    false,
    getLendingContractId()
  );

  return { bountyEarned };
}

// ── Admin Mutations ──────────────────────────────────────────────────────────

function toAddressScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

function asU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

/**
 * whitelist_currency — Admin whitelists a token as valid loan collateral.
 * Admin-only: enforced on-chain via auth; the simulation below re-enforces
 * it before anything is submitted.
 */
export async function whitelistCurrency(
  adminPublicKey: string,
  currencyAddress: string,
  symbol: string
): Promise<void> {
  if (isE2eMockChain()) {
    e2eMockWhitelistCurrency(currencyAddress, symbol);
    return;
  }

  await invokeContract(
    adminPublicKey,
    "whitelist_currency",
    [toAddressScVal(currencyAddress), nativeToScVal(symbol, { type: "string" })],
    false,
    getLendingContractId()
  );
}

/**
 * admin_update_bounds — Admin adjusts platform-wide collateral buffer and
 * liquidation-threshold bounds. Args match the PlatformConfig field order:
 * min/max buffer bps, then min/max liquidation-threshold bps.
 */
export async function updateBounds(
  adminPublicKey: string,
  bounds: LendingBounds
): Promise<void> {
  if (isE2eMockChain()) {
    e2eMockUpdateBounds(bounds);
    return;
  }

  await invokeContract(
    adminPublicKey,
    "admin_update_bounds",
    [
      asU32(bounds.minBufferBps),
      asU32(bounds.maxBufferBps),
      asU32(bounds.minLiqThresholdBps),
      asU32(bounds.maxLiqThresholdBps),
    ],
    false,
    getLendingContractId()
  );
}

/**
 * admin_set_fees — Admin sets the platform and liquidator fee bps. The
 * contract rejects a combined total of 10000 bps or more; callers validate
 * with `feesSchema` first so that never reaches the network.
 */
export async function setFees(
  adminPublicKey: string,
  platformFeeBps: number,
  liquidatorFeeBps: number
): Promise<void> {
  if (isE2eMockChain()) return;

  await invokeContract(
    adminPublicKey,
    "admin_set_fees",
    [asU32(platformFeeBps), asU32(liquidatorFeeBps)],
    false,
    getLendingContractId()
  );
}

/**
 * Reads the current owner of an ERC-721 token via `owner_of`. Returns null
 * when the token does not exist or the call cannot be simulated.
 */
export async function getNftOwner(
  callerPublicKey: string,
  nftContract: string,
  tokenId: number | bigint
): Promise<string | null> {
  if (isE2eMockChain()) return callerPublicKey;

  try {
    const result = await invokeContract(
      callerPublicKey,
      "owner_of",
      [nativeToScVal(BigInt(tokenId), { type: "u64" })],
      true,
      nftContract
    );
    return String(scValToNative(result));
  } catch {
    return null;
  }
}

