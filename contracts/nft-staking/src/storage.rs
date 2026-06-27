use crate::types::StakedPosition;
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    StakedPosition(Address, Address, u64),
    UserStakes(Address),
    RewardConfig,
    TotalStaked,
    Admin,
    IsPaused,
    TokenWhitelist,
    Initialized,
    NftAddress,
    RewardToken,
}

pub const LEDGER_TTL_BUMP: u32 = 432_000;
pub const LEDGER_TTL_THRESHOLD: u32 = 144_000;

pub fn save_staked_position(env: &Env, key: &DataKey, position: &StakedPosition) {
    env.storage().persistent().set(key, position);
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_staked_position(env: &Env, key: &DataKey) -> Option<StakedPosition> {
    let res = env
        .storage()
        .persistent()
        .get::<DataKey, StakedPosition>(key);
    if res.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }
    res
}

pub fn remove_staked_position(env: &Env, key: &DataKey) {
    env.storage().persistent().remove(key);
}

pub fn add_user_stake(env: &Env, user: &Address, position_key: DataKey) {
    let key = DataKey::UserStakes(user.clone());
    let mut stakes = env
        .storage()
        .persistent()
        .get::<_, Vec<DataKey>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    stakes.push_back(position_key);
    env.storage().persistent().set(&key, &stakes);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn get_user_stakes(env: &Env, user: &Address) -> Vec<DataKey> {
    let key = DataKey::UserStakes(user.clone());
    env.storage()
        .persistent()
        .get::<_, Vec<DataKey>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn remove_user_stake(env: &Env, user: &Address, position_key: &DataKey) {
    let key = DataKey::UserStakes(user.clone());
    let stakes = env
        .storage()
        .persistent()
        .get::<_, Vec<DataKey>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    let mut updated = Vec::new(env);
    for s in stakes.iter() {
        let same = match (s.clone(), position_key) {
            (DataKey::StakedPosition(a1, b1, c1), DataKey::StakedPosition(a2, b2, c2)) => {
                a1 == *a2 && b1 == *b2 && c1 == *c2
            }
            _ => false,
        };
        if !same {
            updated.push_back(s);
        }
    }
    env.storage().persistent().set(&key, &updated);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn set_total_staked(env: &Env, count: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::TotalStaked, &count);
    env.storage().persistent().extend_ttl(
        &DataKey::TotalStaked,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
}

pub fn get_total_staked(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get::<DataKey, u64>(&DataKey::TotalStaked)
        .unwrap_or(0)
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn set_nft_address(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::NftAddress, addr);
}

pub fn get_nft_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::NftAddress)
}

pub fn set_reward_token(env: &Env, addr: &Address) {
    env.storage().instance().set(&DataKey::RewardToken, addr);
}

pub fn get_reward_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::RewardToken)
}

pub fn set_reward_config(env: &Env, config: &crate::types::RewardConfig) {
    env.storage()
        .persistent()
        .set(&DataKey::RewardConfig, config);
    env.storage().persistent().extend_ttl(
        &DataKey::RewardConfig,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
}

pub fn get_reward_config(env: &Env) -> Option<crate::types::RewardConfig> {
    env.storage().persistent().get(&DataKey::RewardConfig)
}
