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

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{symbol_short, vec, Address, Env, IntoVal, Symbol, Vec};

use crate::contract::{LendingContract, LendingContractClient};
use crate::types::{InterestTier, ListingStatus};

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
