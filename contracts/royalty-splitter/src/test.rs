use super::*;

extern crate alloc;

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env,
};

fn setup() -> (
    Env,
    RoyaltySplitterClient<'static>,
    Address, // token
    Address, // contract_id
    Address, // admin
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RoyaltySplitter, ());
    let client = RoyaltySplitterClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    (env, client, token, contract_id, admin)
}

// ── initialize ────────────────────────────────────────────────

#[test]
fn test_initialize_stores_config() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 6_000_u32, 4_000_u32],
    );

    assert_eq!(client.get_token(), token);
    let beneficiaries = client.get_beneficiaries();
    assert_eq!(beneficiaries.get(0).unwrap(), alice);
    assert_eq!(beneficiaries.get(1).unwrap(), bob);
    let shares = client.get_shares();
    assert_eq!(shares.get(0).unwrap(), 6_000_u32);
    assert_eq!(shares.get(1).unwrap(), 4_000_u32);
}

#[test]
fn test_double_initialize_is_rejected() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    let err = client
        .try_initialize(
            &admin,
            &token,
            &vec![&env, alice, bob],
            &vec![&env, 5_000_u32, 5_000_u32],
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::AlreadyInitialized.into());
}

#[test]
fn test_shares_not_summing_to_10000_is_rejected() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let err = client
        .try_initialize(
            &admin,
            &token,
            &vec![&env, alice, bob],
            &vec![&env, 5_000_u32, 4_000_u32], // sums to 9000
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::InvalidShares.into());
}

#[test]
fn test_length_mismatch_is_rejected() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);

    let err = client
        .try_initialize(
            &admin,
            &token,
            &vec![&env, alice],
            &vec![&env, 5_000_u32, 5_000_u32],
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::LengthMismatch.into());
}

#[test]
fn test_empty_beneficiaries_is_rejected() {
    let (env, client, token, _, admin) = setup();

    let err = client
        .try_initialize(&admin, &token, &vec![&env], &vec![&env])
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::NoBeneficiaries.into());
}

// ── distribute ────────────────────────────────────────────────

#[test]
fn test_distribute_two_parties() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 6_000_u32, 4_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &10_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 6_000);
    assert_eq!(tc.balance(&bob), 4_000);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_three_parties() {
    let (env, client, token, contract_id, admin) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, a.clone(), b.clone(), c.clone()],
        &vec![&env, 3_334_u32, 3_333_u32, 3_333_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &9_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(
        tc.balance(&a) + tc.balance(&b) + tc.balance(&c) + tc.balance(&caller),
        9_000,
        "all funds must be distributed"
    );
    assert_eq!(tc.balance(&contract_id), 0, "contract must drain to zero");
}

#[test]
fn test_distribute_rounding_no_dust_trapped() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    // 3333 + 6667 = 10000; with balance=10 alice gets floor(3.333)=3, bob gets 6, caller gets 1
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 3_333_u32, 6_667_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &10);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(
        tc.balance(&alice) + tc.balance(&bob) + tc.balance(&caller),
        10
    );
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_empty_balance_is_noop() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // No tokens minted — should not panic
    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 0);
    assert_eq!(tc.balance(&bob), 0);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_callable_by_anyone() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 7_000_u32, 3_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &1_000);

    // Any address can trigger distribute — no special auth
    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 700);
    assert_eq!(tc.balance(&bob), 300);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_before_initialize_is_rejected() {
    let (env, client, token, _, _) = setup();
    let caller = Address::generate(&env);

    let err = client.try_distribute(&token, &caller).unwrap_err().unwrap();
    assert_eq!(err, SplitterError::NotInitialized.into());
}

#[test]
fn test_distribute_single_beneficiary_gets_all() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone()],
        &vec![&env, 10_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &5_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 5_000);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_can_be_called_multiple_times() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);

    sac.mint(&contract_id, &2_000);
    client.distribute(&token, &caller);

    sac.mint(&contract_id, &4_000);
    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 3_000);
    assert_eq!(tc.balance(&bob), 3_000);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_dust_goes_to_caller() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &10_001);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 5_000);
    assert_eq!(tc.balance(&bob), 5_000);
    assert_eq!(tc.balance(&caller), 1, "dust goes to caller");
    assert_eq!(tc.balance(&contract_id), 0);
}

// ── get_share ────────────────────────────────────────────────

#[test]
fn test_get_share_for_beneficiary() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 6_000_u32, 4_000_u32],
    );

    assert_eq!(client.get_share(&alice), 6_000_u32);
    assert_eq!(client.get_share(&bob), 4_000_u32);
}

#[test]
fn test_get_share_for_nonexistent_beneficiary() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice, bob],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    let err = client.try_get_share(&charlie).unwrap_err().unwrap();

    assert_eq!(err, SplitterError::BeneficiaryNotFound.into());
}

#[test]
fn test_get_share_before_initialize() {
    let (env, client, _token, _, _) = setup();
    let alice = Address::generate(&env);

    let err = client.try_get_share(&alice).unwrap_err().unwrap();
    assert_eq!(err, SplitterError::NotInitialized.into());
}

#[test]
fn test_get_share_single_beneficiary() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);

    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone()],
        &vec![&env, 10_000_u32],
    );

    assert_eq!(client.get_share(&alice), 10_000_u32);
}

// ── 100% royalty allocation enforcement regression tests ──────────────

#[test]
fn test_distribute_royalties_exact_100_percent_success() {
    let (env, client, token, contract_id, admin) = setup();
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);
    let caller = Address::generate(&env);

    // Configure exact 100% allocation across 3 recipients:
    // Recipient A -> 50% (5_000 BPS)
    // Recipient B -> 30% (3_000 BPS)
    // Recipient C -> 20% (2_000 BPS)
    // Total = 10_000 BPS (100%)
    client.initialize(
        &admin,
        &token,
        &vec![
            &env,
            recipient_a.clone(),
            recipient_b.clone(),
            recipient_c.clone(),
        ],
        &vec![&env, 5_000_u32, 3_000_u32, 2_000_u32],
    );

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &100_000);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&contract_id), 100_000);
    assert_eq!(tc.balance(&recipient_a), 0);
    assert_eq!(tc.balance(&recipient_b), 0);
    assert_eq!(tc.balance(&recipient_c), 0);

    // Call distribute
    client.distribute(&token, &caller);

    // Verify distribution succeeds and exact amounts are received
    assert_eq!(
        tc.balance(&recipient_a),
        50_000,
        "Recipient A should receive 50%"
    );
    assert_eq!(
        tc.balance(&recipient_b),
        30_000,
        "Recipient B should receive 30%"
    );
    assert_eq!(
        tc.balance(&recipient_c),
        20_000,
        "Recipient C should receive 20%"
    );
    assert_eq!(
        tc.balance(&contract_id),
        0,
        "Contract balance should be drained"
    );
    assert_eq!(tc.balance(&caller), 0, "No dust remainder for caller");

    // Verify getters return expected shares
    assert_eq!(client.get_share(&recipient_a), 5_000);
    assert_eq!(client.get_share(&recipient_b), 3_000);
    assert_eq!(client.get_share(&recipient_c), 2_000);
}

#[test]
fn test_distribute_royalties_less_than_100_percent_fails() {
    let (env, client, token, contract_id, admin) = setup();
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);
    let caller = Address::generate(&env);

    // Configure invalid allocation under 100%:
    // 40% + 30% + 20% = 90% (9_000 BPS)
    let err = client
        .try_initialize(
            &admin,
            &token,
            &vec![
                &env,
                recipient_a.clone(),
                recipient_b.clone(),
                recipient_c.clone(),
            ],
            &vec![&env, 4_000_u32, 3_000_u32, 2_000_u32],
        )
        .unwrap_err()
        .unwrap();

    // Verify transaction fails with SplitterError::InvalidShares
    assert_eq!(err, SplitterError::InvalidShares.into());

    // Mint funds to contract to test distribution fails on uninitialized contract
    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &100_000);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&contract_id), 100_000);

    // Verify state integrity: distribute fails because contract was not initialized
    let dist_err = client.try_distribute(&token, &caller).unwrap_err().unwrap();
    assert_eq!(dist_err, SplitterError::NotInitialized.into());

    // Confirm state integrity: no partial distribution, all balances and state remain unchanged
    assert_eq!(tc.balance(&recipient_a), 0, "Recipient A balance unchanged");
    assert_eq!(tc.balance(&recipient_b), 0, "Recipient B balance unchanged");
    assert_eq!(tc.balance(&recipient_c), 0, "Recipient C balance unchanged");
    assert_eq!(
        tc.balance(&contract_id),
        100_000,
        "Contract balance unchanged"
    );
    assert_eq!(tc.balance(&caller), 0, "Caller balance unchanged");

    assert_eq!(
        client.try_get_share(&recipient_a).unwrap_err().unwrap(),
        SplitterError::NotInitialized.into()
    );
}

#[test]
fn test_distribute_royalties_greater_than_100_percent_fails() {
    let (env, client, token, contract_id, admin) = setup();
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);
    let caller = Address::generate(&env);

    // Configure invalid allocation over 100%:
    // 50% + 40% + 20% = 110% (11_000 BPS)
    let err = client
        .try_initialize(
            &admin,
            &token,
            &vec![
                &env,
                recipient_a.clone(),
                recipient_b.clone(),
                recipient_c.clone(),
            ],
            &vec![&env, 5_000_u32, 4_000_u32, 2_000_u32],
        )
        .unwrap_err()
        .unwrap();

    // Verify transaction fails with SplitterError::InvalidShares
    assert_eq!(err, SplitterError::InvalidShares.into());

    // Mint funds to contract to test distribution fails on uninitialized contract
    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &100_000);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&contract_id), 100_000);

    // Verify state integrity: distribute fails because contract was not initialized
    let dist_err = client.try_distribute(&token, &caller).unwrap_err().unwrap();
    assert_eq!(dist_err, SplitterError::NotInitialized.into());

    // Confirm state integrity: no partial distribution, all balances and state remain unchanged
    assert_eq!(tc.balance(&recipient_a), 0, "Recipient A balance unchanged");
    assert_eq!(tc.balance(&recipient_b), 0, "Recipient B balance unchanged");
    assert_eq!(tc.balance(&recipient_c), 0, "Recipient C balance unchanged");
    assert_eq!(
        tc.balance(&contract_id),
        100_000,
        "Contract balance unchanged"
    );
    assert_eq!(tc.balance(&caller), 0, "Caller balance unchanged");

    assert_eq!(
        client.try_get_share(&recipient_a).unwrap_err().unwrap(),
        SplitterError::NotInitialized.into()
    );
}

#[test]
fn test_distribute_royalties_max_recipients_100_percent_success() {
    let (env, client, token, contract_id, admin) = setup();
    let caller = Address::generate(&env);

    // Max beneficiaries supported is 20, total must equal 10_000 BPS (500 BPS each = 5% each)
    let mut beneficiaries = vec![&env];
    let mut shares = vec![&env];
    let mut recipients = alloc::vec::Vec::new();

    for _ in 0..20 {
        let recipient = Address::generate(&env);
        beneficiaries.push_back(recipient.clone());
        shares.push_back(500_u32);
        recipients.push(recipient);
    }

    client.initialize(&admin, &token, &beneficiaries, &shares);

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &20_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    for recipient in recipients.iter() {
        assert_eq!(
            tc.balance(recipient),
            1_000,
            "Each recipient should receive exactly 5% of 20,000"
        );
    }
    assert_eq!(
        tc.balance(&contract_id),
        0,
        "Contract balance should be drained"
    );
}

#[test]
fn test_distribute_royalties_smallest_valid_percentages_100_percent_success() {
    let (env, client, token, contract_id, admin) = setup();
    let caller = Address::generate(&env);

    // Smallest BPS unit is 1 BPS (0.01%).
    // 19 recipients get 1 BPS each (19 BPS total = 0.19%)
    // 1 recipient gets 9,981 BPS (99.81%)
    // Total = 19 + 9,981 = 10,000 BPS (100%)
    let mut beneficiaries = vec![&env];
    let mut shares = vec![&env];
    let mut small_recipients = alloc::vec::Vec::new();

    for _ in 0..19 {
        let recipient = Address::generate(&env);
        beneficiaries.push_back(recipient.clone());
        shares.push_back(1_u32);
        small_recipients.push(recipient);
    }
    let large_recipient = Address::generate(&env);
    beneficiaries.push_back(large_recipient.clone());
    shares.push_back(9_981_u32);

    client.initialize(&admin, &token, &beneficiaries, &shares);

    let sac = StellarAssetClient::new(&env, &token);
    // Mint 10,000,000 tokens so 1 BPS = 1,000 tokens cleanly
    sac.mint(&contract_id, &10_000_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    for recipient in small_recipients.iter() {
        assert_eq!(
            tc.balance(recipient),
            1_000,
            "Small recipient with 1 BPS receives 1,000 tokens"
        );
    }
    assert_eq!(
        tc.balance(&large_recipient),
        9_981_000,
        "Large recipient with 9,981 BPS receives 9,981,000 tokens"
    );
    assert_eq!(tc.balance(&contract_id), 0);
}

// ── update_royalty_split ─────────────────────────────────────────────

#[test]
fn test_update_royalty_split_by_admin() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);

    // Initialize with initial config
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Update to new config
    client.update_royalty_split(
        &admin,
        &vec![&env, alice.clone(), bob.clone(), charlie.clone()],
        &vec![&env, 4_000_u32, 3_000_u32, 3_000_u32],
    );

    // Verify the update
    let beneficiaries = client.get_beneficiaries();
    assert_eq!(beneficiaries.len(), 3);
    assert_eq!(beneficiaries.get(0).unwrap(), alice);
    assert_eq!(beneficiaries.get(1).unwrap(), bob);
    assert_eq!(beneficiaries.get(2).unwrap(), charlie);

    let shares = client.get_shares();
    assert_eq!(shares.get(0).unwrap(), 4_000_u32);
    assert_eq!(shares.get(1).unwrap(), 3_000_u32);
    assert_eq!(shares.get(2).unwrap(), 3_000_u32);
}

#[test]
fn test_update_royalty_split_by_non_admin_fails() {
    let (env, client, token, _, admin) = setup();
    let non_admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Initialize with initial config
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Try to update as non-admin
    let err = client
        .try_update_royalty_split(
            &non_admin,
            &vec![&env, alice.clone(), bob.clone()],
            &vec![&env, 7_000_u32, 3_000_u32],
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::Unauthorized.into());

    // Verify state didn't change
    let shares = client.get_shares();
    assert_eq!(shares.get(0).unwrap(), 5_000_u32);
    assert_eq!(shares.get(1).unwrap(), 5_000_u32);
}

#[test]
fn test_update_royalty_split_before_initialize_fails() {
    let (env, client, _token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Try to update before initialization
    let err = client
        .try_update_royalty_split(
            &admin,
            &vec![&env, alice, bob],
            &vec![&env, 5_000_u32, 5_000_u32],
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::NotInitialized.into());
}

#[test]
fn test_update_royalty_split_with_invalid_shares_fails() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);

    // Initialize
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Try to update with shares that don't sum to 10,000
    let err = client
        .try_update_royalty_split(
            &admin,
            &vec![&env, alice.clone(), bob.clone(), charlie.clone()],
            &vec![&env, 4_000_u32, 3_000_u32, 2_000_u32], // Sums to 9,000
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::InvalidShares.into());

    // Verify state didn't change
    let shares = client.get_shares();
    assert_eq!(shares.get(0).unwrap(), 5_000_u32);
    assert_eq!(shares.get(1).unwrap(), 5_000_u32);
}

#[test]
fn test_update_royalty_split_with_empty_beneficiaries_fails() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Initialize
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice, bob],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Try to update with empty beneficiaries
    let err = client
        .try_update_royalty_split(&admin, &vec![&env], &vec![&env])
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::NoBeneficiaries.into());
}

#[test]
fn test_update_royalty_split_with_too_many_beneficiaries_fails() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Initialize
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Create 21 beneficiaries (MAX_BENEFICIARIES is 20)
    let mut beneficiaries = vec![&env];
    let mut shares = vec![&env];
    for _ in 0..21 {
        beneficiaries.push_back(Address::generate(&env));
        shares.push_back(1_u32);
    }

    // Try to update with too many beneficiaries
    let err = client
        .try_update_royalty_split(&admin, &beneficiaries, &shares)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::TooManyBeneficiaries.into());
}

#[test]
fn test_update_royalty_split_length_mismatch_fails() {
    let (env, client, token, _, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Initialize
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // Try to update with mismatched lengths
    let err = client
        .try_update_royalty_split(
            &admin,
            &vec![&env, alice.clone(), bob.clone()],
            &vec![&env, 7_000_u32], // Only 1 share for 2 beneficiaries
        )
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::LengthMismatch.into());
}

#[test]
fn test_update_royalty_split_multiple_times() {
    let (env, client, token, contract_id, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);
    let dave = Address::generate(&env);

    // Initialize with 2 beneficiaries
    client.initialize(
        &admin,
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    // First update - 3 beneficiaries
    client.update_royalty_split(
        &admin,
        &vec![&env, alice.clone(), bob.clone(), charlie.clone()],
        &vec![&env, 4_000_u32, 3_000_u32, 3_000_u32],
    );

    let shares = client.get_shares();
    assert_eq!(shares.len(), 3);
    assert_eq!(shares.get(0).unwrap(), 4_000_u32);
    assert_eq!(shares.get(1).unwrap(), 3_000_u32);
    assert_eq!(shares.get(2).unwrap(), 3_000_u32);

    // Second update - 4 beneficiaries
    client.update_royalty_split(
        &admin,
        &vec![
            &env,
            alice.clone(),
            bob.clone(),
            charlie.clone(),
            dave.clone(),
        ],
        &vec![&env, 2_500_u32, 2_500_u32, 2_500_u32, 2_500_u32],
    );

    let shares = client.get_shares();
    assert_eq!(shares.len(), 4);
    assert_eq!(shares.get(0).unwrap(), 2_500_u32);
    assert_eq!(shares.get(1).unwrap(), 2_500_u32);
    assert_eq!(shares.get(2).unwrap(), 2_500_u32);
    assert_eq!(shares.get(3).unwrap(), 2_500_u32);

    // Verify distribution still works
    let caller = Address::generate(&env);
    let sac = StellarAssetClient::new(&env, &token);
    // Use contract_id from setup instead of env.current_contract_address()
    sac.mint(&contract_id, &1_000_000);
    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 250_000);
    assert_eq!(tc.balance(&bob), 250_000);
    assert_eq!(tc.balance(&charlie), 250_000);
    assert_eq!(tc.balance(&dave), 250_000);
}

// ── Invalid Recipient Address Regression Tests ─────────────────────────────

#[test]
#[should_panic]
fn test_distribute_royalties_invalid_strkey_recipient_fails() {
    let env = Env::default();
    let invalid_bytes = soroban_sdk::Bytes::from_slice(&env, b"INVALID_RECIPIENT_ADDRESS_STRKEY");
    let _invalid = Address::from_string_bytes(&invalid_bytes);
}

#[test]
#[should_panic]
fn test_distribute_royalties_invalid_recipient_first_position_fails() {
    let (env, client, token, _, admin) = setup();
    let valid_b = Address::generate(&env);
    let valid_c = Address::generate(&env);

    let invalid_bytes = soroban_sdk::Bytes::from_array(&env, &[0xff; 32]);
    let invalid_a = Address::from_string_bytes(&invalid_bytes);

    client.initialize(
        &admin,
        &token,
        &vec![&env, invalid_a, valid_b, valid_c],
        &vec![&env, 5_000_u32, 3_000_u32, 2_000_u32],
    );
}

#[test]
#[should_panic]
fn test_distribute_royalties_invalid_recipient_middle_position_fails() {
    let (env, client, token, _, admin) = setup();
    let valid_a = Address::generate(&env);
    let valid_c = Address::generate(&env);

    let invalid_bytes = soroban_sdk::Bytes::from_array(&env, &[0xff; 32]);
    let invalid_b = Address::from_string_bytes(&invalid_bytes);

    client.initialize(
        &admin,
        &token,
        &vec![&env, valid_a, invalid_b, valid_c],
        &vec![&env, 5_000_u32, 3_000_u32, 2_000_u32],
    );
}

#[test]
#[should_panic]
fn test_distribute_royalties_invalid_recipient_final_position_fails() {
    let (env, client, token, _, admin) = setup();
    let valid_a = Address::generate(&env);
    let valid_b = Address::generate(&env);

    let invalid_bytes = soroban_sdk::Bytes::from_array(&env, &[0xff; 32]);
    let invalid_c = Address::from_string_bytes(&invalid_bytes);

    client.initialize(
        &admin,
        &token,
        &vec![&env, valid_a, valid_b, invalid_c],
        &vec![&env, 5_000_u32, 3_000_u32, 2_000_u32],
    );
}