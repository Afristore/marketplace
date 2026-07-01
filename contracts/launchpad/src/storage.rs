use soroban_sdk::{Address, BytesN, Env, Vec};

use crate::types::{CollectionKind, CollectionRecord, DataKey, Error};

const TTL_THRESHOLD: u32 = 50_000;
const TTL_BUMP: u32 = 100_000;

pub fn extend_instance_ttl(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
    extend_instance_ttl(env);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_platform_fee(env: &Env, receiver: &Address, bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeReceiver, receiver);
    env.storage().instance().set(&DataKey::PlatformFeeBps, &bps);
}

pub fn get_platform_fee(env: &Env) -> (Address, u32) {
    (
        env.storage()
            .instance()
            .get(&DataKey::PlatformFeeReceiver)
            .unwrap(),
        env.storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(0),
    )
}

pub fn set_wasm_hashes(
    env: &Env,
    normal_721: &BytesN<32>,
    normal_1155: &BytesN<32>,
    lazy_721: &BytesN<32>,
    lazy_1155: &BytesN<32>,
) {
    env.storage()
        .instance()
        .set(&DataKey::WasmNormal721, normal_721);
    env.storage()
        .instance()
        .set(&DataKey::WasmNormal1155, normal_1155);
    env.storage()
        .instance()
        .set(&DataKey::WasmLazy721, lazy_721);
    env.storage()
        .instance()
        .set(&DataKey::WasmLazy1155, lazy_1155);
}

pub fn get_wasm_normal_721(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmNormal721)
}

pub fn get_wasm_normal_1155(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmNormal1155)
}

pub fn get_wasm_lazy_721(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmLazy721)
}

pub fn get_wasm_lazy_1155(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmLazy1155)
}

pub fn set_staking_wasm_hash(env: &Env, hash: &BytesN<32>) {
    env.storage().instance().set(&DataKey::WasmStaking, hash);
}

pub fn get_staking_wasm_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmStaking)
}

pub fn set_royalty_splitter_wasm_hash(env: &Env, hash: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&DataKey::WasmRoyaltySplitter, hash);
}

pub fn get_royalty_splitter_wasm_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&DataKey::WasmRoyaltySplitter)
}

pub fn staking_pool_by_nft(env: &Env, nft_address: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::StakingPoolByNft(nft_address.clone()))
}

pub fn record_staking_pool(env: &Env, nft_address: &Address, pool_address: &Address) {
    env.storage().persistent().set(
        &DataKey::StakingPoolByNft(nft_address.clone()),
        pool_address,
    );
    env.storage().persistent().extend_ttl(
        &DataKey::StakingPoolByNft(nft_address.clone()),
        TTL_THRESHOLD,
        TTL_BUMP,
    );
}

pub fn collections_by_creator(env: &Env, creator: &Address) -> Vec<CollectionRecord> {
    let count = creator_collection_count(env, creator);
    let mut result = Vec::new(env);
    let mut i = 0u64;

    while i < count {
        if let Some(collection) = creator_collection_by_index(env, creator, i) {
            result.push_back(collection);
        }
        i += 1;
    }

    result
}

pub fn all_collections(env: &Env) -> Vec<CollectionRecord> {
    let count = collection_count(env);
    let mut result = Vec::new(env);
    let mut i = 0u64;

    while i < count {
        if let Some(collection) = collection_by_index(env, i) {
            result.push_back(collection);
        }
        i += 1;
    }

    result
}

pub fn collections_paginated(env: &Env, start: u64, limit: u64) -> Vec<CollectionRecord> {
    let count = collection_count(env);
    let mut result = Vec::new(env);
    let end = (start + limit).min(count);
    let mut i = start;

    while i < end {
        if let Some(collection) = collection_by_index(env, i) {
            result.push_back(collection);
        }
        i += 1;
    }

    result
}

// Counter for total collections ever deployed through this launchpad.
pub fn collection_count(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::CollectionCount)
        .unwrap_or(0)
}

// ── Private helpers ───────────────────────────────────────────────────

pub fn require_admin(env: &Env) -> Result<Address, Error> {
    let admin = get_admin(env).ok_or(Error::NotInitialized)?;
    admin.require_auth();
    Ok(admin)
}
/// Get a collection record by its deployed contract address.
pub fn collection_by_address(env: &Env, address: &Address) -> Option<CollectionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::CollectionByAddress(address.clone()))
}

pub fn record_collection(env: &Env, creator: &Address, address: &Address, kind: CollectionKind) {
    let rec = CollectionRecord {
        address: address.clone(),
        kind,
        creator: creator.clone(),
    };

    // Global indexed storage (#51) — each record in its own key, no Vec bloat
    let global_idx = collection_count(env);
    env.storage()
        .persistent()
        .set(&DataKey::CollectionByIndex(global_idx), &rec);
    env.storage().persistent().extend_ttl(
        &DataKey::CollectionByIndex(global_idx),
        TTL_THRESHOLD,
        TTL_BUMP,
    );

    // Per-creator indexed storage (#51) — same pattern per creator
    let creator_count: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::CreatorCollectionCount(creator.clone()))
        .unwrap_or(0);
    env.storage().persistent().set(
        &DataKey::CreatorCollectionByIndex(creator.clone(), creator_count),
        &rec,
    );
    env.storage().persistent().extend_ttl(
        &DataKey::CreatorCollectionByIndex(creator.clone(), creator_count),
        TTL_THRESHOLD,
        TTL_BUMP,
    );
    env.storage().persistent().set(
        &DataKey::CreatorCollectionCount(creator.clone()),
        &(creator_count + 1),
    );

    // Increment global counter
    let next = global_idx + 1;
    env.storage()
        .persistent()
        .set(&DataKey::CollectionCount, &next);

    // Address-based lookup — allows get_collection_by_id queries
    env.storage()
        .persistent()
        .set(&DataKey::CollectionByAddress(address.clone()), &rec);
    env.storage().persistent().extend_ttl(
        &DataKey::CollectionByAddress(address.clone()),
        TTL_THRESHOLD,
        TTL_BUMP,
    );
}

/// Get a collection by global index.
pub fn collection_by_index(env: &Env, index: u64) -> Option<CollectionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::CollectionByIndex(index))
}

/// Get per-creator collection count.
pub fn creator_collection_count(env: &Env, creator: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::CreatorCollectionCount(creator.clone()))
        .unwrap_or(0)
}

/// Get a creator's collection by index.
pub fn creator_collection_by_index(
    env: &Env,
    creator: &Address,
    index: u64,
) -> Option<CollectionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::CreatorCollectionByIndex(creator.clone(), index))
}

pub fn set_approved_currency(env: &Env, currency: &Address, approved: bool) {
    env.storage()
        .instance()
        .set(&DataKey::ApprovedCurrency(currency.clone()), &approved);
}

pub fn is_approved_currency(env: &Env, currency: &Address) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::ApprovedCurrency(currency.clone()))
        .unwrap_or(false)
}

pub fn require_approved_currency(env: &Env, currency: &Address) -> Result<(), crate::types::Error> {
    if !is_approved_currency(env, currency) {
        return Err(crate::types::Error::InvalidCurrency);
    }
    Ok(())
}
