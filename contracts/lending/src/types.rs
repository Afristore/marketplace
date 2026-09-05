use soroban_sdk::{contracterror, contracttype, Address, Symbol, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum LendingError {
    InvalidPrice = 1,
    EmptyInterestSchedule = 2,
    InvalidBounds = 3,
    Unauthorized = 4,
    ListingNotFound = 5,
    ListingNotOpen = 6,
    ContractPaused = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Open,
    Cancelled,
    Filled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PositionStatus {
    Active,
    Returned,
    Liquidated,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InterestTier {
    pub duration: u64,
    pub interest_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LendingListing {
    pub listing_id: u64,
    pub lender: Address,
    pub collection: Address,
    pub token_id: u64,
    pub price: i128,
    pub currency: Symbol,
    pub min_duration: u64,
    pub max_duration: u64,
    pub interest_schedule: Vec<InterestTier>,
    pub status: ListingStatus,
    pub created_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub id: u64,
    pub listing_id: u64,
    pub lender: Address,
    pub borrower: Address,
    pub nft_contract: Address,
    pub token_id: u128,
    pub declared_price_usd: i128,
    pub collateral_currency: Address,
    pub collateral_amount: i128,
    pub interest_schedule_bps: Vec<u32>,
    pub liquidation_threshold_bps: u32,
    pub start_time: u64,
    pub max_duration_secs: u64,
    pub status: PositionStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    pub admin: Address,
    pub fee_receiver: Address,
    pub platform_fee_bps: u32,
    pub liquidator_fee_bps: u32,
    pub min_buffer_bps: u32,
    pub max_buffer_bps: u32,
    pub min_liq_threshold_bps: u32,
    pub max_liq_threshold_bps: u32,
    pub oracle_address: Address,
    pub max_price_staleness_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettleResult {
    pub owed_usd: i128,
    pub accrued_interest_usd: i128,
    pub platform_fee_usd: i128,
    pub liquidator_fee_usd: i128,
    pub debit_tokens: i128,
    pub lender_payout: i128,
    pub platform_payout: i128,
    pub liquidator_payout: i128,
    pub borrower_rem: i128,
}
