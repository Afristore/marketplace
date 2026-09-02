#![cfg(test)]

use super::*;
use crate::settlement::settle;
use crate::storage::{set_config, set_currency_symbol, set_listing, set_position};
use crate::types::{Listing, ListingStatus, PlatformConfig, Position, PositionStatus};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient as TokenAdminClient};
use soroban_sdk::{vec, Address, Env, IntoVal, Symbol};

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        TokenClient::new(env, &contract_id),
        TokenAdminClient::new(env, &contract_id),
    )
}

// ─── Cancel listing tests ───────────────────────────────────────────────────

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

// ─── Borrow tests ───────────────────────────────────────────────────────────

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

        let sym = Symbol::new(&env, "USDC");
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

        let sym = Symbol::new(&env, "USDC");
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

    assert_eq!(result.owed_usd, 110_000_000);
    assert_eq!(result.accrued_interest_usd, 10_000_000);
    assert_eq!(result.platform_fee_usd, 1_100_000);
    assert_eq!(result.liquidator_fee_usd, 0);
    assert_eq!(result.liquidator_payout, 0);

    assert_eq!(result.debit_tokens, 111_100_000);
    assert_eq!(result.lender_payout, 110_000_000);
    assert_eq!(result.platform_payout, 1_100_000);
    assert_eq!(result.borrower_rem, 38_900_000);

    assert_eq!(col_token.balance(&lender), 110_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_100_000);
    assert_eq!(col_token.balance(&borrower), 38_900_000);
    assert_eq!(col_token.balance(&contract_id), 0);
}

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

    assert_eq!(result.liquidator_fee_usd, 5_500_000);
    assert_eq!(result.liquidator_payout, 5_500_000);
    assert_eq!(result.debit_tokens, 116_600_000);
    assert_eq!(result.borrower_rem, 0);

    assert_eq!(col_token.balance(&lender), 110_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_100_000);
    assert_eq!(col_token.balance(&liquidator_addr), 5_500_000);
    assert_eq!(col_token.balance(&borrower), 0);
    assert_eq!(col_token.balance(&contract_id), 0);
}

#[test]
fn test_settle_zero_interest_zero_liquidator_fee() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 0);

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
    position.start_time = 0;

    let result = env.as_contract(&contract_id, || settle(&env, &position, None, &config));

    assert_eq!(result.accrued_interest_usd, 0);
    assert_eq!(result.owed_usd, 100_000_000);
    assert_eq!(result.platform_fee_usd, 1_000_000);
    assert_eq!(result.liquidator_fee_usd, 0);
    assert_eq!(result.debit_tokens, 101_000_000);
    assert_eq!(result.borrower_rem, 49_000_000);
    assert_eq!(col_token.balance(&lender), 100_000_000);
    assert_eq!(col_token.balance(&fee_receiver), 1_000_000);
    assert_eq!(col_token.balance(&borrower), 49_000_000);
}

// ─── Initialize tests ───────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );

    env.as_contract(&contract_id, || {
        let config = crate::storage::get_config(&env);
        assert_eq!(config.admin, admin);
        assert_eq!(config.fee_receiver, fee_receiver);
        assert_eq!(config.oracle_address, oracle_address);
        assert_eq!(config.platform_fee_bps, 100);
        assert_eq!(config.liquidator_fee_bps, 500);
        assert_eq!(config.min_buffer_bps, 12000);
        assert_eq!(config.max_buffer_bps, 20000);
        assert_eq!(config.min_liq_threshold_bps, 11000);
        assert_eq!(config.max_liq_threshold_bps, 11500);
        assert_eq!(config.max_price_staleness_secs, 3600);
    });
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialize_double_init_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );
}

#[test]
#[should_panic(expected = "Invalid buffer bounds: min_buffer_bps must be less than max_buffer_bps")]
fn test_initialize_bad_buffer_bounds_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &20000, // min >= max
        &12000,
        &11000,
        &11500,
        &3600,
    );
}

#[test]
#[should_panic(
    expected = "Invalid liquidation threshold bounds: min_liq_threshold_bps must be less than max_liq_threshold_bps"
)]
fn test_initialize_bad_liq_threshold_bounds_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &15000, // min >= max
        &11000,
        &3600,
    );
}

#[test]
#[should_panic(expected = "Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps")]
fn test_initialize_max_liq_ge_min_buffer_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &12500, // max_liq_threshold >= min_buffer
        &3600,
    );
}

#[test]
#[should_panic(expected = "Invalid fees: combined fees must be less than 10000")]
fn test_initialize_bad_fees_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle_address = Address::generate(&env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &5000,
        &5000,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );
}

// ─── Liquidate entrypoint tests ───────────────────────────────────────────────

fn setup_liquidate_test<'a>(
    env: &'a Env,
) -> (
    LendingContractClient<'a>,
    Address,         // contract_id
    Address,         // admin
    Address,         // lender
    Address,         // borrower
    Address,         // liquidator
    Address,         // fee_receiver
    TokenClient<'a>, // nft_token
    TokenClient<'a>, // col_token
) {
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let lender = Address::generate(env);
    let borrower = Address::generate(env);
    let liquidator = Address::generate(env);
    let fee_receiver = Address::generate(env);
    let oracle_address = Address::generate(env);

    let (nft_token, nft_admin) = create_token(env, &admin);
    let (col_token, col_admin) = create_token(env, &admin);

    nft_admin.mint(&borrower, &1);
    col_admin.mint(&contract_id, &150_000_000);

    env.as_contract(&contract_id, || {
        set_config(
            env,
            &PlatformConfig {
                admin: admin.clone(),
                fee_receiver: fee_receiver.clone(),
                platform_fee_bps: 100,
                liquidator_fee_bps: 500,
                min_buffer_bps: 12000,
                max_buffer_bps: 20000,
                min_liq_threshold_bps: 11000,
                max_liq_threshold_bps: 15000,
                oracle_address,
                max_price_staleness_secs: 3600,
            },
        );

        let sym = Symbol::new(env, "USDC");
        set_currency_symbol(env, &col_token.address, &sym);
    });

    (
        client,
        contract_id,
        admin,
        lender,
        borrower,
        liquidator,
        fee_receiver,
        nft_token,
        col_token,
    )
}

#[test]
#[should_panic(expected = "Position is healthy; cannot liquidate")]
fn test_liquidate_healthy_position_panics() {
    let env = Env::default();
    let (
        client,
        contract_id,
        _admin,
        lender,
        borrower,
        liquidator,
        _fee_receiver,
        nft_token,
        col_token,
    ) = setup_liquidate_test(&env);

    env.ledger().with_mut(|l| l.timestamp = 2000);

    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 150_000_000,
                interest_schedule_bps: vec![&env, 100],
                liquidation_threshold_bps: 11000,
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    client.liquidate(&1, &liquidator);
}

#[test]
fn test_liquidate_expired_position() {
    let env = Env::default();
    let (
        client,
        contract_id,
        _admin,
        lender,
        borrower,
        liquidator,
        fee_receiver,
        nft_token,
        col_token,
    ) = setup_liquidate_test(&env);

    let now = 1000 + 30 * 86400 + 100;
    env.ledger().with_mut(|l| l.timestamp = now);

    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 150_000_000,
                interest_schedule_bps: vec![&env, 1000],
                liquidation_threshold_bps: 11000,
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    let nft_borrower_before = nft_token.balance(&borrower);
    let nft_lender_before = nft_token.balance(&lender);
    let nft_contract_before = nft_token.balance(&contract_id);

    client.liquidate(&1, &liquidator);

    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Expired);
    });

    assert_eq!(nft_token.balance(&borrower), nft_borrower_before);
    assert_eq!(nft_token.balance(&lender), nft_lender_before);
    assert_eq!(nft_token.balance(&contract_id), nft_contract_before);

    assert!(col_token.balance(&liquidator) > 0);
    assert!(col_token.balance(&lender) > 0);
    assert!(col_token.balance(&fee_receiver) > 0);
}

#[test]
fn test_liquidate_unhealthy_position() {
    let env = Env::default();
    let (
        client,
        contract_id,
        _admin,
        lender,
        borrower,
        liquidator,
        fee_receiver,
        nft_token,
        col_token,
    ) = setup_liquidate_test(&env);

    env.ledger().with_mut(|l| l.timestamp = 2000);

    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: nft_token.address.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 105_000_000,
                interest_schedule_bps: vec![&env, 0],
                liquidation_threshold_bps: 11000,
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    let nft_borrower_before = nft_token.balance(&borrower);

    client.liquidate(&1, &liquidator);

    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Liquidated);
    });

    assert_eq!(nft_token.balance(&borrower), nft_borrower_before);
    assert!(col_token.balance(&liquidator) > 0);
    assert!(col_token.balance(&lender) > 0);
    assert!(col_token.balance(&fee_receiver) > 0);
}

// ─── Admin parameter update tests ────────────────────────────────────────────

fn setup_initialized<'a>(env: &'a Env) -> (Address, LendingContractClient<'a>) {
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let fee_receiver = Address::generate(env);
    let oracle_address = Address::generate(env);

    client.initialize(
        &admin,
        &fee_receiver,
        &oracle_address,
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );

    (admin, client)
}

#[test]
fn test_admin_update_bounds_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, client) = setup_initialized(&env);

    client.admin_update_bounds(&13000, &25000, &12000, &12500);

    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let cfg = crate::storage::get_config(&env);
        assert_eq!(cfg.admin, admin);
        assert_eq!(cfg.min_buffer_bps, 13000);
        assert_eq!(cfg.max_buffer_bps, 25000);
        assert_eq!(cfg.min_liq_threshold_bps, 12000);
        assert_eq!(cfg.max_liq_threshold_bps, 12500);
    });
}

#[test]
#[should_panic]
fn test_admin_update_bounds_non_admin_panics() {
    let env = Env::default();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (
                admin.clone(),
                Address::generate(&env),
                Address::generate(&env),
                100u32,
                500u32,
                12000u32,
                20000u32,
                11000u32,
                11500u32,
                3600u64,
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &impostor,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "admin_update_bounds",
            args: (13000u32, 25000u32, 12000u32, 12500u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.admin_update_bounds(&13000, &25000, &12000, &12500);
}

#[test]
#[should_panic(expected = "Invalid buffer bounds: min_buffer_bps must be less than max_buffer_bps")]
fn test_admin_update_bounds_bad_buffer_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, client) = setup_initialized(&env);

    client.admin_update_bounds(&20000, &12000, &11000, &11500);
}

#[test]
#[should_panic(
    expected = "Invalid liquidation threshold bounds: min_liq_threshold_bps must be less than max_liq_threshold_bps"
)]
fn test_admin_update_bounds_bad_liq_threshold_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, client) = setup_initialized(&env);

    client.admin_update_bounds(&12000, &20000, &15000, &11000);
}

#[test]
#[should_panic(expected = "Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps")]
fn test_admin_update_bounds_max_liq_ge_min_buffer_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, client) = setup_initialized(&env);

    client.admin_update_bounds(&12000, &20000, &11000, &12500);
}

#[test]
fn test_admin_set_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, client) = setup_initialized(&env);

    client.admin_set_fees(&200, &800);

    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let cfg = crate::storage::get_config(&env);
        assert_eq!(cfg.admin, admin);
        assert_eq!(cfg.platform_fee_bps, 200);
        assert_eq!(cfg.liquidator_fee_bps, 800);
        assert_eq!(cfg.min_buffer_bps, 12000);
        assert_eq!(cfg.max_buffer_bps, 20000);
    });
}

#[test]
#[should_panic]
fn test_admin_set_fees_non_admin_panics() {
    let env = Env::default();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "initialize",
            args: (
                admin.clone(),
                Address::generate(&env),
                Address::generate(&env),
                100u32,
                500u32,
                12000u32,
                20000u32,
                11000u32,
                11500u32,
                3600u64,
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.initialize(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &100,
        &500,
        &12000,
        &20000,
        &11000,
        &11500,
        &3600,
    );

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &impostor,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "admin_set_fees",
            args: (200u32, 800u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.admin_set_fees(&200, &800);
}

#[test]
#[should_panic(expected = "Invalid fees: combined fees must be less than 10000")]
fn test_admin_set_fees_combined_ge_10000_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, client) = setup_initialized(&env);

    client.admin_set_fees(&5000, &5000);
}
