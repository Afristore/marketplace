use super::*;

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
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RoyaltySplitter, ());
    let client = RoyaltySplitterClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    (env, client, token, contract_id)
}

// ── initialize ────────────────────────────────────────────────

#[test]
fn test_initialize_stores_config() {
    let (env, client, token, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.initialize(
        &token,
        &vec![&env, alice.clone(), bob.clone()],
        &vec![&env, 5_000_u32, 5_000_u32],
    );

    let err = client
        .try_initialize(
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
    let (env, client, token, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let err = client
        .try_initialize(
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
    let (env, client, token, _) = setup();
    let alice = Address::generate(&env);

    let err = client
        .try_initialize(
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
    let (env, client, token, _) = setup();

    let err = client
        .try_initialize(&token, &vec![&env], &vec![&env])
        .unwrap_err()
        .unwrap();

    assert_eq!(err, SplitterError::NoBeneficiaries.into());
}

// ── distribute ────────────────────────────────────────────────

#[test]
fn test_distribute_two_parties() {
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, contract_id) = setup();
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    // 3333 + 6667 = 10000; with balance=10 alice gets floor(3.333)=3, bob gets 6, caller gets 1
    client.initialize(
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
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, _) = setup();
    let caller = Address::generate(&env);

    let err = client.try_distribute(&token, &caller).unwrap_err().unwrap();
    assert_eq!(err, SplitterError::NotInitialized.into());
}

#[test]
fn test_distribute_single_beneficiary_gets_all() {
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(&token, &vec![&env, alice.clone()], &vec![&env, 10_000_u32]);

    let sac = StellarAssetClient::new(&env, &token);
    sac.mint(&contract_id, &5_000);

    client.distribute(&token, &caller);

    let tc = TokenClient::new(&env, &token);
    assert_eq!(tc.balance(&alice), 5_000);
    assert_eq!(tc.balance(&contract_id), 0);
}

#[test]
fn test_distribute_can_be_called_multiple_times() {
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
    let (env, client, token, contract_id) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let caller = Address::generate(&env);

    client.initialize(
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
