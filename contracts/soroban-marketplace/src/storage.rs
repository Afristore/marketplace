#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::{Address as _, Events}, Env, Address, bytes, symbol_short};
    use crate::{MarketplaceContract, MarketplaceContractClient};

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

use crate::types::Listing;

/// Storage key for the admin address
pub const ADMIN_KEY: &str = "admin";

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
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::ListingCount, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
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
    env.storage().persistent().set(&DataKey::ProtocolFeeBps, &bps);
}

pub fn get_protocol_fee_bps_storage(env: &Env) -> Option<u32> {
    env.storage().persistent().get(&DataKey::ProtocolFeeBps)
}
