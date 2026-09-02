use soroban_sdk::{Address, Env};

use crate::types::{BorrowPosition, DataKey};

pub const LEDGER_TTL_THRESHOLD: u32 = 172_800; // ~10 days
pub const LEDGER_TTL_BUMP: u32 = 518_400; // ~30 days

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::IsInitialized)
        .unwrap_or(false)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::IsInitialized, &true);
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_collateral_token(env: &Env, token: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::CollateralToken, token);
}

pub fn get_collateral_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::CollateralToken)
}

pub fn set_borrow_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::BorrowToken, token);
}

pub fn get_borrow_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::BorrowToken)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::IsPaused, &paused);
}

pub fn load_borrow_position(env: &Env, borrower: &Address) -> Option<BorrowPosition> {
    let key = DataKey::BorrowPosition(borrower.clone());
    env.storage().persistent().get(&key)
}

pub fn save_borrow_position(env: &Env, position: &BorrowPosition) {
    let key = DataKey::BorrowPosition(position.borrower.clone());
    env.storage().persistent().set(&key, position);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
}
