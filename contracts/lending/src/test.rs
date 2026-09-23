#![cfg(test)]

extern crate std;

mod mock_nft {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    enum DataKey {
        Owner(u64),
    }

    #[contract]
    pub struct MockNft;

    #[contractimpl]
    impl MockNft {
        pub fn mint(env: Env, to: Address, token_id: u64) {
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
        }

        pub fn transfer_from(
            env: Env,
            _spender: Address,
            from: Address,
            to: Address,
            token_id: u64,
            _amount: u64,
        ) {
            let owner: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Owner(token_id))
                .expect("token not minted");
            if owner != from {
                panic!("not owner");
            }
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
        }

        pub fn owner_of(env: Env, token_id: u64) -> Address {
            env.storage()
                .persistent()
                .get(&DataKey::Owner(token_id))
                .expect("token not minted")
        }
    }
}

mod mock_token {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    pub enum DataKey {
        Balance(Address),
    }

    #[contract]
    pub struct MockToken;

    #[contractimpl]
    impl MockToken {
        pub fn mint(env: Env, to: Address, amount: i128) -> i128 {
            let bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Balance(to), &(bal + amount));
            amount
        }

        pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
            let from_bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(from.clone()))
                .unwrap_or(0);
            assert!(from_bal >= amount, "insufficient balance");
            env.storage()
                .persistent()
                .set(&DataKey::Balance(from), &(from_bal - amount));
            let to_bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Balance(to), &(to_bal + amount));
        }

        pub fn balance(env: Env, account: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&DataKey::Balance(account))
                .unwrap_or(0)
        }

        // Standard soroban token interface methods
        pub fn decimals(_env: Env) -> u32 {
            7
        }

        pub fn symbol(_env: Env) -> soroban_sdk::Symbol {
            soroban_sdk::symbol_short!("MOCK")
        }

        pub fn name(_env: Env) -> soroban_sdk::Symbol {
            soroban_sdk::symbol_short!("Mock")
        }

        pub fn total_supply(_env: Env) -> i128 {
            0
        }

        pub fn balance_of(env: Env, account: Address) -> i128 {
            env.storage()
                .persistent()
                .get(&DataKey::Balance(account))
                .unwrap_or(0)
        }

        pub fn transfer_from(
            env: Env,
            _spender: Address,
            from: Address,
            to: Address,
            amount: i128,
        ) {
            let from_bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(from.clone()))
                .unwrap_or(0);
            assert!(from_bal >= amount, "insufficient balance");
            env.storage()
                .persistent()
                .set(&DataKey::Balance(from), &(from_bal - amount));
            let to_bal: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::Balance(to.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&DataKey::Balance(to), &(to_bal + amount));
        }
    }
}

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, vec, Address, Env, IntoVal, Symbol, Vec};

use crate::contract::{LendingContract, LendingContractClient};
use crate::storage::set_position;
use crate::types::{InterestTier, LendingListing, ListingStatus, Position, PositionStatus};

fn setup() -> (
    Env,
    LendingContractClient<'static>,
    Address, // lender
    Address, // collection
) {
    let env = Env::default();
    env.mock_all_auths();

    let lender = Address::generate(&env);
    let collection = env.register(mock_nft::MockNft, ());

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    // Mint NFT to lender
    env.invoke_contract::<()>(
        &collection,
        &Symbol::new(&env, "mint"),
        vec![&env, lender.clone().into_val(&env), 1u64.into_val(&env)],
    );

    (env, client, lender, collection)
}

fn valid_interest_schedule(env: &Env) -> Vec<InterestTier> {
    vec![
        env,
        InterestTier {
            duration: 86400,
            interest_bps: 500,
        },
        InterestTier {
            duration: 172800,
            interest_bps: 1000,
        },
    ]
}

fn setup_active_position(
    env: &Env,
    start: u64,
) -> (
    Address,                              // contract_id
    LendingContractClient<'static>,       // client
    u64,                                  // position_id
    LendingListing,                       // listing
    Address,                              // borrower
    Address,                              // lender
    mock_token::MockTokenClient<'static>, // col_token
) {
    let lender = Address::generate(env);
    let borrower = Address::generate(env);
    let collection = env.register(mock_nft::MockNft, ());
    let col_token_addr = env.register(mock_token::MockToken, ());
    let col_token = mock_token::MockTokenClient::new(env, &col_token_addr);

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    // Mint NFT to lender
    env.invoke_contract::<()>(
        &collection,
        &Symbol::new(env, "mint"),
        vec![env, lender.clone().into_val(env), 1u64.into_val(env)],
    );

    // Mint collateral tokens to borrower (150M)
    col_token.mint(&borrower, &150_000_000);

    // Create listing
    let listing_id = client.create_listing(
        &lender,
        &collection,
        &1u64,
        &100_000_000_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &valid_interest_schedule(env),
    );

    let listing = client.get_listing(&listing_id).expect("listing exists");

    // Transfer initial 120M collateral from borrower to contract (simulating borrow)
    col_token.transfer(&borrower, &contract_id, &120_000_000);

    // Create position
    let position_id = 1u64;
    let position = Position {
        id: position_id,
        listing_id,
        lender: lender.clone(),
        borrower: borrower.clone(),
        nft_contract: collection.clone(),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency: col_token_addr.clone(),
        collateral_amount: 120_000_000,
        interest_schedule_bps: vec![env, 500u32],
        liquidation_threshold_bps: 11000,
        start_time: start,
        max_duration_secs: 86400 * 90,
        status: PositionStatus::Active,
    };

    env.as_contract(&contract_id, || {
        set_position(env, position_id, &position);
    });

    (
        contract_id,
        client,
        position_id,
        listing,
        borrower,
        lender,
        col_token,
    )
}

#[test]
fn test_create_listing_success() {
    let (env, client, lender, collection) = setup();

    let listing_id = client.create_listing(
        &lender,
        &collection,
        &1u64,
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &valid_interest_schedule(&env),
    );

    assert_eq!(listing_id, 1);

    let listing = client.get_listing(&1).expect("listing should exist");
    assert_eq!(listing.listing_id, 1);
    assert_eq!(listing.lender, lender);
    assert_eq!(listing.collection, collection);
    assert_eq!(listing.token_id, 1);
    assert_eq!(listing.price, 10_000_000_i128);
    assert_eq!(listing.status, ListingStatus::Open);

    // Verify NFT ownership moved to contract (escrowed)
    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        vec![&env, 1u64.into_val(&env)],
    );
    assert_eq!(owner, client.address);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_create_listing_zero_price_panics() {
    let (env, client, lender, collection) = setup();
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &0_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &valid_interest_schedule(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_create_listing_negative_price_panics() {
    let (env, client, lender, collection) = setup();
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &-1_000_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &valid_interest_schedule(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_create_listing_empty_interest_schedule_panics() {
    let (env, client, lender, collection) = setup();
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &vec![&env],
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_listing_invalid_bounds_min_zero_panics() {
    let (env, client, lender, collection) = setup();
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &0u64,
        &604800u64,
        &valid_interest_schedule(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_listing_invalid_bounds_max_less_than_min_panics() {
    let (env, client, lender, collection) = setup();
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &604800u64,
        &86400u64,
        &valid_interest_schedule(&env),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_create_listing_invalid_bounds_tier_duration_out_of_bounds_panics() {
    let (env, client, lender, collection) = setup();
    let invalid_schedule = vec![
        &env,
        InterestTier {
            duration: 1000, // Below min_duration of 86400
            interest_bps: 500,
        },
    ];
    client.create_listing(
        &lender,
        &collection,
        &1u64,
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &86400u64,
        &604800u64,
        &invalid_schedule,
    );
}

// ─── add_collateral tests ─────────────────────────────────────────────────────

use crate::interest::accrued_interest_usd;

/// Reads the stored Position for `position_id`.
fn read_position(env: &Env, contract_id: &Address, position_id: u64) -> Position {
    env.as_contract(contract_id, || {
        crate::storage::get_position(env, position_id)
    })
}

/// Health factor = collateral USD value / (owed USD * liquidation threshold),
/// scaled by 100_000 for precision. Oracle returns 1 USD/token, so the collateral
/// token value (7-dec fixpoint) equals collateral_amount.
fn health_factor(env: &Env, contract_id: &Address, position_id: u64, now: u64) -> i128 {
    let pos = read_position(env, contract_id, position_id);
    let collateral_value_usd = pos.collateral_amount;
    let owed_usd = pos.declared_price_usd + accrued_interest_usd(&pos, now);
    (collateral_value_usd * 100_000) / (owed_usd * (pos.liquidation_threshold_bps as i128))
}

/// Top-up increases stored collateral and moves tokens from borrower to contract.
#[test]
fn test_add_collateral_success() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (contract_id, client, position_id, _, borrower, _, col_token) =
        setup_active_position(&env, start);

    // Borrower minted 150M, posted 120M during borrow => 30M held.
    assert_eq!(col_token.balance(&borrower), 30_000_000);

    client.add_collateral(&position_id, &30_000_000);

    // Collateral moves from borrower to contract.
    assert_eq!(col_token.balance(&contract_id), 150_000_000);
    assert_eq!(col_token.balance(&borrower), 0);

    // Stored position collateral_amount is updated.
    let pos = read_position(&env, &contract_id, position_id);
    assert_eq!(pos.collateral_amount, 150_000_000);
    assert_eq!(pos.status, PositionStatus::Active);
}

/// Top-up increases the position's health factor.
#[test]
fn test_add_collateral_improves_health_factor() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (contract_id, client, position_id, _, _, _, _) = setup_active_position(&env, start);

    let before = health_factor(&env, &contract_id, position_id, start);
    client.add_collateral(&position_id, &30_000_000);
    let after = health_factor(&env, &contract_id, position_id, start);

    assert!(after > before, "health factor should improve after top-up");
}

/// Adding collateral to a closed (non-Active) position panics.
#[test]
#[should_panic(expected = "Position is not Active")]
fn test_add_collateral_closed_position_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (contract_id, client, position_id, _, _, _, _) = setup_active_position(&env, start);

    // Mark position as already closed (e.g. Returned).
    env.as_contract(&contract_id, || {
        let mut pos = crate::storage::get_position(&env, position_id);
        pos.status = PositionStatus::Returned;
        set_position(&env, position_id, &pos);
    });

    client.add_collateral(&position_id, &10_000_000);
}

/// Non-positive top-up amounts panic.
#[test]
#[should_panic(expected = "Collateral top-up amount must be positive")]
fn test_add_collateral_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (_, client, position_id, _, _, _, _) = setup_active_position(&env, start);

    client.add_collateral(&position_id, &0);
}
