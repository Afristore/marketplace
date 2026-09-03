// TypeScript bindings for the Lending Contract
// Generated from contracts/lending/src/types.rs and contracts/lending/src/events.rs

export enum LendingListingStatus {
  Open = 'Open',
  Filled = 'Filled',
  Cancelled = 'Cancelled',
}

export enum LendingPositionStatus {
  Active = 'Active',
  Returned = 'Returned',
  Liquidated = 'Liquidated',
  Expired = 'Expired',
}

export interface LendingListing {
  id: string;
  lender: string;
  nftContract: string;
  tokenId: string;
  declaredPriceUsd: string;
  interestScheduleBps: number[];
  maxDurationDays: number;
  minCollateralBufferBps: number;
  liquidationThresholdBps: number;
  status: LendingListingStatus;
  createdAt: string;
}

export interface LendingPosition {
  id: string;
  listingId: string;
  lender: string;
  borrower: string;
  nftContract: string;
  tokenId: string;
  declaredPriceUsd: string;
  collateralCurrency: string;
  collateralAmount: string;
  interestScheduleBps: number[];
  liquidationThresholdBps: number;
  startTime: string;
  maxDurationSecs: string;
  status: LendingPositionStatus;
}

export interface PlatformConfig {
  admin: string;
  feeReceiver: string;
  platformFeeBps: number;
  liquidatorFeeBps: number;
  minBufferBps: number;
  maxBufferBps: number;
  minLiqThresholdBps: number;
  maxLiqThresholdBps: number;
  oracleAddress: string;
  maxPriceStalenessSecs: string;
}

// Event data types from events.rs

export interface ListingCreatedData {
  listing_id: string;
  lender: string;
  nft_contract: string;
  token_id: string;
  declared_price_usd: string;
}

export interface ListingCancelledData {
  listing_id: string;
  lender: string;
}

export interface PositionOpenedData {
  position_id: string;
  listing_id: string;
  borrower: string;
  collateral_amount: string;
}

export interface CollateralAddedData {
  position_id: string;
  borrower: string;
  amount: string;
  new_total: string;
}

export interface PositionReturnedData {
  position_id: string;
  interest_paid: string;
  platform_fee: string;
  borrower_refund: string;
}

export interface PositionLiquidatedData {
  position_id: string;
  liquidator: string;
  lender_payout: string;
  liquidator_bounty: string;
  borrower_refund: string;
}
