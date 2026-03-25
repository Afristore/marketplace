#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MarketplaceContract, MarketplaceContractClient};
    use soroban_sdk::{
        bytes, symbol_short,
        testutils::{Address as _, Events},
        Address, Env,
    };

    #[test]
    fn test_create_listing_success() {
        let env = Env::default();
        env.mock_all_auths();

        // Register the contract and get a client
        let contract_id = env.register(MarketplaceContract, ());
        let client = MarketplaceContractClient::new(&env, &contract_id);

        let artist = Address::generate(&env);
        let cid = bytes!(&env, 0x516d546573744349444f6e495046533132333435);
        let price: i128 = 10_000_000;

        client.set_admin(&artist);
        client.add_token_to_whitelist(&contract_id);
        let listing_id = client.create_listing(
            &artist,
            &cid,
            &price,
            &symbol_short!("XLM"),
            &contract_id,
            &0u32,
            &soroban_sdk::vec![
                &env,
                crate::types::Recipient {
                    address: artist.clone(),
                    percentage: 100,
                }
            ],
        );

        assert_eq!(listing_id, 1u64);
        // Events are now visible on the original env
        let _events = env.events().all();
    }
}
// ------------------------------------------------------------
// storage.rs — Ledger storage key helpers
// ------------------------------------------------------------
//
// Key design
// ──────────
// Persistent storage:
//   DataKey::Listing(u64)          → Listing struct
//   DataKey::ArtistListings(Address) → Vec<u64>  (artist's listing IDs)
//   DataKey::ListingCount          → u64  (auto-increment counter)
//
// All values use `env.storage().persistent()` so they survive
// ledger archival (TTL is extended on every write).
// ------------------------------------------------------------

use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Listing, Offer};

/// Storage key variants for the marketplace contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Stores the global listing counter (u64).
    ListingCount,
    /// Stores a single `Listing` by its ID.
    Listing(u64),
    /// Stores a `Vec<u64>` of listing IDs owned by an artist.
    ArtistListings(Address),
    /// Stores the admin address
    Admin,
    /// Stores the token whitelist as a Vec<Address>
    TokenWhitelist,
    /// Stores the treasury address
    Treasury,
    /// Stores the protocol fee in basis points
    ProtocolFeeBps, // fee in basis points (1/100 of a percent)
    /// Stores the global auction counter (u64).
    AuctionCount,
    /// Stores a single `Auction` by its ID.
    Auction(u64),
    /// Stores a `Vec<u64>` of auction IDs owned by an artist.
    ArtistAuctions(Address),
    /// Stores the global offer counter (u64).
    OfferCount,
    /// Stores a single `Offer` by its ID.
    Offer(u64),
    /// Stores a `Vec<u64>` of offer IDs for a listing.
    ListingOffers(u64),
    /// Stores a `Vec<u64>` of offer IDs made by an offerer.
    OffererOffers(Address),
    /// Stores whether an artist is revoked (bool)
    RevokedArtist(Address),
}

// ── Revocation helpers ───────────────────────────────────────

pub fn is_artist_revoked(env: &Env, artist: &Address) -> bool {
    let key = DataKey::RevokedArtist(artist.clone());
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&key)
        .unwrap_or(false)
}

pub fn set_artist_revocation(env: &Env, artist: &Address, revoked: bool) {
    let key = DataKey::RevokedArtist(artist.clone());
    env.storage().persistent().set(&key, &revoked);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

// ── Bump amounts (ledger sequences) ─────────────────────────
/// Keep persistent entries alive for ~30 days at 6s/ledger.
const LEDGER_TTL_BUMP: u32 = 432_000;
/// Threshold before we extend: re-bump when closer than 10 days out.
const LEDGER_TTL_THRESHOLD: u32 = 144_000;

// ── Counter helpers ──────────────────────────────────────────

pub fn get_listing_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::ListingCount)
        .unwrap_or(0)
}

pub fn increment_listing_count(env: &Env) -> u64 {
    let count = get_listing_count(env) + 1;
    env.storage()
        .persistent()
        .set(&DataKey::ListingCount, &count);
    env.storage().persistent().extend_ttl(
        &DataKey::ListingCount,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
    count
}

// ── Listing CRUD ─────────────────────────────────────────────

pub fn save_listing(env: &Env, listing: &Listing) {
    let key = DataKey::Listing(listing.listing_id);
    env.storage().persistent().set(&key, listing);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_listing(env: &Env, listing_id: u64) -> Option<Listing> {
    let key = DataKey::Listing(listing_id);
    let result = env.storage().persistent().get::<DataKey, Listing>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    result
}

// ── Artist listing index ─────────────────────────────────────

pub fn get_artist_listing_ids(env: &Env, artist: &Address) -> Vec<u64> {
    let key = DataKey::ArtistListings(artist.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

// ── Auction counter helpers ───────────────────────────────────────

pub fn get_auction_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::AuctionCount)
        .unwrap_or(0)
}

pub fn increment_auction_count(env: &Env) -> u64 {
    let count = get_auction_count(env) + 1;
    env.storage()
        .persistent()
        .set(&DataKey::AuctionCount, &count);
    env.storage().persistent().extend_ttl(
        &DataKey::AuctionCount,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
    count
}

// ── Auction CRUD ─────────────────────────────────────────────

pub fn save_auction(env: &Env, auction: &crate::types::Auction) {
    let key = DataKey::Auction(auction.auction_id);
    env.storage().persistent().set(&key, auction);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_auction(env: &Env, auction_id: u64) -> Option<crate::types::Auction> {
    let key = DataKey::Auction(auction_id);
    let result = env
        .storage()
        .persistent()
        .get::<DataKey, crate::types::Auction>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    result
}

// ── Artist auction index ─────────────────────────────────────

pub fn get_artist_auction_ids(env: &Env, artist: &Address) -> Vec<u64> {
    let key = DataKey::ArtistAuctions(artist.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_artist_auction_id(env: &Env, artist: &Address, auction_id: u64) {
    let key = DataKey::ArtistAuctions(artist.clone());
    let mut ids = get_artist_auction_ids(env, artist);
    ids.push_back(auction_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn add_artist_listing_id(env: &Env, artist: &Address, listing_id: u64) {
    let key = DataKey::ArtistListings(artist.clone());
    let mut ids = get_artist_listing_ids(env, artist);
    ids.push_back(listing_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

// ── Protocol fee and treasury storage ─────────────────────

pub fn set_treasury_storage(env: &Env, addr: &Address) {
    env.storage().persistent().set(&DataKey::Treasury, addr);
}

pub fn get_treasury_storage(env: &Env) -> Option<Address> {
    env.storage().persistent().get(&DataKey::Treasury)
}

pub fn set_protocol_fee_bps_storage(env: &Env, bps: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::ProtocolFeeBps, &bps);
}

pub fn get_protocol_fee_bps_storage(env: &Env) -> Option<u32> {
    env.storage().persistent().get(&DataKey::ProtocolFeeBps)
}

// ── Offer counter helpers ───────────────────────────────────────

pub fn get_offer_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::OfferCount)
        .unwrap_or(0)
}

pub fn increment_offer_count(env: &Env) -> u64 {
    let count = get_offer_count(env) + 1;
    env.storage().persistent().set(&DataKey::OfferCount, &count);
    env.storage().persistent().extend_ttl(
        &DataKey::OfferCount,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
    count
}

// ── Offer CRUD ─────────────────────────────────────────────

pub fn save_offer(env: &Env, offer: &Offer) {
    let key = DataKey::Offer(offer.offer_id);
    env.storage().persistent().set(&key, offer);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_offer(env: &Env, offer_id: u64) -> Option<Offer> {
    let key = DataKey::Offer(offer_id);
    let result = env.storage().persistent().get::<DataKey, Offer>(&key);
    if result.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    result
}

// ── Listing offers index ─────────────────────────────────────

pub fn load_listing_offers(env: &Env, listing_id: u64) -> Vec<u64> {
    let key = DataKey::ListingOffers(listing_id);
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn save_listing_offers(env: &Env, listing_id: u64, ids: &Vec<u64>) {
    let key = DataKey::ListingOffers(listing_id);
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

// ── Offerer offers index ─────────────────────────────────────

pub fn load_offerer_offers(env: &Env, offerer: &Address) -> Vec<u64> {
    let key = DataKey::OffererOffers(offerer.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn save_offerer_offers(env: &Env, offerer: &Address, ids: &Vec<u64>) {
    let key = DataKey::OffererOffers(offerer.clone());
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}
