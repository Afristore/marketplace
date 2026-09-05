use soroban_sdk::{contracttype, Env};

use crate::types::{LendingListing, PlatformConfig, Position};

#[contracttype]
pub enum DataKey {
    Config,
    ListingCount,
    Listing(u64),
    Position(u64),
}

pub fn set_config(env: &Env, config: &PlatformConfig) {
    env.storage().persistent().set(&DataKey::Config, config);
}

pub fn get_config(env: &Env) -> PlatformConfig {
    env.storage()
        .persistent()
        .get(&DataKey::Config)
        .expect("config not initialized")
}

pub fn increment_listing_count(env: &Env) -> u64 {
    let key = DataKey::ListingCount;
    let count: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    let new_count = count + 1;
    env.storage().persistent().set(&key, &new_count);
    new_count
}

pub fn save_listing(env: &Env, listing: &LendingListing) {
    let key = DataKey::Listing(listing.listing_id);
    env.storage().persistent().set(&key, listing);
}

pub fn load_listing(env: &Env, listing_id: u64) -> Option<LendingListing> {
    let key = DataKey::Listing(listing_id);
    env.storage().persistent().get(&key)
}

pub fn get_position(env: &Env, position_id: u64) -> Position {
    env.storage()
        .persistent()
        .get(&DataKey::Position(position_id))
        .expect("position not found")
}

pub fn set_position(env: &Env, position_id: u64, position: &Position) {
    env.storage().persistent().set(&DataKey::Position(position_id), position);
}
