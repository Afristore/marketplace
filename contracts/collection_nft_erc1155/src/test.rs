
extern crate std;

use std::format;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String, Vec,
};

use crate::{DataKey, NormalNFT1155, NormalNFT1155Client};

/// Utility: advance ledger sequence to simulate TTL expiry windows
fn jump_ledger(env: &Env, delta: u32) {
    env.ledger().with_mut(|li| {
        li.sequence_number += delta;
    });
}

/// Setup contract environment and return initialized client
fn setup() -> (Env, NormalNFT1155Client<'static>, Address, Address) {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    env.mock_all_auths();

    let contract_id = env.register(NormalNFT1155, ());
    let client = NormalNFT1155Client::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);

    client.initialize(
        &creator,
        &String::from_str(&env, "Test 1155"),
        &500u32,
        &royalty_receiver,
    );

    (env, client, contract_id, creator)
}

#[test]
fn test_mint_batch_success_multiple() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let token_ids = Vec::from_array(&env, [0u64, 1u64]);
    let amounts = Vec::from_array(&env, [100u128, 200u128]);
    let uris = Vec::from_array(
        &env,
        [
            String::from_str(&env, "uri-0"),
            String::from_str(&env, "uri-1"),
        ],
    );

    client.mint_batch(&alice, &token_ids, &amounts, &uris);

    assert_eq!(client.balance_of(&alice, &0u64), 100);
    assert_eq!(client.balance_of(&alice, &1u64), 200);
}

#[test]
fn test_mint_batch_try_success() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let token_ids = Vec::from_array(&env, [0u64]);
    let amounts = Vec::from_array(&env, [50u128]);
    let uris = Vec::from_array(&env, [String::from_str(&env, "uri-0")]);

    let result = client.try_mint_batch(&alice, &token_ids, &amounts, &uris);
    assert!(result.is_ok());
}

#[test]
fn test_mint_batch_length_mismatch_fails() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let token_ids = Vec::from_array(&env, [0u64, 1u64]);
    let amounts = Vec::from_array(&env, [100u128]);
    let uris = Vec::from_array(&env, [String::from_str(&env, "uri")]);

    let result = client.try_mint_batch(&alice, &token_ids, &amounts, &uris);
    assert!(result.is_err());
}

#[test]
fn test_mint_batch_empty_is_noop() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let empty_ids: Vec<u64> = Vec::new(&env);
    let empty_amounts: Vec<u128> = Vec::new(&env);
    let empty_uris: Vec<String> = Vec::new(&env);

client.mint_batch(&alice, &empty_ids, &empty_amounts, &empty_uris);
}

#[test]
fn test_existing_token_does_not_override_uri() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let ids = Vec::from_array(&env, [0u64]);
    let amounts = Vec::from_array(&env, [100u128]);
    let uris = Vec::from_array(&env, [String::from_str(&env, "original")]);

    client.mint_batch(&alice, &ids, &amounts, &uris);

    let new_uris = Vec::from_array(&env, [String::from_str(&env, "new")]);
    let amounts2 = Vec::from_array(&env, [50u128]);

    client.mint_batch(&alice, &ids, &amounts2, &new_uris);

    assert_eq!(client.uri(&0u64), String::from_str(&env, "original"));
    assert_eq!(client.total_supply(&0u64), 150);
}

#[test]
#[ignore]
fn test_auth_enforcement() {
    let (env, client, _, creator) = setup();
    let bob = Address::generate(&env);

    let ids = Vec::from_array(&env, [0u64]);
    let amounts = Vec::from_array(&env, [100u128]);
    let uris = Vec::from_array(&env, [String::from_str(&env, "uri")]);

    // Unauthorized
    let result = client.try_mint_batch(&bob, &ids, &amounts, &uris);
    assert!(result.is_err());

    // Authorized
    client.mint_batch(&creator, &ids, &amounts, &uris);
}



#[test]
fn test_ttl_persistence() {
    let (env, client, contract_id, _) = setup();
    let alice = Address::generate(&env);

    let token_id = client.mint_new(&alice, &10u128, &String::from_str(&env, "uri"));

    jump_ledger(&env, 60_000);

    let exists = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .has(&DataKey::TotalSupply(token_id))
    });

    assert!(exists);
}

#[test]
fn instance_ttl_is_extended_on_mint_new() {
    let (env, client, _contract_id, _creator) = setup();

    let alice = Address::generate(&env);

    jump_ledger(&env, 60_000);
    let token_id_0 = client.mint_new(&alice, &10u128, &String::from_str(&env, "uri-0"));

    jump_ledger(&env, 60_000);
    let token_id_1 = client.mint_new(&alice, &5u128, &String::from_str(&env, "uri-1"));

    assert_eq!(token_id_0, 0u64);
    assert_eq!(token_id_1, 1u64);
}

#[test]
fn persistent_ttl_is_extended_on_transfer_and_mint_keys() {
    let (env, client, contract_id, _creator) = setup();

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token_id = client.mint_new(&alice, &10u128, &String::from_str(&env, "uri"));

    client.transfer(&alice, &bob, &token_id, &3u128);

    jump_ledger(&env, 60_000);

    let (alice_balance_has, total_supply_has) = env.as_contract(&contract_id, || {
        let alice_balance_has = env
            .storage()
            .persistent()
            .has(&DataKey::Balance(alice.clone(), token_id));
        let total_supply_has = env
            .storage()
            .persistent()
            .has(&DataKey::TotalSupply(token_id));
        (alice_balance_has, total_supply_has)
    });

    assert!(alice_balance_has);
    assert!(total_supply_has);
}

#[test]
fn persistent_ttl_is_extended_on_burn_keys() {
    let (env, client, contract_id, _creator) = setup();

    let alice = Address::generate(&env);

    let token_id = client.mint_new(&alice, &10u128, &String::from_str(&env, "uri"));

    client.burn(&alice, &alice, &token_id, &4u128);

    jump_ledger(&env, 60_000);

    let (alice_balance_has, total_supply_has) = env.as_contract(&contract_id, || {
        let alice_balance_has = env
            .storage()
            .persistent()
            .has(&DataKey::Balance(alice.clone(), token_id));
        let total_supply_has = env
            .storage()
            .persistent()
            .has(&DataKey::TotalSupply(token_id));
        (alice_balance_has, total_supply_has)
    });

    assert!(alice_balance_has);
    assert!(total_supply_has);
}

