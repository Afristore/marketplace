//! Launchpad — Factory contract that deploys the 4 NFT collection types.
//!
//! # Deployment flow
//!
//! 1. Admin deploys this contract and calls `initialize`.
//! 2. Admin uploads each of the 4 collection WASMs with:
//!      `stellar contract upload --wasm <file>.wasm --network testnet`
//!    and then calls `set_wasm_hashes` with the 4 resulting 32-byte hashes.
//! 3. Any user can now call one of the four `deploy_*` functions to launch
//!    their own collection.  The factory calls `initialize` on the freshly
//!    deployed contract in the same transaction — no second call needed.
//!
//! # Deterministic addresses (clone-equivalent)
//! `env.deployer().with_current_contract(salt)` gives a deterministic address
//! from `sha256(factory_address ‖ salt)`.  Clients can pre-compute the address
//! before the transaction confirms.  Pass a different `salt` for each collection.
//!
//! # Why this is Soroban's answer to EIP-1167 clones
//! The collection WASM is stored once on the network (identified by hash).
//! Every `deploy()` call shares that same WASM — no bytecode duplication.
//! Each instance gets completely isolated storage.
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, contractclient, symbol_short,
    Address, BytesN, Env, String, Vec,
};

// ─── Cross-contract clients ───────────────────────────────────────────────────
// We define minimal interfaces for the four collection types so the factory
// can call `initialize` on freshly deployed contracts in the same transaction.

mod iface {
    use soroban_sdk::{contractclient, Address, BytesN, Env, String};

    #[contractclient(name = "Normal721Client")]
    pub trait INormal721 {
        fn initialize(
            env: Env,
            creator: Address,
            name: String,
            symbol: String,
            max_supply: u64,
            royalty_bps: u32,
            royalty_receiver: Address,
        );
    }

    #[contractclient(name = "Normal1155Client")]
    pub trait INormal1155 {
        fn initialize(
            env: Env,
            creator: Address,
            name: String,
            royalty_bps: u32,
            royalty_receiver: Address,
        );
    }

    #[contractclient(name = "Lazy721Client")]
    pub trait ILazy721 {
        fn initialize(
            env: Env,
            creator: Address,
            creator_pubkey: BytesN<32>,
            name: String,
            symbol: String,
            max_supply: u64,
            royalty_bps: u32,
            royalty_receiver: Address,
        );
    }

    #[contractclient(name = "Lazy1155Client")]
    pub trait ILazy1155 {
        fn initialize(
            env: Env,
            creator: Address,
            creator_pubkey: BytesN<32>,
            name: String,
            royalty_bps: u32,
            royalty_receiver: Address,
        );
    }
}

use iface::{Normal721Client, Normal1155Client, Lazy721Client, Lazy1155Client};

// ─── Errors ──────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized     = 2,
    NotAdmin           = 3,
    WasmHashNotSet     = 4,
}

// ─── Data types ───────────────────────────────────────────────────────────────

/// Which of the four collection types was deployed.
#[contracttype]
#[derive(Clone)]
pub enum CollectionKind {
    Normal721,
    Normal1155,
    LazyMint721,
    LazyMint1155,
}

/// A record stored for every deployed collection.
#[contracttype]
#[derive(Clone)]
pub struct CollectionRecord {
    pub address: Address,
    pub kind:    CollectionKind,
    pub creator: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // Instance storage
    Initialized,
    Admin,
    PlatformFeeReceiver,
    PlatformFeeBps,      // future: charge creators on deploy
    WasmNormal721,
    WasmNormal1155,
    WasmLazy721,
    WasmLazy1155,
    CollectionCount,
    // Persistent storage
    ByCreator(Address),  // Address → Vec<CollectionRecord>
    AllCollections,      // Vec<CollectionRecord>  (global registry)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct Launchpad;

#[contractimpl]
impl Launchpad {
    // ── Initializer ───────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        platform_fee_receiver: Address,
        platform_fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Initialized,         &true);
        env.storage().instance().set(&DataKey::Admin,                &admin);
        env.storage().instance().set(&DataKey::PlatformFeeReceiver,  &platform_fee_receiver);
        env.storage().instance().set(&DataKey::PlatformFeeBps,       &platform_fee_bps);
        env.storage().instance().extend_ttl(50_000, 100_000);
        Ok(())
    }

    // ── Admin: register WASM hashes ───────────────────────────────────────

    /// Must be called by admin after uploading the four WASMs to the network.
    ///
    /// ```bash
    /// # Upload each WASM and grab its hash:
    /// stellar contract upload --wasm normal_721.wasm --network testnet
    /// stellar contract upload --wasm normal_1155.wasm --network testnet
    /// stellar contract upload --wasm lazy_721.wasm --network testnet
    /// stellar contract upload --wasm lazy_1155.wasm --network testnet
    /// ```
    pub fn set_wasm_hashes(
        env: Env,
        wasm_normal_721:  BytesN<32>,
        wasm_normal_1155: BytesN<32>,
        wasm_lazy_721:    BytesN<32>,
        wasm_lazy_1155:   BytesN<32>,
    ) -> Result<(), Error> {
        Self::only_admin(&env)?;
        env.storage().instance().set(&DataKey::WasmNormal721,  &wasm_normal_721);
        env.storage().instance().set(&DataKey::WasmNormal1155, &wasm_normal_1155);
        env.storage().instance().set(&DataKey::WasmLazy721,    &wasm_lazy_721);
        env.storage().instance().set(&DataKey::WasmLazy1155,   &wasm_lazy_1155);
        Ok(())
    }

    // ── Deploy: Normal ERC-721 ────────────────────────────────────────────

    /// Deploy a Normal 721 collection.
    ///
    /// `salt` — any unique 32 bytes.  Tip: use sha256(creator ‖ name ‖ timestamp)
    ///          so the resulting collection address is predictable off-chain.
    pub fn deploy_normal_721(
        env: Env,
        creator: Address,
        name: String,
        symbol: String,
        max_supply: u64,         // pass u64::MAX for unlimited
        royalty_bps: u32,        // e.g. 500 = 5 %
        royalty_receiver: Address,
        salt: BytesN<32>,
    ) -> Result<Address, Error> {
        creator.require_auth();

        let wasm: BytesN<32> = env.storage().instance()
            .get(&DataKey::WasmNormal721)
            .ok_or(Error::WasmHashNotSet)?;

        // Deploy a new contract instance that shares the Normal721 WASM
        let addr = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, ());

        // Initialize the freshly deployed collection in the same tx
        Normal721Client::new(&env, &addr).initialize(
            &creator,
            &name,
            &symbol,
            &max_supply,
            &royalty_bps,
            &royalty_receiver,
        );

        Self::_record(&env, &creator, &addr, CollectionKind::Normal721);
        env.events().publish(
            (symbol_short!("deploy"), symbol_short!("n721")),
            (creator, addr.clone()),
        );
        Ok(addr)
    }

    // ── Deploy: Normal ERC-1155 ───────────────────────────────────────────

    pub fn deploy_normal_1155(
        env: Env,
        creator: Address,
        name: String,
        royalty_bps: u32,
        royalty_receiver: Address,
        salt: BytesN<32>,
    ) -> Result<Address, Error> {
        creator.require_auth();

        let wasm: BytesN<32> = env.storage().instance()
            .get(&DataKey::WasmNormal1155)
            .ok_or(Error::WasmHashNotSet)?;

        let addr = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, ());

        Normal1155Client::new(&env, &addr)
            .initialize(&creator, &name, &royalty_bps, &royalty_receiver);

        Self::_record(&env, &creator, &addr, CollectionKind::Normal1155);
        env.events().publish(
            (symbol_short!("deploy"), symbol_short!("n1155")),
            (creator, addr.clone()),
        );
        Ok(addr)
    }

    // ── Deploy: LazyMint ERC-721 ──────────────────────────────────────────

    /// `creator_pubkey` — the raw 32-byte ed25519 public key of the creator's
    /// Stellar keypair.  Off-chain tools sign mint vouchers with the matching
    /// private key.  You can derive this from any `G...` address.
    pub fn deploy_lazy_721(
        env: Env,
        creator: Address,
        creator_pubkey: BytesN<32>,
        name: String,
        symbol: String,
        max_supply: u64,
        royalty_bps: u32,
        royalty_receiver: Address,
        salt: BytesN<32>,
    ) -> Result<Address, Error> {
        creator.require_auth();

        let wasm: BytesN<32> = env.storage().instance()
            .get(&DataKey::WasmLazy721)
            .ok_or(Error::WasmHashNotSet)?;

        let addr = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, ());

        Lazy721Client::new(&env, &addr).initialize(
            &creator,
            &creator_pubkey,
            &name,
            &symbol,
            &max_supply,
            &royalty_bps,
            &royalty_receiver,
        );

        Self::_record(&env, &creator, &addr, CollectionKind::LazyMint721);
        env.events().publish(
            (symbol_short!("deploy"), symbol_short!("l721")),
            (creator, addr.clone()),
        );
        Ok(addr)
    }

    // ── Deploy: LazyMint ERC-1155 ─────────────────────────────────────────

    pub fn deploy_lazy_1155(
        env: Env,
        creator: Address,
        creator_pubkey: BytesN<32>,
        name: String,
        royalty_bps: u32,
        royalty_receiver: Address,
        salt: BytesN<32>,
    ) -> Result<Address, Error> {
        creator.require_auth();

        let wasm: BytesN<32> = env.storage().instance()
            .get(&DataKey::WasmLazy1155)
            .ok_or(Error::WasmHashNotSet)?;

        let addr = env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm, ());

        Lazy1155Client::new(&env, &addr).initialize(
            &creator,
            &creator_pubkey,
            &name,
            &royalty_bps,
            &royalty_receiver,
        );

        Self::_record(&env, &creator, &addr, CollectionKind::LazyMint1155);
        env.events().publish(
            (symbol_short!("deploy"), symbol_short!("l1155")),
            (creator, addr.clone()),
        );
        Ok(addr)
    }

    // ── Admin management ──────────────────────────────────────────────────

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        Self::only_admin(&env)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Ok(())
    }

    pub fn update_platform_fee(
        env: Env,
        receiver: Address,
        fee_bps: u32,
    ) -> Result<(), Error> {
        Self::only_admin(&env)?;
        env.storage().instance().set(&DataKey::PlatformFeeReceiver, &receiver);
        env.storage().instance().set(&DataKey::PlatformFeeBps,       &fee_bps);
        Ok(())
    }

    // ── View functions ────────────────────────────────────────────────────

    /// All collections deployed by a specific creator.
    pub fn collections_by_creator(env: Env, creator: Address) -> Vec<CollectionRecord> {
        env.storage().persistent()
            .get(&DataKey::ByCreator(creator))
            .unwrap_or(Vec::new(&env))
    }

    /// Global registry of every collection ever deployed through this launchpad.
    pub fn all_collections(env: Env) -> Vec<CollectionRecord> {
        env.storage().persistent()
            .get(&DataKey::AllCollections)
            .unwrap_or(Vec::new(&env))
    }

    pub fn collection_count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::CollectionCount).unwrap_or(0)
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn platform_fee(env: Env) -> (Address, u32) {
        (
            env.storage().instance().get(&DataKey::PlatformFeeReceiver).unwrap(),
            env.storage().instance().get(&DataKey::PlatformFeeBps).unwrap_or(0),
        )
    }

    // ── Private helpers ───────────────────────────────────────────────────

    fn only_admin(env: &Env) -> Result<Address, Error> {
        let admin: Address = env.storage().instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn _record(env: &Env, creator: &Address, addr: &Address, kind: CollectionKind) {
        let rec = CollectionRecord {
            address: addr.clone(),
            kind,
            creator: creator.clone(),
        };

        // Per-creator list
        let mut by_creator: Vec<CollectionRecord> = env.storage().persistent()
            .get(&DataKey::ByCreator(creator.clone()))
            .unwrap_or(Vec::new(env));
        by_creator.push_back(rec.clone());
        env.storage().persistent()
            .set(&DataKey::ByCreator(creator.clone()), &by_creator);
        env.storage().persistent()
            .extend_ttl(&DataKey::ByCreator(creator.clone()), 50_000, 100_000);

        // Global list
        let mut all: Vec<CollectionRecord> = env.storage().persistent()
            .get(&DataKey::AllCollections)
            .unwrap_or(Vec::new(env));
        all.push_back(rec);
        env.storage().persistent().set(&DataKey::AllCollections, &all);
        env.storage().persistent().extend_ttl(&DataKey::AllCollections, 50_000, 100_000);

        // Counter
        let n: u64 = env.storage().instance()
            .get(&DataKey::CollectionCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::CollectionCount, &(n + 1));
    }
}