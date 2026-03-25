// events.rs — Defines all contract event schemas for Afristore Marketplace

use soroban_sdk::{contracttype, symbol_short, Address, Bytes, Env, Symbol};

// Versioned event topics as Symbol constants
pub const LISTING_CREATED: Symbol = symbol_short!("lst_crtd");
pub const ARTWORK_SOLD: Symbol = symbol_short!("art_sold");
pub const LISTING_CANCELLED: Symbol = symbol_short!("lst_cncl");
pub const LISTING_UPDATED: Symbol = symbol_short!("lst_updt");
pub const BID_PLACED: Symbol = symbol_short!("bid_plcd");
pub const AUCTION_RESOLVED: Symbol = symbol_short!("auc_rslv");
pub const OFFER_MADE: Symbol = symbol_short!("ofr_made");
pub const OFFER_ACCEPTED: Symbol = symbol_short!("ofr_accp");
pub const OFFER_REJECTED: Symbol = symbol_short!("ofr_rjct");
pub const OFFER_WITHDRAWN: Symbol = symbol_short!("ofr_wdrn");
pub const ROYALTY_PAID: Symbol = symbol_short!("roy_paid");
pub const ARTIST_REVOKED: Symbol = symbol_short!("art_rvkd");
pub const ARTIST_REINSTATED: Symbol = symbol_short!("art_rnst");

// Event data structs
// Event data structs
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCreatedEvent {
    pub listing_id: u64,
    pub artist: Address,
    pub price: i128,
    pub currency: Symbol,
    pub metadata_cid: Bytes,
    pub ledger_sequence: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtworkSoldEvent {
    pub listing_id: u64,
    pub artist: Address,
    pub buyer: Address,
    pub price: i128,
    pub currency: Symbol,
    pub ledger_sequence: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCancelledEvent {
    pub listing_id: u64,
    pub artist: Address,
    pub ledger_sequence: u32,
}

// Add more event structs as needed for other actions
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionCreatedEvent {
    pub auction_id: u64,
    pub creator: Address,
    pub reserve_price: i128,
    pub token: Address,
    pub end_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidPlacedEvent {
    pub auction_id: u64,
    pub bidder: Address,
    pub bid_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionFinalizedEvent {
    pub auction_id: u64,
    pub winner: Option<Address>,
    pub amount: i128,
}

impl ListingCreatedEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((LISTING_CREATED,), self);
    }
}

impl ArtworkSoldEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((ARTWORK_SOLD,), self);
    }
}

impl ListingCancelledEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((LISTING_CANCELLED,), self);
    }
}

impl AuctionCreatedEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((symbol_short!("auc_crtd"),), self);
    }
}

impl BidPlacedEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((BID_PLACED,), self);
    }
}

impl AuctionFinalizedEvent {
    pub fn publish(self, env: &Env) {
        env.events().publish((AUCTION_RESOLVED,), self);
    }
}

// End of events
