use super::*;

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use crate::contract::LendingContract;
use crate::types::LendingError;

fn setup() -> (
    Env,
    LendingContractClient<'static>,
    Address, // admin
    Address, // borrower
    Address, // collateral_token
    Address, // borrow_token
    Address, // contract_id
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let borrower = Address::generate(&env);

    let collateral_admin = Address::generate(&env);
    let collateral_token = env
        .register_stellar_asset_contract_v2(collateral_admin)
        .address();

    let borrow_admin = Address::generate(&env);
    let borrow_token = env
        .register_stellar_asset_contract_v2(borrow_admin)
        .address();

    client.initialize(&admin, &collateral_token, &borrow_token);

    // Fund borrower with collateral tokens
    let collateral_sac = StellarAssetClient::new(&env, &collateral_token);
    collateral_sac.mint(&borrower, &1_000_000);

    // Fund lending contract with liquidity in borrow tokens
    let borrow_sac = StellarAssetClient::new(&env, &borrow_token);
    borrow_sac.mint(&contract_id, &1_000_000);

    (
        env,
        client,
        admin,
        borrower,
        collateral_token,
        borrow_token,
        contract_id,
    )
}

#[test]
fn test_borrow_positive_collateral_succeeds() {
    let (env, client, _admin, borrower, collateral_token, borrow_token, contract_id) = setup();

    let collateral_amount: i128 = 500;
    let borrow_amount: i128 = 200;

    let col_tc = TokenClient::new(&env, &collateral_token);
    let bor_tc = TokenClient::new(&env, &borrow_token);

    let initial_borrower_col = col_tc.balance(&borrower);
    let initial_borrower_bor = bor_tc.balance(&borrower);
    let initial_contract_bor = bor_tc.balance(&contract_id);

    // Borrow with collateral_amount > 0
    client.borrow(&borrower, &collateral_amount, &borrow_amount);

    // Verify token transfers occurred as expected
    assert_eq!(
        col_tc.balance(&borrower),
        initial_borrower_col - collateral_amount
    );
    assert_eq!(col_tc.balance(&contract_id), collateral_amount);
    assert_eq!(
        bor_tc.balance(&borrower),
        initial_borrower_bor + borrow_amount
    );
    assert_eq!(
        bor_tc.balance(&contract_id),
        initial_contract_bor - borrow_amount
    );

    // Verify position state saved correctly
    let pos = client.get_position(&borrower).unwrap();
    assert_eq!(pos.borrower, borrower);
    assert_eq!(pos.collateral_amount, collateral_amount);
    assert_eq!(pos.borrow_amount, borrow_amount);
}

#[test]
fn test_borrow_zero_collateral_is_rejected() {
    let (env, client, _admin, borrower, collateral_token, borrow_token, contract_id) = setup();

    let collateral_amount: i128 = 0;
    let borrow_amount: i128 = 100;

    let col_tc = TokenClient::new(&env, &collateral_token);
    let bor_tc = TokenClient::new(&env, &borrow_token);

    let initial_borrower_col = col_tc.balance(&borrower);
    let initial_contract_col = col_tc.balance(&contract_id);
    let initial_borrower_bor = bor_tc.balance(&borrower);
    let initial_contract_bor = bor_tc.balance(&contract_id);

    // Attempt borrow with zero collateral amount
    let res = client.try_borrow(&borrower, &collateral_amount, &borrow_amount);

    // 1. Assert transaction fails with expected LendingError::InvalidCollateral
    let err = res.unwrap_err().unwrap();
    assert_eq!(err, LendingError::InvalidCollateral.into());

    // 2. Assert no token transfers occurred
    assert_eq!(
        col_tc.balance(&borrower),
        initial_borrower_col,
        "Borrower collateral token balance must remain unchanged"
    );
    assert_eq!(
        col_tc.balance(&contract_id),
        initial_contract_col,
        "Contract collateral token balance must remain unchanged"
    );
    assert_eq!(
        bor_tc.balance(&borrower),
        initial_borrower_bor,
        "Borrower borrow token balance must remain unchanged"
    );
    assert_eq!(
        bor_tc.balance(&contract_id),
        initial_contract_bor,
        "Contract borrow token balance must remain unchanged"
    );

    // 3. Assert no state mutation occurred
    assert_eq!(
        client.get_position(&borrower),
        None,
        "No borrow position should be recorded when transaction fails"
    );
}

#[test]
fn test_borrow_negative_collateral_is_rejected() {
    let (env, client, _admin, borrower, collateral_token, borrow_token, _contract_id) = setup();

    let col_tc = TokenClient::new(&env, &collateral_token);
    let bor_tc = TokenClient::new(&env, &borrow_token);

    let initial_borrower_col = col_tc.balance(&borrower);
    let initial_borrower_bor = bor_tc.balance(&borrower);

    // Test negative collateral case -100
    let res_neg = client.try_borrow(&borrower, &-100, &100);
    let err_neg = res_neg.unwrap_err().unwrap();
    assert_eq!(err_neg, LendingError::InvalidCollateral.into());

    // Test extreme negative collateral case i128::MIN
    let res_min = client.try_borrow(&borrower, &i128::MIN, &100);
    let err_min = res_min.unwrap_err().unwrap();
    assert_eq!(err_min, LendingError::InvalidCollateral.into());

    // Confirm state integrity: no token transfers or state updates
    assert_eq!(col_tc.balance(&borrower), initial_borrower_col);
    assert_eq!(bor_tc.balance(&borrower), initial_borrower_bor);
    assert_eq!(client.get_position(&borrower), None);
}

#[test]
fn test_borrow_multiple_valid_topups_succeed() {
    let (env, client, _admin, borrower, collateral_token, borrow_token, contract_id) = setup();

    let col_tc = TokenClient::new(&env, &collateral_token);
    let bor_tc = TokenClient::new(&env, &borrow_token);

    // First valid borrow
    client.borrow(&borrower, &300, &100);
    let pos1 = client.get_position(&borrower).unwrap();
    assert_eq!(pos1.collateral_amount, 300);
    assert_eq!(pos1.borrow_amount, 100);

    // Second valid borrow topup
    client.borrow(&borrower, &200, &50);
    let pos2 = client.get_position(&borrower).unwrap();
    assert_eq!(pos2.collateral_amount, 500);
    assert_eq!(pos2.borrow_amount, 150);

    assert_eq!(col_tc.balance(&contract_id), 500);
    assert_eq!(bor_tc.balance(&borrower), 150);
}
