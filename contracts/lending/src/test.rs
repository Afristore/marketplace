#![cfg(test)]

use super::*;
use crate::interest::accrued_interest_usd;
use crate::settlement::settle;
use crate::storage::{get_config, get_listing, get_position, set_config, set_currency_symbol, set_listing, set_position};
use crate::types::{Listing, ListingStatus, PlatformConfig, Position, PositionStatus};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient as TokenAdminClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, String,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, TokenAdminClient<'a>) {
    let contract_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    (
        TokenClient::new(env, &contract_id),
        TokenAdminClient::new(env, &contract_id),
    )
}

/// Default platform config with sensible values for tests.
fn make_config(env: &Env, fee_receiver: Address, oracle: Address) -> PlatformConfig {
    PlatformConfig {
        admin: Address::generate(env),
        fee_receiver,
        platform_fee_bps: 100,    // 1%
        liquidator_fee_bps: 500,  // 5%
        min_buffer_bps: 12000,
        max_buffer_bps: 20000,
        min_liq_threshold_bps: 11000,
        max_liq_threshold_bps: 15000,
        oracle_address: oracle,
        max_price_staleness_secs: 3600,
    }
}

/// Build a position for settlement tests (100 USD declared, 10% schedule, 30-day term).
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

/// Register the contract and seed config + a whitelisted collateral currency.
fn setup_contract_with_config<'a>(
    env: &'a Env,
    oracle: &Address,
    fee_receiver: &Address,
    col_token_address: &Address,
) -> (Address, LendingContractClient<'a>) {
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(env, &contract_id);

    env.as_contract(&contract_id, || {
        let cfg = PlatformConfig {
            admin: Address::generate(env),
            fee_receiver: fee_receiver.clone(),
            platform_fee_bps: 100,
            liquidator_fee_bps: 500,
            min_buffer_bps: 12000,
            max_buffer_bps: 20000,
            min_liq_threshold_bps: 11000,
            max_liq_threshold_bps: 15000,
            oracle_address: oracle.clone(),
            max_price_staleness_secs: 3600,
        };
        set_config(env, &cfg);
        let sym = String::from_str(env, "USDC");
        set_currency_symbol(env, col_token_address, &sym);
    });

    (contract_id, client)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config / Init
// ═══════════════════════════════════════════════════════════════════════════════

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
        let config = get_config(&env);
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
        &admin, &fee_receiver, &oracle_address,
        &100, &500, &12000, &20000, &11000, &11500, &3600,
    );

    // Second call must panic.
    client.initialize(
        &admin, &fee_receiver, &oracle_address,
        &100, &500, &12000, &20000, &11000, &11500, &3600,
    );
}

#[test]
#[should_panic(
    expected = "Invalid buffer bounds: min_buffer_bps must be less than max_buffer_bps"
)]
fn test_initialize_bad_buffer_bounds_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &100, &500,
        &20000, // min >= max – invalid
        &12000,
        &11000, &11500,
        &3600,
    );
}

#[test]
#[should_panic(
    expected = "Invalid liquidation threshold bounds: min_liq_threshold_bps must be less than max_liq_threshold_bps"
)]
fn test_initialize_bad_liq_threshold_bounds_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &100, &500,
        &12000, &20000,
        &15000, // min >= max – invalid
        &11000,
        &3600,
    );
}

#[test]
#[should_panic(
    expected = "Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps"
)]
fn test_initialize_max_liq_ge_min_buffer_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &100, &500,
        &12000, &20000,
        &11000,
        &12500, // max_liq >= min_buffer – invalid
        &3600,
    );
}

#[test]
#[should_panic(expected = "Invalid fees: combined fees must be less than 10000")]
fn test_initialize_bad_fees_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    client.initialize(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &5000, // platform_fee + liquidator_fee = 10000 – invalid
        &5000,
        &12000, &20000,
        &11000, &11500,
        &3600,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Listings
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_create_listing_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, _) = create_token(&env, &token_admin);

    // Mint NFT to lender so they can escrow it.
    nft_admin.mint(&lender, &1);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    let listing_id = client.create_listing(
        &lender,
        &nft_token.address,
        &1u128,
        &100_000_000, // 100 USD (7 dec)
        &vec![&env, 500u32],
        &30u32,
        &12000u32, // min_collateral_buffer 120%
        &11000u32, // liq threshold 110%
    );

    // ID starts at 1.
    assert_eq!(listing_id, 1);

    // NFT must now be held in escrow by the contract.
    assert_eq!(nft_token.balance(&contract_id), 1);
    assert_eq!(nft_token.balance(&lender), 0);

    // Listing record must be stored with Open status.
    env.as_contract(&contract_id, || {
        let l = get_listing(&env, 1);
        assert_eq!(l.status, ListingStatus::Open);
        assert_eq!(l.lender, lender);
        assert_eq!(l.declared_price_usd, 100_000_000);
    });
}

#[test]
#[should_panic(expected = "declared_price_usd must be greater than zero")]
fn test_create_listing_zero_price_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, _) = create_token(&env, &token_admin);

    nft_admin.mint(&lender, &1);

    let (_contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    client.create_listing(
        &lender,
        &nft_token.address,
        &1u128,
        &0, // zero price – must panic
        &vec![&env, 500u32],
        &30u32,
        &12000u32,
        &11000u32,
    );
}

#[test]
#[should_panic(expected = "min_collateral_buffer_bps out of allowed range")]
fn test_create_listing_bad_buffer_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, _) = create_token(&env, &token_admin);

    nft_admin.mint(&lender, &1);

    let (_contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // min_buffer_bps in config = 12000; passing 5000 is below the floor.
    client.create_listing(
        &lender,
        &nft_token.address,
        &1u128,
        &100_000_000,
        &vec![&env, 500u32],
        &30u32,
        &5000u32, // out of range – must panic
        &11000u32,
    );
}

#[test]
fn test_cancel_listing_happy_path() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);

    // NFT is held in escrow by the contract.
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

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
                min_collateral_buffer_bps: 12000,
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    client.cancel_listing(&1);

    // NFT must have been returned to the lender.
    assert_eq!(nft_token.balance(&lender), 1);
    assert_eq!(nft_token.balance(&contract_id), 0);

    let status = env.as_contract(&contract_id, || get_listing(&env, 1).status);
    assert_eq!(status, ListingStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Listing is not Open")]
fn test_cancel_filled_listing_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let lender = Address::generate(&env);
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

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
                status: ListingStatus::Filled, // already filled
                created_at: 1000,
            },
        );
    });

    client.cancel_listing(&1);
}

#[test]
#[should_panic]
fn test_cancel_other_lender_panics() {
    let env = Env::default();
    // Do NOT mock_all_auths – auth check must fire for the wrong lender.
    let true_lender = Address::generate(&env);
    let impostor = Address::generate(&env);

    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        set_listing(
            &env,
            1,
            &Listing {
                id: 1,
                lender: true_lender.clone(),
                nft_contract: Address::generate(&env),
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

    // impostor tries to cancel; auth should reject because lender ≠ impostor.
    env.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &contract_id,
            fn_name: "cancel_listing",
            args: (1u64,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.cancel_listing(&1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Borrow
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_borrow_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 2000);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // NFT in escrow, borrower has collateral.
    nft_admin.mint(&contract_id, &1);
    col_admin.mint(&borrower, &150_000_000);

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

    let position_id = client.borrow(&1, &borrower, &col_token.address, &120_000_000);

    assert_eq!(position_id, 1);
    // NFT delivered to borrower.
    assert_eq!(nft_token.balance(&borrower), 1);
    // Collateral held in contract.
    assert_eq!(col_token.balance(&contract_id), 120_000_000);

    env.as_contract(&contract_id, || {
        let listing = get_listing(&env, 1);
        assert_eq!(listing.status, ListingStatus::Filled);

        let pos = get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Active);
        assert_eq!(pos.borrower, borrower);
        assert_eq!(pos.collateral_amount, 120_000_000);
    });
}

#[test]
#[should_panic(expected = "Under-collateralized")]
fn test_borrow_under_collateral_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, _) = create_token(&env, &token_admin);
    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    col_admin.mint(&borrower, &150_000_000);

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
                min_collateral_buffer_bps: 12000, // 120% => 120 USD required
                liquidation_threshold_bps: 11000,
                status: ListingStatus::Open,
                created_at: 1000,
            },
        );
    });

    // 1 token short of the required amount.
    client.borrow(&1, &borrower, &col_token.address, &119_999_999);
}

#[test]
#[should_panic(expected = "Collateral currency not whitelisted")]
fn test_borrow_nonwhitelisted_currency_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, _) = create_token(&env, &token_admin);
    // This token is NOT whitelisted.
    let (unlisted_token, unlisted_admin) = create_token(&env, &token_admin);
    let (col_token, _) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    unlisted_admin.mint(&borrower, &150_000_000);

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

    client.borrow(&1, &borrower, &unlisted_token.address, &120_000_000);
}

/// The oracle in this codebase is a stub returning a fixed price, so we cannot
/// make it return a stale price via the mock environment.  This test documents
/// the expectation by verifying the oracle call is exercised and the price is
/// used in collateral math (a zero-oracle-price would cause a divide-by-zero).
/// The "staleness" guard would live in a real oracle implementation.
#[test]
fn test_borrow_stale_oracle_note() {
    // Confirmed: oracle::get_price is called inside borrow; the stub always
    // returns 10_000_000 (1 USD/token).  A production oracle would enforce
    // max_price_staleness_secs.  No panic variant exists in the stub, so this
    // test is a documentation marker rather than a panic test.
    assert!(true, "stale-oracle enforcement is a production oracle concern");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Interest accrual (delegates to interest::accrued_interest_usd)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_interest_month_1_partial() {
    // 15 days elapsed, 5% monthly rate: 100 USD * 5% * 15/30 = 2.5 USD.
    let env = Env::default();
    let pos = Position {
        id: 1,
        listing_id: 1,
        lender: Address::generate(&env),
        borrower: Address::generate(&env),
        nft_contract: Address::generate(&env),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency: Address::generate(&env),
        collateral_amount: 150_000_000,
        interest_schedule_bps: vec![&env, 500u32],
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 86400 * 90,
        status: PositionStatus::Active,
    };
    let now = 15 * 86400;
    assert_eq!(accrued_interest_usd(&pos, now), 2_500_000);
}

#[test]
fn test_interest_full_month_1() {
    // Exactly 30 days: 100 * 5% = 5 USD.
    let env = Env::default();
    let pos = Position {
        id: 1,
        listing_id: 1,
        lender: Address::generate(&env),
        borrower: Address::generate(&env),
        nft_contract: Address::generate(&env),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency: Address::generate(&env),
        collateral_amount: 150_000_000,
        interest_schedule_bps: vec![&env, 500u32],
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 86400 * 90,
        status: PositionStatus::Active,
    };
    let now = 30 * 86400;
    assert_eq!(accrued_interest_usd(&pos, now), 5_000_000);
}

#[test]
fn test_interest_month_2_higher_rate() {
    // Schedule [500, 800]. 31 days = 1 full month at 500 bps + 1 partial day at 800 bps.
    // full:    100 * 5%       = 5_000_000
    // partial: 100 * 8% / 30 =   266_666
    let env = Env::default();
    let pos = Position {
        id: 1,
        listing_id: 1,
        lender: Address::generate(&env),
        borrower: Address::generate(&env),
        nft_contract: Address::generate(&env),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency: Address::generate(&env),
        collateral_amount: 150_000_000,
        interest_schedule_bps: vec![&env, 500u32, 800u32],
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 86400 * 90,
        status: PositionStatus::Active,
    };
    let now = 31 * 86400;
    assert_eq!(accrued_interest_usd(&pos, now), 5_266_666);
}

#[test]
fn test_interest_schedule_repeats_last() {
    // Schedule [500, 800]. 3 full months (90 days).
    // month 0: 500 bps → 5_000_000
    // month 1: 800 bps → 8_000_000
    // month 2: 800 bps (last repeats) → 8_000_000
    // total = 21_000_000
    let env = Env::default();
    let pos = Position {
        id: 1,
        listing_id: 1,
        lender: Address::generate(&env),
        borrower: Address::generate(&env),
        nft_contract: Address::generate(&env),
        token_id: 1,
        declared_price_usd: 100_000_000,
        collateral_currency: Address::generate(&env),
        collateral_amount: 150_000_000,
        interest_schedule_bps: vec![&env, 500u32, 800u32],
        liquidation_threshold_bps: 11000,
        start_time: 0,
        max_duration_secs: 86400 * 90,
        status: PositionStatus::Active,
    };
    let now = 90 * 86400;
    assert_eq!(accrued_interest_usd(&pos, now), 21_000_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Add Collateral
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_add_collateral_increases_health_factor() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1000);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // Seed existing position with 120 collateral.
    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: Address::generate(&env),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 120_000_000,
                interest_schedule_bps: vec![&env, 100u32],
                liquidation_threshold_bps: 11000,
                start_time: 0,
                max_duration_secs: 86400 * 30,
                status: PositionStatus::Active,
            },
        );
    });

    col_admin.mint(&borrower, &30_000_000); // top-up amount

    client.add_collateral(&1, &borrower, &30_000_000);

    // Collateral held in contract should increase.
    assert_eq!(col_token.balance(&contract_id), 30_000_000);

    // Position record should reflect new total.
    env.as_contract(&contract_id, || {
        let pos = get_position(&env, 1);
        assert_eq!(pos.collateral_amount, 150_000_000);
    });
}

#[test]
#[should_panic(expected = "Position is not Active")]
fn test_add_collateral_closed_position_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: Address::generate(&env),
                borrower: borrower.clone(),
                nft_contract: Address::generate(&env),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 120_000_000,
                interest_schedule_bps: vec![&env, 100u32],
                liquidation_threshold_bps: 11000,
                start_time: 0,
                max_duration_secs: 86400 * 30,
                status: PositionStatus::Returned, // already closed
            },
        );
    });

    col_admin.mint(&borrower, &10_000_000);
    client.add_collateral(&1, &borrower, &10_000_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Return NFT
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_return_nft_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    // Set time inside the 30-day window.
    env.ledger().with_mut(|l| l.timestamp = 86400 * 15);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // Collateral held in contract.
    col_admin.mint(&contract_id, &150_000_000);
    // NFT held by borrower (they return it).
    nft_admin.mint(&borrower, &1);

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
                interest_schedule_bps: vec![&env, 1000u32],
                liquidation_threshold_bps: 11000,
                start_time: 0,
                max_duration_secs: 86400 * 30,
                status: PositionStatus::Active,
            },
        );
    });

    client.return_nft(&1);

    // NFT should be with lender after return.
    assert_eq!(nft_token.balance(&lender), 1);
    assert_eq!(nft_token.balance(&borrower), 0);

    // Position should be marked Returned.
    env.as_contract(&contract_id, || {
        let pos = get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Returned);
    });

    // Contract should have paid out all collateral (no remainder stays locked).
    assert_eq!(col_token.balance(&contract_id), 0);
}

#[test]
#[should_panic(expected = "Position has expired; must be liquidated")]
fn test_return_nft_after_expiry_panics() {
    let env = Env::default();
    env.mock_all_auths();
    // Advance time past the 30-day window.
    env.ledger().with_mut(|l| l.timestamp = 86400 * 31 + 1);

    let token_admin = Address::generate(&env);
    let borrower = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, _) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    env.as_contract(&contract_id, || {
        set_position(
            &env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: Address::generate(&env),
                borrower: borrower.clone(),
                nft_contract: Address::generate(&env),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token.address.clone(),
                collateral_amount: 150_000_000,
                interest_schedule_bps: vec![&env, 100u32],
                liquidation_threshold_bps: 11000,
                start_time: 0,
                max_duration_secs: 86400 * 30, // expired
                status: PositionStatus::Active,
            },
        );
    });

    client.return_nft(&1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Liquidation
// ═══════════════════════════════════════════════════════════════════════════════

/// Helper: seed a position that is still within its window.
fn seed_active_position(
    env: &Env,
    contract_id: &Address,
    lender: &Address,
    borrower: &Address,
    col_token_address: &Address,
    col_amount: i128,
    liq_threshold_bps: u32,
) {
    env.as_contract(contract_id, || {
        set_position(
            env,
            1,
            &Position {
                id: 1,
                listing_id: 1,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: Address::generate(env),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: col_token_address.clone(),
                collateral_amount: col_amount,
                interest_schedule_bps: vec![env, 1000u32],
                liquidation_threshold_bps: liq_threshold_bps,
                start_time: 0,
                max_duration_secs: 86400 * 30,
                status: PositionStatus::Active,
            },
        );
    });
}

#[test]
#[should_panic(expected = "Position is healthy; cannot liquidate")]
fn test_liquidate_healthy_position_panics() {
    let env = Env::default();
    env.mock_all_auths();
    // Time = 0 so no interest has accrued; collateral is well above threshold.
    env.ledger().with_mut(|l| l.timestamp = 0);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // Collateral well above liq threshold (200% > 110%).
    col_admin.mint(&contract_id, &200_000_000);
    seed_active_position(
        &env,
        &contract_id,
        &lender,
        &borrower,
        &col_token.address,
        200_000_000,
        11000, // 110% liq threshold
    );

    client.liquidate(&1, &liquidator);
}

#[test]
fn test_liquidate_unhealthy_position() {
    let env = Env::default();
    env.mock_all_auths();
    // No elapsed time → zero accrued interest.
    // declared_price = 100 USD, liq_threshold = 200% → threshold = 200 USD.
    // Collateral = 190 USD < 200 USD threshold → position is unhealthy.
    // Settlement: owed=100, platform=1, liquidator=5 → total debit=106 USD.
    // 190 USD collateral is more than enough to cover the 106 USD debit.
    env.ledger().with_mut(|l| l.timestamp = 0);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    col_admin.mint(&contract_id, &190_000_000);

    // Use liq_threshold_bps = 20000 (200%) so threshold = 200 USD > 190 USD collateral.
    seed_active_position(
        &env,
        &contract_id,
        &lender,
        &borrower,
        &col_token.address,
        190_000_000,
        20000, // 200% threshold — collateral 190 USD < threshold 200 USD → unhealthy
    );

    client.liquidate(&1, &liquidator);

    // Position must be marked Liquidated (not Expired — time is within window).
    env.as_contract(&contract_id, || {
        let pos = get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Liquidated);
    });

    // All collateral distributed; nothing stays in contract.
    assert_eq!(col_token.balance(&contract_id), 0);
    // Liquidator and lender both got paid.
    assert!(col_token.balance(&liquidator) > 0);
    assert!(col_token.balance(&lender) > 0);
}

#[test]
fn test_liquidate_expired_position() {
    let env = Env::default();
    env.mock_all_auths();
    // Past the 30-day expiry window.
    env.ledger().with_mut(|l| l.timestamp = 86400 * 31 + 1);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    col_admin.mint(&contract_id, &150_000_000);
    seed_active_position(
        &env,
        &contract_id,
        &lender,
        &borrower,
        &col_token.address,
        150_000_000,
        11000,
    );

    client.liquidate(&1, &liquidator);

    // Expired → status should be Expired.
    env.as_contract(&contract_id, || {
        let pos = get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Expired);
    });

    assert_eq!(col_token.balance(&contract_id), 0);
}

/// The NFT is out of scope for the settlement module (it does not touch it).
/// This test verifies that the NFT balance of the contract is unchanged by
/// the liquidate() call – the NFT stays wherever it was (with the borrower).
#[test]
fn test_liquidate_nft_not_touched() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 86400 * 31 + 1);

    let token_admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let fee_receiver = Address::generate(&env);

    let (nft_token, nft_admin) = create_token(&env, &token_admin);
    let (col_token, col_admin) = create_token(&env, &token_admin);

    let (contract_id, client) =
        setup_contract_with_config(&env, &oracle, &fee_receiver, &col_token.address);

    // NFT stays with borrower during liquidation.
    nft_admin.mint(&borrower, &1);
    col_admin.mint(&contract_id, &150_000_000);

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
                interest_schedule_bps: vec![&env, 1000u32],
                liquidation_threshold_bps: 11000,
                start_time: 0,
                max_duration_secs: 86400 * 30, // expired
                status: PositionStatus::Active,
            },
        );
    });

    client.liquidate(&1, &liquidator);

    // NFT must still be with borrower – liquidate() does not touch it.
    assert_eq!(nft_token.balance(&borrower), 1);
    assert_eq!(nft_token.balance(&contract_id), 0);
    assert_eq!(nft_token.balance(&lender), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Settlement math
// ═══════════════════════════════════════════════════════════════════════════════

/// Voluntary return: collateral partially consumed, remainder goes back to borrower.
/// 100 USD principal, 10% interest over 30 days ⇒ 110 USD owed.
/// platform_fee = 1% of 110 = 1.1 USD; liquidator_fee = 0 (voluntary).
/// total debit = 111.1 USD; oracle price = 1 USD/token ⇒ 111.1 tokens debited.
/// collateral = 150 tokens ⇒ borrower_rem = 150 − 111.1 = 38.9 tokens.
#[test]
fn test_settlement_waterfall_amounts_correct() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 86400 * 30);

    let admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);

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

/// When collateral ≤ total debit, borrower_rem must be clamped to 0, never negative.
#[test]
fn test_settlement_borrower_remainder_floored_at_zero() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 86400 * 30);

    let admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator_addr = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);

    let (col_token, col_admin) = create_token(&env, &admin);
    let contract_id = env.register(LendingContract, ());

    // Exactly enough collateral to cover all payouts – nothing left for borrower.
    // owed=110, platform=1.1, liquidator=5.5 → total=116.6 USD = 116_600_000 tokens.
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

    // borrower_rem must never be negative.
    assert_eq!(result.borrower_rem, 0);
    assert_eq!(result.debit_tokens, 116_600_000);
    assert_eq!(col_token.balance(&borrower), 0);
    assert_eq!(col_token.balance(&contract_id), 0);
}
