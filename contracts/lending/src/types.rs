use soroban_sdk::{contracttype, Address, Vec};

/// Represents the status of a Listing
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Open,
    Filled,
    Cancelled,
}

/// Represents the status of a Position
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PositionStatus {
    Active,
    Returned,
    Liquidated,
    Expired,
}

/// A Listing created by a lender offering their NFT for a loan
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Listing {
    /// Unique identifier for the listing
    pub id: u64,
    /// The address of the lender
    pub lender: Address,
    /// The address of the NFT contract
    pub nft_contract: Address,
    /// The token ID of the NFT
    pub token_id: u128,
    /// The declared price of the NFT in USD, fixed-point with 7 decimals
    pub declared_price_usd: i128,
    /// The interest schedule in basis points
    pub interest_schedule_bps: Vec<u32>,
    /// The maximum duration of the loan in days
    pub max_duration_days: u32,
    /// The minimum collateral buffer in basis points
    pub min_collateral_buffer_bps: u32,
    /// The liquidation threshold in basis points
    pub liquidation_threshold_bps: u32,
    /// The current status of the listing
    pub status: ListingStatus,
    /// The timestamp when the listing was created
    pub created_at: u64,
}

/// A Position representing an active or past loan
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    /// Unique identifier for the position
    pub id: u64,
    /// The identifier of the associated listing
    pub listing_id: u64,
    /// The address of the lender
    pub lender: Address,
    /// The address of the borrower
    pub borrower: Address,
    /// The address of the NFT contract
    pub nft_contract: Address,
    /// The token ID of the NFT
    pub token_id: u128,
    /// The declared price of the NFT in USD, fixed-point with 7 decimals
    pub declared_price_usd: i128,
    /// The address of the collateral currency
    pub collateral_currency: Address,
    /// The amount of collateral posted
    pub collateral_amount: i128,
    /// The interest schedule in basis points
    pub interest_schedule_bps: Vec<u32>,
    /// The liquidation threshold in basis points
    pub liquidation_threshold_bps: u32,
    /// The timestamp when the position was opened
    pub start_time: u64,
    /// The maximum duration of the loan in seconds
    pub max_duration_secs: u64,
    /// The current status of the position
    pub status: PositionStatus,
}

/// Result returned by settle(), consumed by callers to emit events
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettleResult {
    /// Total owed in USD (declared_price + accrued interest), 7 decimals
    pub owed_usd: i128,
    /// Accrued interest in USD, 7 decimals
    pub accrued_interest_usd: i128,
    /// Platform fee in USD, 7 decimals
    pub platform_fee_usd: i128,
    /// Liquidator fee in USD (0 on voluntary return), 7 decimals
    pub liquidator_fee_usd: i128,
    /// Token units debited from collateral (principal + fees)
    pub debit_tokens: i128,
    /// Token units sent to lender
    pub lender_payout: i128,
    /// Token units sent to platform fee receiver
    pub platform_payout: i128,
    /// Token units sent to liquidator (0 on voluntary return)
    pub liquidator_payout: i128,
    /// Remaining collateral returned to borrower (clamped to 0, never negative)
    pub borrower_rem: i128,
}

/// Platform configuration settings
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    /// The address of the platform admin
    pub admin: Address,
    /// The address receiving platform fees
    pub fee_receiver: Address,
    /// The platform fee in basis points
    pub platform_fee_bps: u32,
    /// The liquidator fee in basis points
    pub liquidator_fee_bps: u32,
    /// The minimum buffer in basis points
    pub min_buffer_bps: u32,
    /// The maximum buffer in basis points
    pub max_buffer_bps: u32,
    /// The minimum liquidation threshold in basis points
    pub min_liq_threshold_bps: u32,
    /// The maximum liquidation threshold in basis points
    pub max_liq_threshold_bps: u32,
    /// The address of the oracle contract
    pub oracle_address: Address,
    /// The maximum allowed staleness of the oracle price in seconds
    pub max_price_staleness_secs: u64,
}
