#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::{DataKey, Error, LazyMint721, LazyMint721Client};

fn setup_test() -> (Env, LazyMint721Client<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LazyMint721, ());
    let client = LazyMint721Client::new(&env, &contract_id);
    let creator = Address::generate(&env);

    (env, client, creator)
}

#[test]
fn test_transfer_with_missing_balance_returns_error() {
    let (env, client, creator) = setup_test();

    // Initialize the contract
    let pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let royalty_receiver = Address::generate(&env);
    client.initialize(
        &creator,
        &pubkey,
        &String::from_str(&env, "Token Name"),
        &String::from_str(&env, "TKN"),
        &1000u64,
        &0u32,
        &royalty_receiver,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // We manually set the Alice as owner in storage to simulate a state bug where
    // balance isn't incremented but ownership is recorded.
    env.as_contract(&client.address, || {
        env.storage().persistent().set(&DataKey::Owner(1), &alice);
        // We explicitly DO NOT set Alice's balance. It is missing.
    });

    // Try to transfer
    // Since Alice has no balance (is missing in storage), it should return an error
    // instead of silently succeeding and underflowing.
    let result = client.try_transfer(&alice, &bob, &1);

    assert_eq!(result, Err(Ok(Error::NotOwner)));
}

#[test]
fn test_transfer_with_zero_balance_returns_error() {
    let (env, client, creator) = setup_test();

    let pubkey = BytesN::from_array(&env, &[0u8; 32]);
    let royalty_receiver = Address::generate(&env);
    client.initialize(
        &creator,
        &pubkey,
        &String::from_str(&env, "Token Name"),
        &String::from_str(&env, "TKN"),
        &1000u64,
        &0u32,
        &royalty_receiver,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    env.as_contract(&client.address, || {
        env.storage().persistent().set(&DataKey::Owner(1), &alice);
        // Explicitly set Alice's balance to 0
        env.storage()
            .persistent()
            .set(&DataKey::BalanceOf(alice.clone()), &0u64);
    });

    let result = client.try_transfer(&alice, &bob, &1);

    assert_eq!(result, Err(Ok(Error::NotOwner)));
}
