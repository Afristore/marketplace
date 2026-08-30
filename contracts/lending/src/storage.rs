use crate::types::{Listing, PlatformConfig, Position};
use soroban_sdk::{contracttype, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    NextListingId,
    NextPositionId,
    Listing(u64),
    Position(u64),
    WhitelistedCurrency(Address),
}

/// Persistent storage TTL bump amount (~31 days in ledgers, assuming ~5 seconds per ledger).
/// Derivation: (535_000 ledgers * 5 seconds) / 86,400 seconds/day ≈ 30.96 days.
/// This ensures open listings and active positions outlive the longest allowed loan duration.
pub const PERSISTENT_BUMP_AMOUNT: u32 = 535_000;

/// Persistent storage TTL threshold (~29 days in ledgers, assuming ~5 seconds per ledger).
/// Derivation: (500_000 ledgers * 5 seconds) / 86,400 seconds/day ≈ 28.93 days.
pub const PERSISTENT_THRESHOLD: u32 = 500_000;

/// Instance storage TTL bump amount (~31 days in ledgers, assuming ~5 seconds per ledger).
pub const INSTANCE_BUMP_AMOUNT: u32 = 535_000;

/// Instance storage TTL threshold (~29 days in ledgers, assuming ~5 seconds per ledger).
pub const INSTANCE_THRESHOLD: u32 = 500_000;

/// Extend instance storage TTL
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

/// Extend persistent storage TTL for a given key
pub fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_config(env: &Env) -> PlatformConfig {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn set_config(env: &Env, config: &PlatformConfig) {
    env.storage().instance().set(&DataKey::Config, config);
    extend_instance_ttl(env);
}

pub fn has_config(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn next_listing_id(env: &Env) -> u64 {
    let mut id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextListingId)
        .unwrap_or(0);
    id += 1;
    env.storage().instance().set(&DataKey::NextListingId, &id);
    extend_instance_ttl(env);
    id
}

pub fn next_position_id(env: &Env) -> u64 {
    let mut id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextPositionId)
        .unwrap_or(0);
    id += 1;
    env.storage().instance().set(&DataKey::NextPositionId, &id);
    extend_instance_ttl(env);
    id
}

pub fn get_listing(env: &Env, id: u64) -> Listing {
    let key = DataKey::Listing(id);
    let listing: Listing = env.storage().persistent().get(&key).unwrap();
    extend_persistent_ttl(env, &key);
    listing
}

pub fn set_listing(env: &Env, id: u64, listing: &Listing) {
    let key = DataKey::Listing(id);
    env.storage().persistent().set(&key, listing);
    extend_persistent_ttl(env, &key);
}

pub fn has_listing(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Listing(id))
}

pub fn get_position(env: &Env, id: u64) -> Position {
    let key = DataKey::Position(id);
    let position: Position = env.storage().persistent().get(&key).unwrap();
    extend_persistent_ttl(env, &key);
    position
}

pub fn set_position(env: &Env, id: u64, position: &Position) {
    let key = DataKey::Position(id);
    env.storage().persistent().set(&key, position);
    extend_persistent_ttl(env, &key);
}

pub fn has_position(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Position(id))
}

pub fn get_currency_symbol(env: &Env, currency: &Address) -> String {
    let key = DataKey::WhitelistedCurrency(currency.clone());
    let symbol: String = env.storage().persistent().get(&key).unwrap();
    extend_persistent_ttl(env, &key);
    symbol
}

pub fn set_currency_symbol(env: &Env, currency: &Address, symbol: &String) {
    let key = DataKey::WhitelistedCurrency(currency.clone());
    env.storage().persistent().set(&key, symbol);
    extend_persistent_ttl(env, &key);
}

pub fn is_currency_whitelisted(env: &Env, currency: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::WhitelistedCurrency(currency.clone()))
}
