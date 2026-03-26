//! LazyMint1155 — Lazy-minting ERC-1155-equivalent on Soroban.
//!
//! Voucher model is the same as LazyMint721 but vouchers carry a
//! `buyer_quota` and `price_per_unit`. A buyer can call `redeem` multiple
//! times for the same token_id as long as their cumulative amount stays ≤
//! `buyer_quota`.  This mirrors edition-based lazy drops.
//!
//! Signed digest:
//!   sha256(token_id ‖ buyer_quota ‖ price_per_unit ‖ valid_until ‖ uri_hash ‖ currency_xdr)
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    token::TokenClient,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, String, Vec,
};

// ─── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized       = 1,
    NotInitialized           = 2,
    NotApproved              = 3,
    InsufficientBalance      = 4,
    LengthMismatch           = 5,
    VoucherExpired           = 6,
    ExceedsVoucherMax        = 7,  // cumulative amount > voucher.buyer_quota
    NotCreator               = 8,
    EditionNotRegistered     = 9,
    EditionAlreadyRegistered = 10,
    MaxSupplyReached         = 11,
}

// ─── Data types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct MintVoucher1155 {
    pub token_id:       u64,
    pub buyer_quota:    u128,   // max per-buyer allocation (replaces max_amount)
    pub price_per_unit: i128,   // 0 = free
    pub currency:       Address,
    pub uri:            String,
    pub uri_hash:       BytesN<32>,
    pub valid_until:    u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Initialized,
    Creator,
    CreatorPubkey,
    Name,
    RoyaltyBps,
    RoyaltyReceiver,
    Balance(Address, u64),            // (account, token_id) → u128
    ApprovedForAll(Address, Address),
    TokenUri(u64),
    TotalSupply(u64),
    MintedPerBuyer(Address, u64),     // (buyer, token_id) → u128 cumulative minted
    MaxAmount(u64),                   // token_id → max_amount from voucher (legacy)
    EditionMaxSupply(u64),            // token_id → global edition cap (#61)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct LazyMint1155;

#[contractimpl]
impl LazyMint1155 {
    // ── Initializer ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        creator: Address,
        creator_pubkey: BytesN<32>,
        name: String,
        royalty_bps: u32,
        royalty_receiver: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized,     &true);
        env.storage().instance().set(&DataKey::Creator,         &creator);
        env.storage().instance().set(&DataKey::CreatorPubkey,   &creator_pubkey);
        env.storage().instance().set(&DataKey::Name,            &name);
        env.storage().instance().set(&DataKey::RoyaltyBps,      &royalty_bps);
        env.storage().instance().set(&DataKey::RoyaltyReceiver, &royalty_receiver);
        env.storage().instance().extend_ttl(50_000, 100_000);
        Ok(())
    }

    // ── Lazy Mint ─────────────────────────────────────────────────────────

    /// Buyer redeems a signed voucher for `amount` copies of `voucher.token_id`.
    ///
    /// The buyer can call this multiple times for the same voucher as long as
    /// the running total stays ≤ `voucher.buyer_quota`.  Good for edition drops
    /// where the creator wants to limit each buyer's share.
    pub fn redeem(
        env: Env,
        buyer: Address,
        voucher: MintVoucher1155,
        amount: u128,
        signature: BytesN<64>,
    ) -> Result<(), Error> {
        buyer.require_auth();

        // 1. Expiry
        if voucher.valid_until != 0
            && env.ledger().sequence() > voucher.valid_until as u32
        {
            return Err(Error::VoucherExpired);
        }

        // 2. Global supply check — edition must be registered (#61)
        let edition_max: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::EditionMaxSupply(voucher.token_id))
            .ok_or(Error::EditionNotRegistered)?;

        let current_supply: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalSupply(voucher.token_id))
            .unwrap_or(0);

        if current_supply + amount > edition_max {
            return Err(Error::MaxSupplyReached);
        }

        // 3. Per-buyer quota check
        let minted_key = DataKey::MintedPerBuyer(buyer.clone(), voucher.token_id);
        let already: u128 = env
            .storage()
            .persistent()
            .get(&minted_key)
            .unwrap_or(0);
        if already + amount > voucher.buyer_quota {
            return Err(Error::ExceedsVoucherMax);
        }

        // 4. Signature verification (panics tx on bad sig)
        let pubkey: BytesN<32> = env.storage().instance()
            .get(&DataKey::CreatorPubkey)
            .ok_or(Error::NotInitialized)?;
        let digest = Self::_voucher_digest(&env, &voucher);
        env.crypto().ed25519_verify(&pubkey, &digest, &signature);

        // 5. Payment
        if voucher.price_per_unit > 0 {
            let total_price = voucher.price_per_unit
                .checked_mul(amount as i128)
                .unwrap_or(i128::MAX);
            let creator: Address = env.storage().instance()
                .get(&DataKey::Creator).unwrap();
            TokenClient::new(&env, &voucher.currency)
                .transfer(&buyer, &creator, &total_price);
        }

        // 6. Mint
        let bal: u128 = env.storage().persistent()
            .get(&DataKey::Balance(buyer.clone(), voucher.token_id)).unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::Balance(buyer.clone(), voucher.token_id), &(bal + amount));
        env.storage().persistent()
            .extend_ttl(&DataKey::Balance(buyer.clone(), voucher.token_id), 50_000, 100_000);

        // Set URI on first mint of this token_id
        if !env.storage().persistent().has(&DataKey::TokenUri(voucher.token_id)) {
            env.storage().persistent()
                .set(&DataKey::TokenUri(voucher.token_id), &voucher.uri);
            env.storage().persistent()
                .extend_ttl(&DataKey::TokenUri(voucher.token_id), 50_000, 100_000);
        }

        let supply: u128 = env.storage().persistent()
            .get(&DataKey::TotalSupply(voucher.token_id)).unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::TotalSupply(voucher.token_id), &(supply + amount));

        // Update per-buyer counter
        env.storage().persistent().set(&minted_key, &(already + amount));
        env.storage().persistent().extend_ttl(&minted_key, 50_000, 100_000);

        env.events().publish(
            (symbol_short!("redeem"), buyer),
            (voucher.token_id, amount),
        );
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
        from.require_auth();
        Self::_transfer(&env, &from, &to, token_id, amount)
    }

    pub fn transfer_from(
        env: Env,
        operator: Address,
        from: Address,
        to: Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        operator.require_auth();
        if !Self::_is_approved_for_all(&env, &operator, &from) {
            return Err(Error::NotApproved);
        }
        Self::_transfer(&env, &from, &to, token_id, amount)
    }

    pub fn batch_transfer(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_ids: Vec<u64>,
        amounts: Vec<u128>,
    ) -> Result<(), Error> {
        spender.require_auth();

        // [SECURITY] Allow owner or authorized operator (#48)
        if spender != from && !Self::_is_approved_for_all(&env, &spender, &from) {
            return Err(Error::NotApproved);
        }

        if token_ids.len() != amounts.len() { return Err(Error::LengthMismatch); }
        for i in 0..token_ids.len() {
            Self::_transfer(
                &env,
                &from,
                &to,
                token_ids.get(i).unwrap(),
                amounts.get(i).unwrap(),
            )?;
        }
        Ok(())
    }

    // ── Approvals ─────────────────────────────────────────────────────────

    pub fn set_approval_for_all(
        env: Env,
        owner: Address,
        operator: Address,
        approved: bool,
    ) {
        owner.require_auth();
        let key = DataKey::ApprovedForAll(owner.clone(), operator.clone());
        env.storage().persistent().set(&key, &approved);
        env.storage().persistent().extend_ttl(&key, 50_000, 100_000);
        env.events().publish((symbol_short!("appr_all"), owner), (operator, approved));
    }

    // ── Burn ──────────────────────────────────────────────────────────────

    pub fn burn(
        env: Env,
        spender: Address,
        from: Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        spender.require_auth();

        // [SECURITY] Allow owner or authorized operator to burn (#48)
        if spender != from && !Self::_is_approved_for_all(&env, &spender, &from) {
            return Err(Error::NotApproved);
        }

        let bal: u128 = env.storage().persistent()
            .get(&DataKey::Balance(from.clone(), token_id)).unwrap_or(0);
        if bal < amount { return Err(Error::InsufficientBalance); }
        env.storage().persistent()
            .set(&DataKey::Balance(from.clone(), token_id), &(bal - amount));
        let supply: u128 = env.storage().persistent()
            .get(&DataKey::TotalSupply(token_id)).unwrap_or(amount);
        env.storage().persistent()
            .set(&DataKey::TotalSupply(token_id), &(supply.saturating_sub(amount)));
        env.events().publish((symbol_short!("burn"), from), (token_id, amount));
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────

    pub fn balance_of(env: Env, account: Address, token_id: u64) -> u128 {
        env.storage().persistent()
            .get(&DataKey::Balance(account, token_id)).unwrap_or(0)
    }

    pub fn balance_of_batch(
        env: Env,
        accounts: Vec<Address>,
        token_ids: Vec<u64>,
    ) -> Vec<u128> {
        let mut out = Vec::new(&env);
        for i in 0..accounts.len() {
            let b: u128 = env.storage().persistent()
                .get(&DataKey::Balance(accounts.get(i).unwrap(), token_ids.get(i).unwrap()))
                .unwrap_or(0);
            out.push_back(b);
        }
        out
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        Self::_is_approved_for_all(&env, &operator, &owner)
    }

    pub fn uri(env: Env, token_id: u64) -> String {
        env.storage().persistent().get(&DataKey::TokenUri(token_id)).unwrap()
    }

    pub fn total_supply(env: Env, token_id: u64) -> u128 {
        env.storage().persistent()
            .get(&DataKey::TotalSupply(token_id)).unwrap_or(0)
    }

    pub fn minted_by_buyer(env: Env, buyer: Address, token_id: u64) -> u128 {
        env.storage().persistent()
            .get(&DataKey::MintedPerBuyer(buyer, token_id)).unwrap_or(0)
    }

    pub fn max_amount(env: Env, token_id: u64) -> u128 {
        env.storage().persistent()
            .get(&DataKey::MaxAmount(token_id)).unwrap_or(0)
    }

    pub fn name(env: Env) -> String {
        env.storage().instance().get(&DataKey::Name).unwrap()
    }

    pub fn creator(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Creator).unwrap()
    }

    pub fn royalty_info(env: Env) -> (Address, u32) {
        (
            env.storage().instance().get(&DataKey::RoyaltyReceiver).unwrap(),
            env.storage().instance().get(&DataKey::RoyaltyBps).unwrap_or(0),
        )
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    pub fn transfer_ownership(env: Env, new_creator: Address) -> Result<(), Error> {
        Self::only_creator(&env)?;
        env.storage().instance().set(&DataKey::Creator, &new_creator);
        Ok(())
    }

    pub fn update_creator_pubkey(env: Env, new_pubkey: BytesN<32>) -> Result<(), Error> {
        Self::only_creator(&env)?;
        env.storage().instance().set(&DataKey::CreatorPubkey, &new_pubkey);
        Ok(())
    }

    pub fn update_royalty(env: Env, receiver: Address, bps: u32) -> Result<(), Error> {
        Self::only_creator(&env)?;
        env.storage().instance().set(&DataKey::RoyaltyReceiver, &receiver);
        env.storage().instance().set(&DataKey::RoyaltyBps, &bps);
        Ok(())
    }

    // ── Edition Management (#61) ──────────────────────────────────────────

    /// Creator registers the global edition cap for a token_id before distributing vouchers.
    pub fn register_edition(env: Env, token_id: u64, max_supply: u128) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;

        let key = DataKey::EditionMaxSupply(token_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::EditionAlreadyRegistered);
        }

        env.storage().persistent().set(&key, &max_supply);
        env.storage().persistent().extend_ttl(&key, 50_000, 100_000);

        env.events()
            .publish((symbol_short!("register"), token_id), max_supply);
        Ok(())
    }

    /// View: returns the global edition cap for a token_id (0 if not registered).
    pub fn edition_max_supply(env: Env, token_id: u64) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::EditionMaxSupply(token_id))
            .unwrap_or(0)
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage().instance().extend_ttl(50_000, 100_000);
    }

    // ── Private helpers ───────────────────────────────────────────────────

    fn only_creator(env: &Env) -> Result<Address, Error> {
        let creator: Address = env.storage().instance()
            .get(&DataKey::Creator)
            .ok_or(Error::NotInitialized)?;
        creator.require_auth();
        Ok(creator)
    }

    /// sha256(token_id ‖ buyer_quota ‖ price_per_unit ‖ valid_until ‖ uri_hash ‖ currency_xdr)
    /// sha256(contract_addr ‖ token_id ‖ max_amount ‖ price_per_unit ‖ valid_until ‖ uri_hash ‖ currency_xdr)
    fn _voucher_digest(env: &Env, v: &MintVoucher1155) -> Bytes {
        let mut raw = Bytes::new(env);
        // [SECURITY] Bind signature to this contract instance to prevent replay (#49)
        raw.append(&env.current_contract_address().to_xdr(env));
        raw.extend_from_array(&v.token_id.to_be_bytes());
        raw.extend_from_array(&v.buyer_quota.to_be_bytes());
        raw.extend_from_array(&v.price_per_unit.to_be_bytes());
        raw.extend_from_array(&v.valid_until.to_be_bytes());
        raw.append(&v.uri_hash.clone().into());
        raw.append(&v.currency.clone().to_xdr(env));
        env.crypto().sha256(&raw).into()
    }

    fn _transfer(
        env: &Env,
        from: &Address,
        to: &Address,
        token_id: u64,
        amount: u128,
    ) -> Result<(), Error> {
        let from_bal: u128 = env.storage().persistent()
            .get(&DataKey::Balance(from.clone(), token_id)).unwrap_or(0);
        if from_bal < amount { return Err(Error::InsufficientBalance); }

        env.storage().persistent()
            .set(&DataKey::Balance(from.clone(), token_id), &(from_bal - amount));
        let to_bal: u128 = env.storage().persistent()
            .get(&DataKey::Balance(to.clone(), token_id)).unwrap_or(0);
        env.storage().persistent()
            .set(&DataKey::Balance(to.clone(), token_id), &(to_bal + amount));
        env.storage().persistent()
            .extend_ttl(&DataKey::Balance(to.clone(), token_id), 50_000, 100_000);
        env.events().publish(
            (symbol_short!("transfer"), from.clone()),
            (to.clone(), token_id, amount),
        );
        Ok(())
    }

    fn _is_approved_for_all(env: &Env, operator: &Address, owner: &Address) -> bool {
        env.storage().persistent()
            .get(&DataKey::ApprovedForAll(owner.clone(), operator.clone()))
            .unwrap_or(false)
    }
}
mod test;
