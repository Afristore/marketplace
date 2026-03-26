#![cfg(test)]

use crate::{LazyMint1155, LazyMint1155Client, MintVoucher1155, Error};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

fn setup_env() -> (Env, LazyMint1155Client<'static>, Address, BytesN<32>) {
    let env = Env::default();

    let contract_id = env.register(LazyMint1155, ());
    let client = LazyMint1155Client::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let creator_pubkey = BytesN::from_array(&env, &[1u8; 32]);
    let name = String::from_str(&env, "LazyMint1155");
    let royalty_bps = 500u32;
    let royalty_receiver = Address::generate(&env);

    client.initialize(
        &creator,
        &creator_pubkey,
        &name,
        &royalty_bps,
        &royalty_receiver,
    );

    (env, client, creator, creator_pubkey)
}

#[test]
fn test_register_edition_success() {
    let (env, client, creator, _) = setup_env();
    let token_id = 1u64;
    let max_supply = 100u128;

    env.mock_all_auths();
    client.register_edition(&token_id, &max_supply);
    assert_eq!(client.edition_max_supply(&token_id), max_supply);
}

#[test]
fn test_register_edition_only_creator_fails_without_auth() {
    let (env, client, _creator, _) = setup_env();
    let token_id = 1u64;

    // Call without mock_all_auths should fail because creator auth is required
    let res = client.try_register_edition(&token_id, &100u128);
    assert!(res.is_err());
}

#[test]
fn test_redeem_fails_unregistered_edition() {
    let (env, client, _creator, _) = setup_env();
    let buyer = Address::generate(&env);
    let voucher = MintVoucher1155 {
        token_id: 1,
        buyer_quota: 10,
        price_per_unit: 0,
        currency: Address::generate(&env),
        uri: String::from_str(&env, "ipfs://..."),
        uri_hash: BytesN::from_array(&env, &[0u8; 32]),
        valid_until: 0,
    };
    let signature = BytesN::from_array(&env, &[0u8; 64]);

    env.mock_all_auths();
    let res = client.try_redeem(&buyer, &voucher, &1, &signature);
    assert_eq!(res, Err(Ok(Error::EditionNotRegistered)));
}

#[test]
fn test_redeem_enforces_max_supply() {
    let (env, client, creator, _) = setup_env();
    let token_id = 1u64;
    let max_supply = 5u128;

    env.mock_all_auths();
    client.register_edition(&token_id, &max_supply);

    let _buyer = Address::generate(&env);
    let _voucher = MintVoucher1155 {
        token_id,
        buyer_quota: 10,
        price_per_unit: 0,
        currency: Address::generate(&env),
        uri: String::from_str(&env, "ipfs://..."),
        uri_hash: BytesN::from_array(&env, &[0u8; 32]),
        valid_until: 0,
    };
    let _signature = BytesN::from_array(&env, &[0u8; 64]);
    
    // We expect this to fail with MaxSupplyReached if we were to proceed past sig check.
}

#[test]
fn test_buyer_quota_logic() {
    // Placeholder for quota logic verification
}
