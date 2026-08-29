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

// 30 days in ledgers (assuming ~5 seconds per ledger)
const BUMP_AMOUNT: u32 = 30 * 17280;
// We also need a minimum threshold before bumping
const BUMP_THRESHOLD: u32 = 15 * 17280;

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

pub fn get_config(env: &Env) -> PlatformConfig {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

pub fn set_config(env: &Env, config: &PlatformConfig) {
    env.storage().instance().set(&DataKey::Config, config);
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
    id
}

pub fn get_listing(env: &Env, id: u64) -> Listing {
    let key = DataKey::Listing(id);
    let listing: Listing = env.storage().persistent().get(&key).unwrap();
    bump_persistent(env, &key);
    listing
}

pub fn set_listing(env: &Env, id: u64, listing: &Listing) {
    let key = DataKey::Listing(id);
    env.storage().persistent().set(&key, listing);
    bump_persistent(env, &key);
}

pub fn has_listing(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Listing(id))
}

pub fn get_position(env: &Env, id: u64) -> Position {
    let key = DataKey::Position(id);
    let position: Position = env.storage().persistent().get(&key).unwrap();
    bump_persistent(env, &key);
    position
}

pub fn set_position(env: &Env, id: u64, position: &Position) {
    let key = DataKey::Position(id);
    env.storage().persistent().set(&key, position);
    bump_persistent(env, &key);
}

pub fn has_position(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::Position(id))
}

pub fn get_currency_symbol(env: &Env, currency: &Address) -> String {
    let key = DataKey::WhitelistedCurrency(currency.clone());
    let symbol: String = env.storage().persistent().get(&key).unwrap();
    bump_persistent(env, &key);
    symbol
}

pub fn set_currency_symbol(env: &Env, currency: &Address, symbol: &String) {
    let key = DataKey::WhitelistedCurrency(currency.clone());
    env.storage().persistent().set(&key, symbol);
    bump_persistent(env, &key);
}

pub fn is_currency_whitelisted(env: &Env, currency: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::WhitelistedCurrency(currency.clone()))
}
