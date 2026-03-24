// types.rs
use soroban_sdk::{contracterror, contracttype, Address, Bytes, Symbol};

// ✅ #[contracterror] generates Into<Error> automatically
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketplaceError {
    InvalidCid           = 1,
    InvalidPrice         = 2,
    ListingNotFound      = 3,
    ListingNotActive     = 4,
    Unauthorized         = 5,
    CannotBuyOwnListing  = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Active,
    Sold,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Listing {
    pub listing_id:   u64,
    pub artist:       Address,
    pub metadata_cid: Bytes,
    pub price:        i128,
    pub currency:     Symbol,
    pub token:        Address, // Payment token contract address
    pub status:       ListingStatus,
    pub owner:        Option<Address>,
    pub created_at:   u32,
    // Royalties
    pub original_creator: Address,
    pub royalty_bps: u32, // Royalty in basis points (1/100 of a percent)
}