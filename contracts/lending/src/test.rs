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

use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{symbol_short, vec, Address, Env, IntoVal, Symbol, Vec};

use crate::contract::{LendingContract, LendingContractClient};
use crate::types::{InterestTier, ListingStatus, PlatformConfig, Position, PositionStatus};

#[derive(Clone, Debug)]
struct MockToken {
    address: Address,
}

fn create_token(env: &Env, _admin: &Address) -> (MockToken, Address) {
    let address = Address::generate(env);
    (MockToken { address: address.clone() }, address)
}

fn make_config(env: &Env, fee_receiver: Address, oracle: Address) -> PlatformConfig {
    PlatformConfig {
        admin: Address::generate(env),
        fee_receiver,
        platform_fee_bps: 200,
        liquidator_fee_bps: 100,
        min_buffer_bps: 12000,
        max_buffer_bps: 20000,
        min_liq_threshold_bps: 10500,
        max_liq_threshold_bps: 12000,
        oracle_address: oracle,
        max_price_staleness_secs: 60,
    }
}

fn set_config(env: &Env, config: &PlatformConfig) {
    env.storage().persistent().set(&crate::storage::DataKey::Config, config);
}

fn make_position(
    env: &Env,
    lender: Address,
    borrower: Address,
    collateral_currency: Address,
    collateral_amount: i128,
) -> Position {
    Position {
        id: 1,
        listing_id: 1,
        lender,
        borrower,
        nft_contract: Address::generate(env),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency,
        collateral_amount,
        interest_schedule_bps: vec![&env, 500u32],
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 90 * 86400,
        status: PositionStatus::Active,
    }
}

fn get_position(env: &Env, position_id: u64) -> Position {
    env.storage()
        .persistent()
        .get(&crate::storage::DataKey::Position(position_id))
        .expect("position not found")
}

fn set_position(env: &Env, position_id: u64, position: &Position) {
    env.storage()
        .persistent()
        .set(&crate::storage::DataKey::Position(position_id), position);
}

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

// ─── health_factor tests ─────────────────────────────────────────────────────

/// Registers the contract, stores platform config and a single active position,
/// then returns (contract address, client, position_id).
fn store_position_for_health_factor<'a>(
    env: &'a Env,
    declared_price_usd: i128,
    collateral_amount: i128,
    start_time: u64,
) -> (Address, LendingContractClient<'a>, u64) {
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    let lender = Address::generate(env);
    let borrower = Address::generate(env);
    let fee_receiver = Address::generate(env);
    let oracle = Address::generate(env);
    let (col_token, _) = create_token(env, &Address::generate(env));

    env.as_contract(&contract_id, || {
        set_config(env, &make_config(env, fee_receiver, oracle));

        let mut position =
            make_position(env, lender, borrower, col_token.address, collateral_amount);
        position.declared_price_usd = declared_price_usd;
        position.start_time = start_time;
        set_position(env, 1, &position);
    });

    (contract_id, client, 1)
}

/// Fresh position with 150% collateral must return 15000 bps.
#[test]
fn test_health_factor_fresh_position_equals_buffer_bps() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, position_id) =
        store_position_for_health_factor(&env, 100_000_000, 150_000_000, 0);

    // 150 USD collateral / 100 USD debt at t=0 (no interest) => 150% = 15000 bps.
    assert_eq!(client.health_factor(&position_id), 15000);
}

/// Health factor must decrease as interest accrues over time.
#[test]
fn test_health_factor_decreases_after_interest_accrues() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let (_, client, position_id) =
        store_position_for_health_factor(&env, 100_000_000, 150_000_000, 1000);

    let fresh = client.health_factor(&position_id);
    assert_eq!(fresh, 15000);

    // Advance 15 days at a 5% monthly rate => accrued interest = 100 * 5% * 15/30 = 2.5 USD.
    env.ledger().with_mut(|l| l.timestamp = 1000 + 15 * 86400);

    let decreased = client.health_factor(&position_id);
    // 150 / 102.5 => 14634 bps.
    assert_eq!(decreased, 14634);
    assert!(decreased < fresh);
}

/// A position with zero debt must report u32::MAX.
#[test]
fn test_health_factor_zero_debt_returns_max() {
    let env = Env::default();
    env.mock_all_auths();

    let (_, client, position_id) = store_position_for_health_factor(&env, 0, 150_000_000, 0);

    assert_eq!(client.health_factor(&position_id), u32::MAX);
}
