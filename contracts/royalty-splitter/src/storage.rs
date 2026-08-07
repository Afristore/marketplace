use soroban_sdk::{contracttype, Address, Env, Vec};

pub const MAX_BENEFICIARIES: u32 = 20;
pub const LEDGER_TTL_BUMP: u32 = 432_000;
pub const LEDGER_TTL_THRESHOLD: u32 = 144_000;

// Add these to the storage module
const ADMIN_KEY: &[u8] = b"admin";

#[contracttype]
pub enum DataKey {
    Initialized,
    Token,
    Beneficiaries,
    Shares,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage().persistent().set(&DataKey::Initialized, &true);
    env.storage().persistent().extend_ttl(
        &DataKey::Initialized,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
}

pub fn save_token(env: &Env, token: &Address) {
    env.storage().persistent().set(&DataKey::Token, token);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Token, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_token(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get::<DataKey, Address>(&DataKey::Token)
        .expect("token not set")
}

pub fn save_beneficiaries(env: &Env, beneficiaries: &Vec<Address>) {
    env.storage()
        .persistent()
        .set(&DataKey::Beneficiaries, beneficiaries);
    env.storage().persistent().extend_ttl(
        &DataKey::Beneficiaries,
        LEDGER_TTL_THRESHOLD,
        LEDGER_TTL_BUMP,
    );
}

pub fn load_beneficiaries(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get::<DataKey, Vec<Address>>(&DataKey::Beneficiaries)
        .expect("beneficiaries not set")
}

pub fn save_shares(env: &Env, shares: &Vec<u32>) {
    env.storage().persistent().set(&DataKey::Shares, shares);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Shares, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}

pub fn load_shares(env: &Env) -> Vec<u32> {
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u32>>(&DataKey::Shares)
        .expect("shares not set")
}


pub fn save_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN_KEY, admin);
}

pub fn load_admin(env: &Env) -> Address {
    env.storage().instance().get(&ADMIN_KEY).unwrap()
}

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&ADMIN_KEY)
}
