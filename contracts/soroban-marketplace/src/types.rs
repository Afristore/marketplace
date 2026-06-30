// types.rs
use soroban_sdk::{contracterror, contracttype, Address, Bytes, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MarketplaceError {
    InvalidCid = 1,
    InvalidPrice = 2,
    ListingNotFound = 3,
    ListingNotActive = 4,
    Unauthorized = 5,
    CannotBuyOwnListing = 6,
    InvalidSplit = 7,
    TooManyRecipients = 8,
    AuctionNotFound = 9,
    AuctionNotActive = 10,
    BidTooLow = 11,
    AuctionExpired = 12,
    AuctionNotExpired = 13,
    AuctionAlreadyFinalized = 14,
    ArtistRevoked = 15,
    OfferNotFound = 16,
    CannotOfferOwnListing = 17,
    OfferNotPending = 18,
    InsufficientOfferAmount = 19,
    ListingSold = 20,
    ListingCancelled = 21,
    ReentrancyGuard = 22,
    ContractPaused = 23,
    /// Royalty bps greater than 10000 (100%) — rejects create_listing/create_auction
    InvalidRoyalty = 24,
    /// Token attempted at purchase time but is no longer whitelisted
    TokenNotWhitelisted = 25,
    InvalidAuctionDuration = 26,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ListingStatus {
    Active,
    Sold,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recipient {
    pub address: Address,
    pub percentage: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Listing {
    pub listing_id: u64,
    pub artist: Address,
    pub price: i128,
    pub currency: Symbol,
    pub token: Address,
    pub collection: Address,
    pub token_id: u64,
    pub recipients: soroban_sdk::Vec<Recipient>,
    pub status: ListingStatus,
    pub owner: Option<Address>,
    pub created_at: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuctionStatus {
    Active,
    Finalized,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Auction {
    pub auction_id: u64,
    pub creator: Address,
    pub token: Address,
    pub collection: Address,
    pub token_id: u64,
    pub reserve_price: i128,
    pub highest_bid: i128,
    pub highest_bidder: Option<Address>,
    pub end_time: u64,
    pub status: AuctionStatus,
    pub recipients: soroban_sdk::Vec<Recipient>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OfferStatus {
    Pending,
    Accepted,
    Rejected,
    Withdrawn,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Offer {
    pub offer_id: u64,
    pub listing_id: u64,
    pub offerer: Address,
    pub amount: i128,
    pub token: Address,
    pub status: OfferStatus,
    pub created_at: u32,
}
