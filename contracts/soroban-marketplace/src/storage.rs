// storage.rs
use crate::types::{Auction, Listing, Offer};
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    ListingCount,
    Listing(u64),
    ArtistListings(Address),
    Admin,
    TokenWhitelist,
    Treasury,
    ProtocolFeeBps,
    AuctionCount,
    Auction(u64),
    ArtistAuctions(Address),
    RevokedArtist(Address),
    OfferCount,
    Offer(u64),
    ListingOffers(u64),
    OffererOffers(Address),
}

const LEDGER_TTL_BUMP: u32 = 432_000;
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

// ── CRUD methods ─────────────────────────────────────────────

pub fn save_listing(env: &Env, listing: &Listing) {
    let key = DataKey::Listing(listing.listing_id);
    env.storage().persistent().set(&key, listing);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_listing(env: &Env, listing_id: u64) -> Option<Listing> {
    let key = DataKey::Listing(listing_id);
    let res = env.storage().persistent().get::<DataKey, Listing>(&key);
    if res.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    res
}

pub fn save_auction(env: &Env, auction: &Auction) {
    let key = DataKey::Auction(auction.auction_id);
    env.storage().persistent().set(&key, auction);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_auction(env: &Env, auction_id: u64) -> Option<Auction> {
    let key = DataKey::Auction(auction_id);
    let res = env.storage().persistent().get::<DataKey, Auction>(&key);
    if res.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    res
}

pub fn save_offer(env: &Env, offer: &Offer) {
    let key = DataKey::Offer(offer.offer_id);
    env.storage().persistent().set(&key, offer);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_offer(env: &Env, offer_id: u64) -> Option<Offer> {
    let key = DataKey::Offer(offer_id);
    let res = env.storage().persistent().get::<DataKey, Offer>(&key);
    if res.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    res
}

// ── Indices ──────────────────────────────────────────────────

pub fn add_artist_listing_id(env: &Env, artist: &Address, listing_id: u64) {
    let key = DataKey::ArtistListings(artist.clone());
    let mut ids = env
        .storage()
        .persistent()
        .get::<_, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(listing_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn get_artist_listing_ids(env: &Env, artist: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get::<_, Vec<u64>>(&DataKey::ArtistListings(artist.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_artist_auction_id(env: &Env, artist: &Address, auction_id: u64) {
    let key = DataKey::ArtistAuctions(artist.clone());
    let mut ids = env
        .storage()
        .persistent()
        .get::<_, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(auction_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}


pub fn save_listing_offers(env: &Env, listing_id: u64, ids: &Vec<u64>) {
    let key = DataKey::ListingOffers(listing_id);
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_listing_offers(env: &Env, listing_id: u64) -> Vec<u64> {
    env.storage()
        .persistent()
        .get::<_, Vec<u64>>(&DataKey::ListingOffers(listing_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn save_offerer_offers(env: &Env, offerer: &Address, ids: &Vec<u64>) {
    let key = DataKey::OffererOffers(offerer.clone());
    env.storage().persistent().set(&key, ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_offerer_offers(env: &Env, offerer: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get::<_, Vec<u64>>(&DataKey::OffererOffers(offerer.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

// ── Moderation & Configuration storage ────────────────────

pub fn set_artist_revocation_storage(env: &Env, artist: &Address) {
    let key = DataKey::RevokedArtist(artist.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn remove_artist_revocation_storage(env: &Env, artist: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::RevokedArtist(artist.clone()));
}

pub fn is_artist_revoked_storage(env: &Env, artist: &Address) -> bool {
    let key = DataKey::RevokedArtist(artist.clone());
    let revoked = env
        .storage()
        .persistent()
        .get::<_, bool>(&key)
        .unwrap_or(false);
    if revoked {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    revoked
}

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
