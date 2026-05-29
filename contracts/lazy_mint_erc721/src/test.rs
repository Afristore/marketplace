use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String,
};

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

// ─── Signature Verification Error Handling Tests ─────────────────────────────

#[test]
fn test_invalid_signature_returns_proper_error() {
    let (env, client, creator) = setup_test();

    // Initialize the contract
    let pubkey = BytesN::from_array(&env, &[1u8; 32]); // Non-zero pubkey
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

    let buyer = Address::generate(&env);
    let currency = Address::generate(&env);

    // Create a voucher with valid data
    let voucher = crate::MintVoucher {
        token_id: 1,
        price: 100,
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://test-uri"),
        uri_hash: BytesN::from_array(&env, &[0u8; 32]),
        valid_until: u64::MAX,
    };

    // Create an invalid signature (all zeros)
    let invalid_signature = BytesN::from_array(&env, &[0u8; 64]);

    // Try to redeem with invalid signature
    let result = client.try_redeem(&buyer, &voucher, &invalid_signature);

    // Should return an error (host abort from ed25519_verify)
    assert!(result.is_err());
}

#[test]
fn test_wrong_signature_format_returns_proper_error() {
    let (env, client, creator) = setup_test();

    // Initialize the contract
    let pubkey = BytesN::from_array(&env, &[2u8; 32]);
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

    let buyer = Address::generate(&env);
    let currency = Address::generate(&env);

    // Create a voucher
    let voucher = crate::MintVoucher {
        token_id: 2,
        price: 200,
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://test-uri-2"),
        uri_hash: BytesN::from_array(&env, &[1u8; 32]),
        valid_until: u64::MAX,
    };

    // Create a signature with wrong format (random bytes)
    let wrong_signature = BytesN::from_array(&env, &[255u8; 64]);

    // Try to redeem with wrong signature format
    let result = client.try_redeem(&buyer, &voucher, &wrong_signature);

    // Should return an error (host abort from ed25519_verify)
    assert!(result.is_err());
}

#[test]
fn test_signature_for_wrong_voucher_data_returns_proper_error() {
    let (env, client, creator) = setup_test();

    // Initialize the contract
    let pubkey = BytesN::from_array(&env, &[3u8; 32]);
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

    let buyer = Address::generate(&env);
    let currency = Address::generate(&env);

    // Create original voucher
    let _original_voucher = crate::MintVoucher {
        token_id: 3,
        price: 300,
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://test-uri-3"),
        uri_hash: BytesN::from_array(&env, &[2u8; 32]),
        valid_until: u64::MAX,
    };

    // Create modified voucher (different token_id)
    let modified_voucher = crate::MintVoucher {
        token_id: 999, // Different token_id
        price: 300,
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://test-uri-3"),
        uri_hash: BytesN::from_array(&env, &[2u8; 32]),
        valid_until: u64::MAX,
    };

    // Use signature from original voucher but with modified voucher data
    // This would be a valid signature for the original voucher but invalid for the modified one
    let signature_for_original = BytesN::from_array(&env, &[42u8; 64]);

    // Try to redeem modified voucher with signature from original voucher
    let result = client.try_redeem(&buyer, &modified_voucher, &signature_for_original);

    // Should return an error (host abort from ed25519_verify)
    assert!(result.is_err());
}

#[test]
fn test_graceful_signature_error_handling_with_payment() {
    let (env, client, creator) = setup_test();

    // Initialize the contract
    let pubkey = BytesN::from_array(&env, &[4u8; 32]);
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

    let buyer = Address::generate(&env);
    let currency = Address::generate(&env);

    // Create a voucher with non-zero price
    let voucher = crate::MintVoucher {
        token_id: 4,
        price: 500, // Non-zero price
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://test-uri-4"),
        uri_hash: BytesN::from_array(&env, &[3u8; 32]),
        valid_until: u64::MAX,
    };

    // Create an invalid signature
    let invalid_signature = BytesN::from_array(&env, &[99u8; 64]);

    // Try to redeem with invalid signature and payment
    let result = client.try_redeem(&buyer, &voucher, &invalid_signature);

    // Should return an error (host abort from ed25519_verify)
    // Error happens before payment transfer — safe
    assert!(result.is_err());
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

#[test]
fn test_voucher_expired_returns_proper_error() {
    let (env, client, creator) = setup_test();

    let pubkey = BytesN::from_array(&env, &[5u8; 32]);
    let royalty_receiver = Address::generate(&env);
    client.initialize(
        &creator,
        &pubkey,
        &String::from_str(&env, "Expiry Test"),
        &String::from_str(&env, "EXP"),
        &1000u64,
        &0u32,
        &royalty_receiver,
    );

    let buyer = Address::generate(&env);
    let currency = Address::generate(&env);

    env.ledger().with_mut(|li| li.sequence_number = 100);

    let voucher = crate::MintVoucher {
        token_id: 1,
        price: 0,
        currency: currency.clone(),
        uri: String::from_str(&env, "ipfs://expired"),
        uri_hash: BytesN::from_array(&env, &[5u8; 32]),
        valid_until: 50,
    };

    let signature = BytesN::from_array(&env, &[0u8; 64]);

    let result = client.try_redeem(&buyer, &voucher, &signature);

    assert_eq!(result, Err(Ok(Error::VoucherExpired)));
}
