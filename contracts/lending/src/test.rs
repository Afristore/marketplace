#![cfg(test)]

use super::*;
use crate::storage::{set_config, set_currency_symbol, set_listing, set_position};
use crate::types::{Listing, ListingStatus, PlatformConfig, PositionStatus};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient as TokenAdminClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        TokenClient::new(env, &contract_id),
        TokenAdminClient::new(env, &contract_id),
    )
}

#[test]
fn test_cancel_listing_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (nft_token, nft_admin) = create_token(&env, &token_admin);

    nft_admin.mint(&contract_id, &1);

    env.as_contract(&contract_id, || {
        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000, // 120%
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    client.cancel_listing(&1);

    assert_eq!(nft_token.balance(&lender), 1);
    assert_eq!(nft_token.balance(&contract_id), 0);

    let status = env.as_contract(&contract_id, || crate::storage::get_listing(&env, 1).status);
    assert_eq!(status, ListingStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Listing is not Open")]
fn test_cancel_listing_not_open() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);

    env.as_contract(&contract_id, || {
        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: Address::generate(&env),
                token_id: 1,
                declared_price_usd: 100_000_000,
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000,
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Filled,
                created_at: 1000,
            },
        );
    });

    client.cancel_listing(&1);
}

#[test]
fn test_borrow_success() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 2000);

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let admin = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &admin);
    let (col_token, col_admin) = create_token(&env, &admin);

    nft_admin.mint(&contract_id, &1);
    col_admin.mint(&borrower, &150_000_000); // 150 units

    env.as_contract(&contract_id, || {
        set_config(
            &env,
            &PlatformConfig {
                admin: admin.clone(),
                fee_receiver: admin.clone(),
                platform_fee_bps: 100,
                liquidator_fee_bps: 500,
                min_buffer_bps: 12000,
                max_buffer_bps: 20000,
                min_liq_threshold_bps: 11000,
                max_liq_threshold_bps: 15000,
                oracle_address: oracle_address.clone(),
                max_price_staleness_secs: 3600,
            },
        );

        let sym = String::from_str(&env, "USDC");
        set_currency_symbol(&env, &col_token.address, &sym);

        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000, // 100 USD
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000, // 120%
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    let position_id = client.borrow(&1, &borrower, &col_token.address, &120_000_000);

    assert_eq!(position_id, 1);
    assert_eq!(nft_token.balance(&borrower), 1);
    assert_eq!(col_token.balance(&contract_id), 120_000_000);

    env.as_contract(&contract_id, || {
        let listing = crate::storage::get_listing(&env, 1);
        assert_eq!(listing.status, ListingStatus::Filled);

        let pos = crate::storage::get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Active);
        assert_eq!(pos.borrower, borrower);
    });
}

#[test]
#[should_panic(expected = "Under-collateralized")]
fn test_borrow_under_collateralized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let admin = Address::generate(&env);

    let (nft_token, _) = create_token(&env, &admin);
    let (col_token, col_admin) = create_token(&env, &admin);

    col_admin.mint(&borrower, &150_000_000);

    env.as_contract(&contract_id, || {
        set_config(
            &env,
            &PlatformConfig {
                admin: admin.clone(),
                fee_receiver: admin.clone(),
                platform_fee_bps: 100,
                liquidator_fee_bps: 500,
                min_buffer_bps: 12000,
                max_buffer_bps: 20000,
                min_liq_threshold_bps: 11000,
                max_liq_threshold_bps: 15000,
                oracle_address: Address::generate(&env),
                max_price_staleness_secs: 3600,
            },
        );

        let sym = String::from_str(&env, "USDC");
        set_currency_symbol(&env, &col_token.address, &sym);

        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000, // 120% => 120 USD required
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    client.borrow(&1, &borrower, &col_token.address, &119_999_999);
}

#[test]
#[should_panic(expected = "Collateral currency not whitelisted")]
fn test_borrow_unwhitelisted_currency() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let admin = Address::generate(&env);

    let (nft_token, _) = create_token(&env, &admin);
    let (col_token, _) = create_token(&env, &admin);

    env.as_contract(&contract_id, || {
        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000,
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    client.borrow(&1, &borrower, &col_token.address, &120_000_000);
}

#[test]
#[should_panic(expected = "Listing is not Open")]
fn test_borrow_already_filled() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let admin = Address::generate(&env);

    let (nft_token, _) = create_token(&env, &admin);
    let (col_token, _) = create_token(&env, &admin);

    env.as_contract(&contract_id, || {
        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                interest_schedule_bps: vec![&env, 100],
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000,
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Filled,
                created_at: 1000,
            },
        );
    });

    client.borrow(&1, &borrower, &col_token.address, &120_000_000);
}

// ─── Settlement tests ────────────────────────────────────────────────────────

use crate::settlement::settle;
use crate::types::Position;

fn make_config(env: &Env, fee_receiver: Address, oracle: Address) -> PlatformConfig {
    PlatformConfig {
        admin: Address::generate(env),
        fee_receiver,
        platform_fee_bps: 100,   // 1%
        liquidator_fee_bps: 500, // 5%
        min_buffer_bps: 12000,
        max_buffer_bps: 20000,
        min_liq_threshold_bps: 11000,
        max_liq_threshold_bps: 15000,
        oracle_address: oracle,
        max_price_staleness_secs: 3600,
    }
}

fn make_position(
    env: &Env,
    lender: Address,
    borrower: Address,
    col_currency: Address,
    col_amount: i128,
) -> Position {
    Position {
        id: 1,
        listing_id: 1,
        lender,
        borrower,
        nft_contract: Address::generate(env),
        token_id: 1,
        declared_price_usd: 100_000_000, // 100 USD (7 dec)
        collateral_currency: col_currency,
        collateral_amount: col_amount,
        interest_schedule_bps: vec![env, 1000], // 10% for full period
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 86400 * 30, // 30 days
        status: PositionStatus::Active,
    }
}

/// Voluntary return: collateral partially consumed, remainder goes back to borrower.
/// 100 USD principal, 10% interest over 30 days => 110 USD owed.
/// platform_fee = 1% of 110 = 1.1 USD; liquidator_fee = 0 (voluntary).
/// total debit = 111.1 USD; oracle price = 1 USD/token => 111.1 tokens debited.
/// collateral = 150 tokens => borrower_rem = 150 - 111.1 = 38.9 tokens.
#[test]
fn test_settle_voluntary_return_partial_remaining() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 86400 * 30); // full 30-day period

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);
    let admin = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &admin);
    let contract_id = env.register(LendingContract, ());

    // Fund the contract with the borrower's collateral (150 tokens)
    col_admin.mint(&contract_id, &150_000_000);

    let config = make_config(&env, fee_receiver.clone(), oracle.clone());
    let position = make_position(
        &env,
        lender.clone(),
        borrower.clone(),
        col_token.address.clone(),
        150_000_000,
    );

    let result = env.as_contract(&contract_id, || settle(&env, &position, None, &config));

    // owed_usd = 100 + 10 = 110_000_000
    assert_eq!(result.owed_usd, 110_000_000);
    assert_eq!(result.accrued_interest_usd, 10_000_000);
    // platform_fee = 1% of 110 = 1_100_000
    assert_eq!(result.platform_fee_usd, 1_100_000);
    // no liquidator
    assert_eq!(result.liquidator_fee_usd, 0);
    assert_eq!(result.liquidator_payout, 0);

    // oracle returns 1 USD/token (10_000_000), so token amounts equal USD amounts
    // debit = 110_000_000 + 1_100_000 = 111_100_000
    assert_eq!(result.debit_tokens, 111_100_000);
    assert_eq!(result.lender_payout, 110_000_000);
    assert_eq!(result.platform_payout, 1_100_000);
    // borrower_rem = 150_000_000 - 111_100_000 = 38_900_000
    assert_eq!(result.borrower_rem, 38_900_000);

    // Verify actual token balances
    assert_eq!(col_token.balance(&lender), 110_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_100_000);
    assert_eq!(col_token.balance(&borrower), 38_900_000);
    assert_eq!(col_token.balance(&contract_id), 0);
}

/// Liquidation: full collateral consumed, borrower_rem = 0 (no underflow).
/// Same 110 USD owed, plus 5% liquidator fee = 5.5 USD.
/// total debit = 110 + 1.1 + 5.5 = 116.6 USD = 116_600_000 tokens.
/// collateral = 116_600_000 tokens (exactly equals debit) => borrower_rem = 0.
#[test]
fn test_settle_liquidation_full_collateral_consumed() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 86400 * 30);

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator_addr = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);
    let admin = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &admin);
    let contract_id = env.register(LendingContract, ());

    // collateral exactly equal to total debit (lender 110 + platform 1.1 + liquidator 5.5 = 116.6)
    col_admin.mint(&contract_id, &116_600_000);

    let config = make_config(&env, fee_receiver.clone(), oracle.clone());
    let position = make_position(
        &env,
        lender.clone(),
        borrower.clone(),
        col_token.address.clone(),
        116_600_000,
    );

    let result = env.as_contract(&contract_id, || {
        settle(&env, &position, Some(liquidator_addr.clone()), &config)
    });

    assert_eq!(result.liquidator_fee_usd, 5_500_000); // 5% of 110
    assert_eq!(result.liquidator_payout, 5_500_000);
    // debit_tokens == collateral => borrower_rem = 0
    assert_eq!(result.debit_tokens, 116_600_000);
    assert_eq!(result.borrower_rem, 0);

    // Verify actual token balances
    assert_eq!(col_token.balance(&lender), 110_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_100_000);
    assert_eq!(col_token.balance(&liquidator_addr), 5_500_000);
    assert_eq!(col_token.balance(&borrower), 0);
    assert_eq!(col_token.balance(&contract_id), 0);
}

/// Voluntary return at time=0: zero interest accrued, only principal + platform fee.
#[test]
fn test_settle_zero_interest_zero_liquidator_fee() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 0); // no elapsed time

    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);
    let admin = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &admin);
    let contract_id = env.register(LendingContract, ());

    col_admin.mint(&contract_id, &150_000_000);

    let config = make_config(&env, fee_receiver.clone(), oracle.clone());
    let mut position = make_position(
        &env,
        lender.clone(),
        borrower.clone(),
        col_token.address.clone(),
        150_000_000,
    );
    position.start_time = 0; // started at t=0, settled at t=0

    let result = env.as_contract(&contract_id, || settle(&env, &position, None, &config));

    assert_eq!(result.accrued_interest_usd, 0);
    assert_eq!(result.owed_usd, 100_000_000);
    assert_eq!(result.platform_fee_usd, 1_000_000); // 1% of 100
    assert_eq!(result.liquidator_fee_usd, 0);
    assert_eq!(result.debit_tokens, 101_000_000);
    assert_eq!(result.borrower_rem, 49_000_000); // 150 - 101
    assert_eq!(col_token.balance(&lender), 100_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_000_000);
    assert_eq!(col_token.balance(&borrower), 49_000_000);
}

// ─── return_nft tests ────────────────────────────────────────────────────────

/// Helper that sets up a fully active position ready for return_nft tests.
/// Returns (contract_id, client, position_id, lender, borrower, nft_token, col_token).
#[allow(clippy::type_complexity)]
fn setup_active_position<'a>(
    env: &'a Env,
    start_time: u64,
) -> (
    Address,
    LendingContractClient<'a>,
    u64,
    Address,
    Address,
    soroban_sdk::token::Client<'a>,
    soroban_sdk::token::Client<'a>,
) {
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    let lender = Address::generate(env);
    let borrower = Address::generate(env);
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let fee_receiver = Address::generate(env);

    let (nft_token, nft_admin) = create_token(env, &admin);
    let (col_token, col_admin) = create_token(env, &admin);

    // NFT sits with contract (pre-lent state); borrower holds collateral.
    nft_admin.mint(&contract_id, &1);
    col_admin.mint(&borrower, &150_000_000);

    env.as_contract(&contract_id, || {
        set_config(
            env,
            &PlatformConfig {
                admin: admin.clone(),
                fee_receiver: fee_receiver.clone(),
                platform_fee_bps: 100,   // 1%
                liquidator_fee_bps: 500, // 5%
                min_buffer_bps: 12000,
                max_buffer_bps: 20000,
                min_liq_threshold_bps: 11000,
                max_liq_threshold_bps: 15000,
                oracle_address: oracle.clone(),
                max_price_staleness_secs: 3600,
            },
        );

        let sym = String::from_str(env, "USDC");
        set_currency_symbol(env, &col_token.address, &sym);

        set_listing(
            env,
            1,
            &Listing {
                id: 1,
                lender: lender.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,        // 100 USD
                interest_schedule_bps: vec![env, 1000], // 10%/period
                max_duration_days: 30,
                min_collateral_buffer_bps: 12000,
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: start_time,
            },
        );
    });

    // Open the position via borrow().
    env.ledger().with_mut(|l| l.timestamp = start_time);
    let position_id = client.borrow(&1, &borrower, &col_token.address, &120_000_000);

    (
        contract_id,
        client,
        position_id,
        lender,
        borrower,
        nft_token,
        col_token,
    )
}

/// Happy path: borrower returns within term.
/// At t=0 (start_time) borrow, settle at t=15 days (half-month).
/// Interest = 10% * 15/30 = 5 USD = 5_000_000; platform = 1% of 105 = 1_050_000.
/// debit = 106_050_000; collateral = 120_000_000 => borrower_rem = 13_950_000.
#[test]
fn test_return_nft_success() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (contract_id, client, position_id, lender, borrower, nft_token, col_token) =
        setup_active_position(&env, start);

    // Advance to 15 days elapsed.
    env.ledger().with_mut(|l| l.timestamp = start + 15 * 86400);

    client.return_nft(&position_id);

    // NFT must be with lender.
    assert_eq!(nft_token.balance(&lender), 1);
    assert_eq!(nft_token.balance(&borrower), 0);
    assert_eq!(nft_token.balance(&contract_id), 0);

    // Borrower gets remainder back.
    // Started with 150M, posted 120M collateral (30M remained in wallet).
    // Settlement returns 13_950_000 => total = 30_000_000 + 13_950_000 = 43_950_000.
    assert_eq!(col_token.balance(&borrower), 43_950_000);

    // Position marked Returned.
    let status = env.as_contract(&contract_id, || {
        crate::storage::get_position(&env, position_id).status
    });
    assert_eq!(status, PositionStatus::Returned);
}

/// After-expiry call must panic.
#[test]
#[should_panic(expected = "Loan term has expired; use liquidate()")]
fn test_return_nft_after_expiry_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (_, client, position_id, _, _, _, _) = setup_active_position(&env, start);

    // Advance past 30-day max_duration.
    env.ledger().with_mut(|l| l.timestamp = start + 31 * 86400);

    client.return_nft(&position_id);
}

/// Calling return_nft on a non-Active position must panic.
#[test]
#[should_panic(expected = "Position is not Active")]
fn test_return_nft_not_active_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let start = 0u64;
    let (contract_id, client, position_id, _, _, _, _) = setup_active_position(&env, start);

    // Mark position as already returned directly in storage.
    env.as_contract(&contract_id, || {
        let mut pos = crate::storage::get_position(&env, position_id);
        pos.status = PositionStatus::Returned;
        set_position(&env, position_id, &pos);
    });

    client.return_nft(&position_id);
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
