//! NormalNFT1155 — ERC-1155-equivalent on Soroban.
//!
//! Supports multiple token types per contract. Each token type can have
//! fungible supply (edition sizes). The creator mints token IDs on demand
//! via `mint_new` (auto-increments ID) or `mint` (explicit ID for resupply).
//! Batch operations mirror ERC-1155 `safeBatchTransferFrom`.
#![no_std]
#![allow(clippy::too_many_arguments, deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, String, Vec,
};

const TTL_THRESHOLD: u32 = 50_000;
const TTL_BUMP: u32 = 100_000;

// ─── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotApproved = 3,
    InsufficientBalance = 4,
    LengthMismatch = 5,
    NotCreator = 6,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Instance storage
    Initialized,
    Creator,
    Name,
    NextTokenId,
    RoyaltyBps,
    RoyaltyReceiver,
    // Persistent storage
    Balance(Address, u64),            // (account, token_id) → u128
    ApprovedForAll(Address, Address), // (owner, operator) → bool
    TokenUri(u64),
    TotalSupply(u64), // per token_id
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct NormalNFT1155;

#[contractimpl]
impl NormalNFT1155 {
    // ── Initializer ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        creator: Address,
        name: String,
        royalty_bps: u32,
        royalty_receiver: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::NextTokenId, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyBps, &royalty_bps);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &royalty_receiver);
        env.storage().instance().extend_ttl(50_000, 100_000);
        Ok(())
    }

    // ── Minting ───────────────────────────────────────────────────────────

    /// Create a brand new token type, auto-assign the next ID.
    /// Returns the new token_id.
    pub fn mint_new(env: Env, to: Address, amount: u128, uri: String) -> Result<u64, Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        let token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        Self::_mint(&env, &to, token_id, amount, &uri);
        env.storage()
            .instance()
            .set(&DataKey::NextTokenId, &(token_id + 1));
        Ok(token_id)
    }

    /// Mint additional supply of an existing token type (explicit token_id).
    pub fn mint(
        env: Env,
        to: Address,
        token_id: u64,
        amount: u128,
        uri: String,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        Self::_mint(&env, &to, token_id, amount, &uri);
        Ok(())
    }

    /// Batch-mint multiple token types in one call.
    /// Optimized to minimize storage I/O.
    pub fn mint_batch(
        env: Env,
        to: Address,
        token_ids: Vec<u64>,
        amounts: Vec<u128>,
        uris: Vec<String>,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        
        let len = token_ids.len();
        if len == 0 {
            return Ok(());
        }
        
        if token_ids.len() != amounts.len() || token_ids.len() != uris.len() {
            return Err(Error::LengthMismatch);
        }
        
        // Read NextTokenId once
        let next_token_id = env.storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        let mut max_token_id = next_token_id;
        
        // Process each token type
        for i in 0..len {
            let token_id = token_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            let uri = uris.get(i).unwrap();
            
            // Track max token ID
            if token_id >= max_token_id {
                max_token_id = token_id + 1;
            }
            
            // Set URI if this is a new token type
            if !env.storage().persistent().has(&DataKey::TokenUri(token_id)) {
                env.storage()
                    .persistent()
                    .set(&DataKey::TokenUri(token_id), &uri);
                env.storage()
                    .persistent()
                    .extend_ttl(&DataKey::TokenUri(token_id), TTL_THRESHOLD, TTL_BUMP);
            }
            
            // Update balance
            let balance_key = DataKey::Balance(to.clone(), token_id);
            let current_balance: u128 = env
                .storage()
                .persistent()
                .get(&balance_key)
                .unwrap_or(0);
            let new_balance = current_balance + amount;
            env.storage().persistent().set(&balance_key, &new_balance);
            env.storage()
                .persistent()
                .extend_ttl(&balance_key, TTL_THRESHOLD, TTL_BUMP);
            
            // Update total supply
            let supply_key = DataKey::TotalSupply(token_id);
            let current_supply: u128 = env
                .storage()
                .persistent()
                .get(&supply_key)
                .unwrap_or(0);
            let new_supply = current_supply + amount;
            env.storage().persistent().set(&supply_key, &new_supply);
            env.storage()
                .persistent()
                .extend_ttl(&supply_key, TTL_THRESHOLD, TTL_BUMP);
            
            // Emit event
            env.events()
                .publish((symbol_short!("mint"), to.clone()), (token_id, amount));
        }
        
        // Update NextTokenId once at the end if needed
        if max_token_id > next_token_id {
            env.storage()
                .instance()
                .set(&DataKey::NextTokenId, &max_token_id);
        }
        
        Ok(())
    }

    // ── Transfers ─────────────────────────────────────────────────────────

    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        from.require_auth();
        Self::_transfer(&env, &from, &to, token_id, amount)
    }

    /// Operator transfer on behalf of `from`.
    pub fn transfer_from(
        env: Env,
        operator: Address,
        from: Address,
        to: Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        operator.require_auth();
        if !Self::_is_approved_for_all(&env, &operator, &from) {
            return Err(Error::NotApproved);
        }
        Self::_transfer(&env, &from, &to, token_id, amount)
    }

    /// Batch transfer — mirrors `safeBatchTransferFrom`.
    pub fn batch_transfer(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_ids: Vec<u64>,
        amounts: Vec<u128>,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        spender.require_auth();

        // [SECURITY] Allow owner or authorized operator (#48)
        if spender != from && !Self::_is_approved_for_all(&env, &spender, &from) {
            return Err(Error::NotApproved);
        }

        if token_ids.len() != amounts.len() {
            return Err(Error::LengthMismatch);
        }
        for i in 0..token_ids.len() {
            let id = token_ids.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            Self::_transfer(&env, &from, &to, id, amount)?;
        }
        Ok(())
    }

    // ── Approvals ─────────────────────────────────────────────────────────

    pub fn set_approval_for_all(env: Env, owner: Address, operator: Address, approved: bool) {
        Self::extend_instance_ttl(&env);
        owner.require_auth();
        let key = DataKey::ApprovedForAll(owner.clone(), operator.clone());
        env.storage().persistent().set(&key, &approved);
        env.storage().persistent().extend_ttl(&key, 50_000, 100_000);
        env.events()
            .publish((symbol_short!("appr_all"), owner), (operator, approved));
    }

    // ── Burn ──────────────────────────────────────────────────────────────

    pub fn burn(
        env: Env,
        spender: Address,
        from: Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        spender.require_auth();

        // [SECURITY] Allow owner or authorized operator to burn (#48)
        if spender != from && !Self::_is_approved_for_all(&env, &spender, &from) {
            return Err(Error::NotApproved);
        }

        let bal: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone(), token_id))
            .unwrap_or(0);
        if bal < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Balance(from.clone(), token_id), &(bal - amount));
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(from.clone(), token_id),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        let supply: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalSupply(token_id))
            .unwrap_or(amount);
        env.storage().persistent().set(
            &DataKey::TotalSupply(token_id),
            &(supply.saturating_sub(amount)),
        );
        env.storage().persistent().extend_ttl(
            &DataKey::TotalSupply(token_id),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        env.events()
            .publish((symbol_short!("burn"), from), (token_id, amount));
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────

    pub fn balance_of(env: Env, account: Address, token_id: u64) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(account, token_id))
            .unwrap_or(0)
    }

    /// Batch balance query — mirrors ERC-1155 `balanceOfBatch`.
    pub fn balance_of_batch(env: Env, accounts: Vec<Address>, token_ids: Vec<u64>) -> Vec<u128> {
        if accounts.len() != token_ids.len() {
            return Vec::new(&env);
        }

        let mut result = Vec::new(&env);
        for i in 0..accounts.len() {
            let account = accounts.get(i).unwrap();
            let token_id = token_ids.get(i).unwrap();
            let bal: u128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(account.clone(), token_id))
                .unwrap_or(0);
            result.push_back(bal);
        }
        result
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        Self::_is_approved_for_all(&env, &operator, &owner)
    }

    pub fn uri(env: Env, token_id: u64) -> String {
        env.storage()
            .persistent()
            .get(&DataKey::TokenUri(token_id))
            .unwrap()
    }

    pub fn total_supply(env: Env, token_id: u64) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalSupply(token_id))
            .unwrap_or(0)
    }

    pub fn next_token_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn creator(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Creator).unwrap()
    }

    pub fn royalty_info(env: Env) -> (Address, u32) {
        (
            env.storage()
                .instance()
                .get(&DataKey::RoyaltyReceiver)
                .unwrap(),
            env.storage()
                .instance()
                .get(&DataKey::RoyaltyBps)
                .unwrap_or(0),
        )
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    pub fn transfer_ownership(env: Env, new_creator: Address) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::Creator, &new_creator);
        Ok(())
    }

    pub fn update_royalty(env: Env, receiver: Address, bps: u32) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &receiver);
        env.storage().instance().set(&DataKey::RoyaltyBps, &bps);
        Ok(())
    }

    // ── Private helpers ───────────────────────────────────────────────────

    fn extend_instance_ttl(env: &Env) {
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
    }

    fn only_creator(env: &Env) -> Result<Address, Error> {
        let creator: Address = env
            .storage()
            .instance()
            .get(&DataKey::Creator)
            .ok_or(Error::NotInitialized)?;
        creator.require_auth();
        Ok(creator)
    }

    fn _mint(env: &Env, to: &Address, token_id: u64, amount: u128, uri: &String) {
        let bal: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone(), token_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone(), token_id), &(bal + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone(), token_id),
            50_000,
            100_000,
        );

        // URI is set once; resupply mints don't overwrite it
        if !env.storage().persistent().has(&DataKey::TokenUri(token_id)) {
            env.storage()
                .persistent()
                .set(&DataKey::TokenUri(token_id), uri);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::TokenUri(token_id), 50_000, 100_000);
        }

        let supply: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalSupply(token_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::TotalSupply(token_id), &(supply + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::TotalSupply(token_id),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        env.events()
            .publish((symbol_short!("mint"), to.clone()), (token_id, amount));
    }

    fn _transfer(
        env: &Env,
        from: &Address,
        to: &Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        let from_bal: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone(), token_id))
            .unwrap_or(0);
        if from_bal < amount {
            return Err(Error::InsufficientBalance);
        }

        env.storage().persistent().set(
            &DataKey::Balance(from.clone(), token_id),
            &(from_bal - amount),
        );
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(from.clone(), token_id),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        let to_bal: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone(), token_id))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to.clone(), token_id), &(to_bal + amount));
        env.storage().persistent().extend_ttl(
            &DataKey::Balance(to.clone(), token_id),
            50_000,
            100_000,
        );

        env.events().publish(
            (symbol_short!("transfer"), from.clone()),
            (to.clone(), token_id, amount),
        );
        Ok(())
    }

    fn _is_approved_for_all(env: &Env, operator: &Address, owner: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ApprovedForAll(owner.clone(), operator.clone()))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod test;