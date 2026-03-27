//! LazyMint721 — Lazy-minting ERC-721-equivalent on Soroban.
//!
//! # How lazy minting works
//!
//! 1. Creator builds a `MintVoucher` off-chain.
//! 2. Creator hashes it with `sha256(token_id ‖ price ‖ valid_until ‖ uri_hash)`
//!    and signs the 32-byte digest with their ed25519 private key.
//! 3. Buyer submits the voucher + signature on-chain via `redeem()`.
//! 4. Contract re-hashes, verifies ed25519, takes payment, then mints.
//!
//! # Replay protection
//! Every (token_id) is tracked in `UsedVoucher`. Once redeemed it can never
//! be claimed again. The contract address is not included in the signed digest
//! because each collection is a unique deployed contract address — a voucher
//! for collection A cannot be replayed into collection B.
//!
//! # Payment
//! Accepts any Stellar Asset Contract (SAC) token.  Pass the SAC address for
//! XLM or any USDC/custom asset.  Price = 0 means free mint.
#![no_std]
#![allow(clippy::too_many_arguments, deprecated)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token::TokenClient,
    xdr::ToXdr, Address, Bytes, BytesN, Env, String,
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
    VoucherExpired = 7,
    VoucherAlreadyUsed = 8,
    NotCreator = 9,
}

// ─── Data types ───────────────────────────────────────────────────────────────

/// Off-chain voucher created by the collection creator.
///
/// Field `uri_hash` = sha256(uri_string) computed off-chain.
/// This is included in the signed digest so a relayer cannot swap the URI
/// while keeping the signature valid.
#[contracttype]
#[derive(Clone)]
pub struct MintVoucher {
    pub token_id: u64,
    pub price: i128,          // 0 = free
    pub currency: Address,    // SAC address (ignored when price == 0)
    pub uri: String,          // IPFS / HTTPS metadata URI
    pub uri_hash: BytesN<32>, // sha256(uri bytes) — included in signature
    pub valid_until: u64,     // ledger sequence; 0 = no expiry
}

/// Compact struct for the signed digest — only the fields that matter for
/// security are hashed. `uri` is *not* hashed directly because `String` is
/// opaque; instead `uri_hash` (a pre-computed sha256) is used.
///
/// Signed digest = sha256(token_id ‖ price ‖ valid_until ‖ uri_hash ‖ currency_xdr)
/// All integers are big-endian.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Initialized,
    Creator,
    CreatorPubkey, // BytesN<32>  ed25519 public key used to verify vouchers
    Name,
    Symbol,
    MaxSupply,
    NextTokenId,
    TotalSupply,
    RoyaltyBps,
    RoyaltyReceiver,
    Owner(u64),
    TokenUri(u64),
    Approved(u64),
    BalanceOf(Address),
    ApprovedForAll(Address, Address),
    UsedVoucher(u64), // token_id → bool
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct LazyMint721;

#[contractimpl]
impl LazyMint721 {
    // ── Initializer ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        creator: Address,
        creator_pubkey: BytesN<32>, // ed25519 public key of creator wallet
        name: String,
        symbol: String,
        max_supply: u64,
        royalty_bps: u32,
        royalty_receiver: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage()
            .instance()
            .set(&DataKey::CreatorPubkey, &creator_pubkey);
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

    // ── Lazy Mint (core) ──────────────────────────────────────────────────

    /// Buyer submits a signed voucher to mint their NFT.
    /// The transaction fails (panics) if the ed25519 signature is invalid.
    pub fn redeem(
        env: Env,
        buyer: Address,
        voucher: MintVoucher,
        signature: BytesN<64>,
    ) -> Result<u64, Error> {
        Self::extend_instance_ttl(&env);
        buyer.require_auth();

        // 1. Expiry check
        if voucher.valid_until != 0 && env.ledger().sequence() > voucher.valid_until as u32 {
            return Err(Error::VoucherExpired);
        }

        // 2. Replay check
        if env
            .storage()
            .persistent()
            .has(&DataKey::UsedVoucher(voucher.token_id))
        {
            return Err(Error::VoucherAlreadyUsed);
        }

        // 3. Supply check
        let next_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextTokenId)
            .unwrap_or(0);
        let max: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MaxSupply)
            .unwrap_or(u64::MAX);
        if next_id >= max {
            return Err(Error::MaxSupplyReached);
        }

        // 4. Signature verification
        //    Panics (fails the tx) if the signature does not match.
        let pubkey: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::CreatorPubkey)
            .ok_or(Error::NotInitialized)?;
        let digest = Self::_voucher_digest(&env, &voucher);
        env.crypto().ed25519_verify(&pubkey, &digest, &signature);

        // 5. Payment  (skip when price == 0)
        if voucher.price > 0 {
            let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
            TokenClient::new(&env, &voucher.currency).transfer(&buyer, &creator, &voucher.price);
        }

        // 6. Mint
        let token_id = voucher.token_id;
        env.storage()
            .persistent()
            .set(&DataKey::Owner(token_id), &buyer);
        env.storage()
            .persistent()
            .set(&DataKey::TokenUri(token_id), &voucher.uri);
        env.storage()
            .persistent()
            .set(&DataKey::UsedVoucher(token_id), &true);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Owner(token_id), 50_000, 100_000);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::TokenUri(token_id), 50_000, 100_000);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::UsedVoucher(token_id), 50_000, 100_000);

        let bal: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::BalanceOf(buyer.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(buyer.clone()), &(bal + 1));
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::BalanceOf(buyer.clone()), 50_000, 100_000);

        let supply: u64 = env
            .storage()
            .instance()
            .get(&DataKey::TotalSupply)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalSupply, &(supply + 1));
        // NextTokenId tracks highest minted ID + 1 for supply cap enforcement
        if token_id >= next_id {
            env.storage()
                .instance()
                .set(&DataKey::NextTokenId, &(token_id + 1));
        }

        env.events()
            .publish((symbol_short!("redeem"), buyer), token_id);
        Ok(token_id)
    }

    // ── Transfers ─────────────────────────────────────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        from.require_auth();
        Self::_transfer(&env, &from, &to, token_id)
    }

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
        env.storage()
            .persistent()
            .remove(&DataKey::Approved(token_id));
        Self::_transfer(&env, &from, &to, token_id)
    }

    // ── Approvals ─────────────────────────────────────────────────────────

    pub fn approve(
        env: Env,
        spender: Address,
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
        Ok(())
    }

    pub fn set_approval_for_all(env: Env, owner: Address, operator: Address, approved: bool) {
        Self::extend_instance_ttl(&env);
        owner.require_auth();
        let key = DataKey::ApprovedForAll(owner.clone(), operator.clone());
        env.storage().persistent().set(&key, &approved);
        env.storage().persistent().extend_ttl(&key, 50_000, 100_000);
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

    pub fn is_voucher_used(env: Env, token_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::UsedVoucher(token_id))
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

    pub fn update_creator_pubkey(env: Env, new_pubkey: BytesN<32>) -> Result<(), Error> {
        Self::extend_instance_ttl(&env);
        Self::only_creator(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::CreatorPubkey, &new_pubkey);
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

    /// Build the 32-byte digest that the creator must sign off-chain.
    ///
    /// Layout (all big-endian):
    ///   8  bytes  token_id
    ///  16  bytes  price (i128)
    ///   8  bytes  valid_until
    ///  32  bytes  uri_hash
    ///  N   bytes  currency address XDR  (replay-binds to the payment token)
    fn _voucher_digest(env: &Env, v: &MintVoucher) -> Bytes {
        let mut raw = Bytes::new(env);
        // [SECURITY] Bind signature to this contract instance to prevent replay (#49)
        raw.append(&env.current_contract_address().to_xdr(env));
        raw.extend_from_array(&v.token_id.to_be_bytes());
        raw.extend_from_array(&v.price.to_be_bytes());
        raw.extend_from_array(&v.valid_until.to_be_bytes());
        raw.append(&v.uri_hash.clone().into());
        raw.append(&v.currency.clone().to_xdr(env));
        env.crypto().sha256(&raw).into()
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
            .unwrap_or(0);

        if from_bal == 0 {
            return Err(Error::NotOwner);
        }

        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(from.clone()), &(from_bal - 1));
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
        if let Some(approved) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Approved(token_id))
        {
            if approved == *spender {
                return Ok(());
            }
        }
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
