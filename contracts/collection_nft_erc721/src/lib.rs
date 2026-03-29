//! NormalNFT721 — ERC-721-equivalent on Soroban.
//!
//! Deployed by the Launchpad factory. The `creator` (collection owner) calls
//! `mint` to issue tokens. Standard transfer / approve / burn logic follows
//! ERC-721 semantics.  Royalty info (bps + receiver) is stored on-chain so
//! marketplaces (Litemint, etc.) can query it.
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
    NotOwner = 3,
    NotApproved = 4,
    TokenNotFound = 5,
    MaxSupplyReached = 6,
    NotCreator = 7,
}

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Instance storage — cheap, shared TTL with contract instance
    Initialized,
    Creator,
    Name,
    Symbol,
    MaxSupply,
    NextTokenId,
    TotalSupply,
    RoyaltyBps,
    RoyaltyReceiver,
    // Persistent storage — per-token / per-owner, independent TTL
    Owner(u64),
    TokenUri(u64),
    Approved(u64),
    BalanceOf(Address),
    ApprovedForAll(Address, Address),
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct NormalNFT721;

#[contractimpl]
#[allow(clippy::too_many_arguments)]
impl NormalNFT721 {
    // ── Initializer (called by Launchpad factory) ──────────────────────────

    pub fn initialize(
        env: Env,
        creator: Address,
        name: String,
        symbol: String,
        max_supply: u64,  // pass u64::MAX for unlimited
        royalty_bps: u32, // e.g. 500 = 5%
        royalty_receiver: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
        env.storage()
            .instance()
            .set(&DataKey::MaxSupply, &max_supply);
        env.storage().instance().set(&DataKey::NextTokenId, &0u64);
        env.storage().instance().set(&DataKey::TotalSupply, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyBps, &royalty_bps);
        env.storage()
            .instance()
            .set(&DataKey::RoyaltyReceiver, &royalty_receiver);
        env.storage().instance().extend_ttl(50_000, 100_000);
        Ok(())
    }

    pub fn next_token_id(env: Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextTokenId)
        .unwrap_or(0)
    }

    // ── Minting ───────────────────────────────────────────────────────────

    /// Creator mints a single token to `to` with the given metadata URI.
    /// Returns the new token_id.
    pub fn mint(env: Env, to: Address, uri: String) -> Result<u64, Error> {
        Self::extend_instance_ttl(&env);
        let creator = Self::only_creator(&env)?;

        let token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        let max: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(u64::MAX);

        if token_id >= max {
            return Err(Error::MaxSupplyReached);
        }

        Self::_do_mint(&env, &to, token_id, &uri);

        // keep creator's auth info in context — emit creator address in event
        env.events()
            .publish((symbol_short!("mint"), to.clone()), (creator, token_id));
        Ok(token_id)
    }

    /// Batch mint multiple tokens to the same recipient.
    /// Optimized to minimize storage I/O - reads storage once, mints in memory, writes back once.
    pub fn batch_mint(env: Env, to: Address, uris: Vec<String>) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        
        let uris_len = uris.len();
        if uris_len == 0 {
            return Ok(());
        }
        
        // Read storage ONCE before the loop
        let mut next_token_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        let max_supply: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(u64::MAX);
        let mut total_supply: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        
        // Check if we have enough supply for all tokens
        if next_token_id + (uris_len as u64) > max_supply {
            return Err(Error::MaxSupplyReached);
        }
        
        // Get current balance once (will be incremented for each mint)
        let mut current_balance: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(to.clone()))
            .unwrap_or(0);
        
        // Collect token IDs to emit events
        let mut minted_ids = Vec::new(&env);
        
        // Mint all tokens in memory first
        for uri in uris.iter() {
            let token_id = next_token_id;
            
            // Store token data
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
            env.storage()
                .persistent()
                .set(&DataKey::TokenUri(token_id), &uri);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Owner(token_id), TTL_THRESHOLD, TTL_BUMP);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::TokenUri(token_id), TTL_THRESHOLD, TTL_BUMP);
            
            minted_ids.push_back(token_id);
            
            // Increment in memory
            next_token_id += 1;
            total_supply += 1;
            current_balance += 1;
        }
        
        // Write back to storage ONCE after the loop
        env.storage()
            .instance()
            .set(&DataKey::NextTokenId, &next_token_id);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &total_supply);
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(to.clone()), &current_balance);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BalanceOf(to.clone()), TTL_THRESHOLD, TTL_BUMP);
        
        // Emit individual mint events (as per ERC-721 standard)
        let creator = Self::only_creator(&env)?;
        for token_id in minted_ids.iter() {
            env.events()
                .publish((symbol_short!("mint"), to.clone()), (creator.clone(), token_id));
        }
        
        Ok(())
    }

    // ── Transfers ─────────────────────────────────────────────────────────

    /// Owner transfers their token.
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        from.require_auth();
        Self::_transfer(&env, &from, &to, token_id)
    }

    /// Approved spender (or operator) transfers on behalf of owner.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_id: u64,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        spender.require_auth();
        Self::_check_approved(&env, &spender, &from, token_id)?;
        // clear single-token approval on transfer
        env.storage()
            .persistent()
            .remove(&DataKey::Approved(token_id));
        Self::_transfer(&env, &from, &to, token_id)
    }

    // ── Approvals ─────────────────────────────────────────────────────────

    pub fn approve(
        env: Env,
        spender: Address, // Renamed 'owner' to 'spender' as it identifies the caller
        approved: Address,
        token_id: u64,
    ) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        spender.require_auth();
        let owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .ok_or(Error::TokenNotFound)?;

        // [SECURITY] Allow owner or authorized operator to approve (#48)
        if spender != owner
            && !Self::is_approved_for_all(env.clone(), owner.clone(), spender.clone())
        {
            return Err(Error::NotApproved);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Approved(token_id), &approved);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Approved(token_id), 50_000, 100_000);
        env.events()
            .publish((symbol_short!("approve"), owner), (approved, token_id));
        Ok(())
    }

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

    pub fn burn(env: Env, spender: Address, token_id: u64) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        spender.require_auth();
        let owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .ok_or(Error::TokenNotFound)?;

        // [SECURITY] Allow owner, approved spender, or operator to burn (#48)
        Self::_check_approved(&env, &spender, &owner, token_id)?;

        let bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(owner.clone()))
            .unwrap_or(1);
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(owner.clone()), &(bal.saturating_sub(1)));
        env.storage().persistent().extend_ttl(
            &DataKey::BalanceOf(owner.clone()),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        env.storage().persistent().remove(&DataKey::Owner(token_id));
        env.storage()
            .persistent()
            .remove(&DataKey::TokenUri(token_id));
        env.storage()
            .persistent()
            .remove(&DataKey::Approved(token_id));

        let supply: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(1);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply.saturating_sub(1)));

        env.events()
            .publish((symbol_short!("burn"), owner), token_id);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────

    pub fn owner_of(env: Env, token_id: u64) -> Result<Address, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .ok_or(Error::TokenNotFound)
    }

    pub fn token_uri(env: Env, token_id: u64) -> Result<String, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::TokenUri(token_id))
            .ok_or(Error::TokenNotFound)
    }

    pub fn balance_of(env: Env, owner: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::BalanceOf(owner))
            .unwrap_or(0)
    }

    pub fn total_supply(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0)
    }

    pub fn max_supply(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(u64::MAX)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn symbol(env: Env) -> String {
        env.storage().instance().get(&DataKey::Symbol).unwrap()
    }

    pub fn creator(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Creator).unwrap()
    }

    /// Returns (royalty_receiver, royalty_bps).
    /// Marketplaces should call this before listing.
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

    pub fn get_approved(env: Env, token_id: u64) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Approved(token_id))
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::ApprovedForAll(owner, operator))
            .unwrap_or(false)
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

    fn _do_mint(env: &Env, to: &Address, token_id: u64, uri: &String) {
        env.storage()
            .persistent()
            .set(&DataKey::Owner(token_id), to);
        env.storage()
            .persistent()
            .set(&DataKey::TokenUri(token_id), uri);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Owner(token_id), 50_000, 100_000);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::TokenUri(token_id), 50_000, 100_000);

        let bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(to.clone()), &(bal + 1));
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BalanceOf(to.clone()), 50_000, 100_000);

        let next: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::NextTokenId, &(next + 1));

        let supply: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + 1));
    }

    fn _transfer(env: &Env, from: &Address, to: &Address, token_id: u64) -> Result<(), Error> {
        // [SECURITY] Clear single-token approval on every transfer (#50)
        env.storage()
            .persistent()
            .remove(&DataKey::Approved(token_id));

        let owner: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Owner(token_id))
            .ok_or(Error::TokenNotFound)?;
        if owner != *from {
            return Err(Error::NotOwner);
        }

        let from_bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(from.clone()))
            .unwrap_or(1);
        env.storage().persistent().set(
            &DataKey::BalanceOf(from.clone()),
            &(from_bal.saturating_sub(1)),
        );
        env.storage().persistent().extend_ttl(
            &DataKey::BalanceOf(from.clone()),
            TTL_THRESHOLD,
            TTL_BUMP,
        );

        let to_bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(to.clone()), &(to_bal + 1));
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BalanceOf(to.clone()), 50_000, 100_000);

        env.storage()
            .persistent()
            .set(&DataKey::Owner(token_id), to);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Owner(token_id), TTL_THRESHOLD, TTL_BUMP);
        env.events().publish(
            (symbol_short!("transfer"), from.clone()),
            (to.clone(), token_id),
        );
        Ok(())
    }

    fn _check_approved(
        env: &Env,
        spender: &Address,
        from: &Address,
        token_id: u64,
    ) -> Result<(), Error> {
        // Check single-token approval
        if let Some(approved) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Approved(token_id))
        {
            if approved == *spender {
                return Ok(());
            }
        }
        // Check operator approval
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::ApprovedForAll(from.clone(), spender.clone()))
            .unwrap_or(false)
        {
            return Ok(());
        }
        Err(Error::NotApproved)
    }
}

#[cfg(test)]
mod test;
