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
