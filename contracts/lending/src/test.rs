#![cfg(test)]

use super::*;
use crate::storage::{set_config, set_currency_symbol, set_listing};
use crate::types::{Listing, ListingStatus, PlatformConfig, PositionStatus};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient as TokenAdminClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, IntoVal, Symbol,
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

// ─── Liquidate entrypoint tests ───────────────────────────────────────────────

use crate::storage::set_position;

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

    // Borrower holds 1 NFT (borrower was given NFT when opening borrow)
    nft_admin.mint(&borrower, &1);

    // Contract holds position collateral (e.g. 150 tokens)
    col_admin.mint(&contract_id, &150_000_000);

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
                oracle_address,
                max_price_staleness_secs: 3600,
            },
        );

        let sym = String::from_str(env, "USDC");
        set_currency_symbol(env, &col_token.address, &sym);
    // 2. Whitelist USDC as collateral
    env.as_contract(&contract_id, || {
        let sym = Symbol::new(&env, "USDC");
        set_currency_symbol(&env, &usdc_token.address, &sym);
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

    // Active position created at t=1000, max_duration=30 days (2,592,000s)
    // 100 USD declared price, 150 units collateral -> health ratio = 150% > 110% liquidation threshold.
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
                interest_schedule_bps: vec![&env, 100], // 1%
                liquidation_threshold_bps: 11000,       // 110%
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
        emit_listing_created(
            &env,
            listing_id,
            lender.clone(),
            nft_token.address.clone(),
            1,
            100_000_000,
        );
    });

    // Assert NFT is escrowed in contract
    assert_eq!(nft_token.balance(&contract_id), 1);
    assert_eq!(nft_token.balance(&lender), 0);

    // 4. Borrower calls borrow() with 150 USDC collateral (150% of 100 USD)
    let position_id = client.borrow(&listing_id, &borrower, &usdc_token.address, &150_000_000);

    // Assert NFT transferred to borrower
    assert_eq!(nft_token.balance(&borrower), 1);
    assert_eq!(nft_token.balance(&contract_id), 0);

    // Assert collateral escrowed in contract
    assert_eq!(usdc_token.balance(&contract_id), 150_000_000);
    assert_eq!(usdc_token.balance(&borrower), 0);

    // Assert position created with correct status
    env.as_contract(&contract_id, || {
        let listing = crate::storage::get_listing(&env, listing_id);
        assert_eq!(listing.status, ListingStatus::Filled);

        let pos = crate::storage::get_position(&env, position_id);
        assert_eq!(pos.status, PositionStatus::Active);
        assert_eq!(pos.borrower, borrower);
        assert_eq!(pos.collateral_amount, 150_000_000);
    });

    // 5. Advance ledger 45 days — verify health factor decreased
    env.ledger().with_mut(|l| l.timestamp = 1000 + (45 * 86400));

    let health_factor_mid = env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, position_id);
        // Health factor = collateral_value / (principal + accrued_interest)
        // At 45 days (halfway through 90-day term), accrued interest = 5% (half of 10%)
        // owed = 100 + 5 = 105 USD
        // health_factor = 150 / 105 = 1.428 (142.8%)
        // We can't call a view function directly, so we compute manually
        let accrued = crate::interest::accrued_interest_usd(&pos, env.ledger().timestamp());
        let owed = pos.declared_price_usd + accrued;
        (pos.collateral_amount * 10_000) / owed // health factor in basis points
    });

    // Health factor should be > 120% (liquidation threshold) but < 150% (initial)
    assert!(health_factor_mid > 12000);
    assert!(health_factor_mid < 15000);

    // 6. Borrower calls add_collateral() — verify health factor improved
    usdc_admin.mint(&borrower, &30_000_000); // Mint additional 30 USDC
    usdc_token.transfer(&borrower, &contract_id, &30_000_000);

    env.as_contract(&contract_id, || {
        let mut pos = crate::storage::get_position(&env, position_id);
        pos.collateral_amount += 30_000_000;
        set_position(&env, position_id, &pos);
        emit_collateral_added(&env, position_id, borrower.clone(), 30_000_000, 180_000_000);
    });

    let health_factor_after_topup = env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, position_id);
        let accrued = crate::interest::accrued_interest_usd(&pos, env.ledger().timestamp());
        let owed = pos.declared_price_usd + accrued;
        (pos.collateral_amount * 10_000) / owed
    });

    // Health factor should have improved
    assert!(health_factor_after_topup > health_factor_mid);
    assert_eq!(usdc_token.balance(&contract_id), 180_000_000);

    // 7. Borrower calls return_nft() — assert exact balances
    env.ledger().with_mut(|l| l.timestamp = 1000 + (90 * 86400)); // Advance to end of term

    // Transfer NFT back from borrower to contract
    nft_token.transfer(&borrower, &contract_id, &1);

    let initial_lender_balance = usdc_token.balance(&lender);
    let initial_fee_receiver_balance = usdc_token.balance(&fee_receiver);
    let initial_borrower_balance = usdc_token.balance(&borrower);

    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, position_id);
        let config = crate::storage::get_config(&env);
        let result = crate::settlement::settle(&env, &pos, None, &config);

        // Transfer NFT to lender
        let nft_client = TokenClient::new(&env, &pos.nft_contract);
        nft_client.transfer(&contract_id, &pos.lender, &(pos.token_id as i128));

        // Mark position as returned
        let mut updated_pos = pos.clone();
        updated_pos.status = PositionStatus::Returned;
        set_position(&env, position_id, &updated_pos);

        emit_position_returned(
            &env,
            position_id,
            result.accrued_interest_usd,
            result.platform_fee_usd,
            result.borrower_rem,
        );
    });

    // Attempt liquidation on healthy position
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
    env.mock_all_auths();
// ─── Admin parameter update tests ────────────────────────────────────────────

/// Seed a deployed contract with a default config and return the admin address
/// along with the contract client.
fn setup_initialized<'a>(env: &'a Env) -> (Address, LendingContractClient<'a>) {
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let liquidator_addr = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let oracle = Address::generate(&env);

    // 1. Deploy + initialize
    let (nft_token, nft_admin) = create_token(&env, &admin);
    let (usdc_token, usdc_admin) = create_token(&env, &admin);

    nft_admin.mint(&lender, &1);
    usdc_admin.mint(&borrower, &122_000_000); // 122 USDC = 122% of 100 USD (just above threshold)

    env.as_contract(&contract_id, || {
        set_config(
            &env,
            &PlatformConfig {
                admin: admin.clone(),
                fee_receiver: fee_receiver.clone(),
                platform_fee_bps: 100,   // 1%
                liquidator_fee_bps: 500, // 5%
                min_buffer_bps: 12000,
                max_buffer_bps: 20000,
                min_liq_threshold_bps: 12000, // 120%
                max_liq_threshold_bps: 15000,
                oracle_address: oracle.clone(),
                max_price_staleness_secs: 3600,
            },
        );
    });

    // 2. Whitelist USDC
    env.as_contract(&contract_id, || {
        let sym = Symbol::new(&env, "USDC");
        set_currency_symbol(&env, &usdc_token.address, &sym);
    });

    // Set ledger timestamp past the max duration
    // start_time = 1000, duration = 30 days (2,592,000s). Expiry at 2,593,000.
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
                interest_schedule_bps: vec![&env, 1000], // 10%
                liquidation_threshold_bps: 11000,
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    // Initial balances before liquidation
    let nft_borrower_before = nft_token.balance(&borrower);
    let nft_lender_before = nft_token.balance(&lender);
    let nft_contract_before = nft_token.balance(&contract_id);

    client.liquidate(&1, &liquidator);

    // Assert status updated to Expired
    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Expired);
    });

    // Assert NFT was untouched in all code paths!
    assert_eq!(nft_token.balance(&borrower), nft_borrower_before);
    assert_eq!(nft_token.balance(&lender), nft_lender_before);
    assert_eq!(nft_token.balance(&contract_id), nft_contract_before);

    // Assert liquidator bounty paid
    assert!(col_token.balance(&liquidator) > 0);

    // Assert lender & fee_receiver payouts made from collateral
    assert!(col_token.balance(&lender) > 0);
    assert!(col_token.balance(&fee_receiver) > 0);
    // Allow small rounding tolerance (within 1000 units = 0.0001 USD)
    assert!((102_400_000..=102_500_000).contains(&lender_received));
    assert!((5_100_000..=5_150_000).contains(&liquidator_received));
    assert!((1_020_000..=1_030_000).contains(&fee_received));
    assert!((13_400_000..=13_450_000).contains(&borrower_received));

    // Platform received its fee
    assert!(fee_received > 0);

    // Remainder went to borrower (if any)
    assert!(borrower_received > 0);

    // Contract balance is zero
    assert_eq!(usdc_token.balance(&contract_id), 0);

    // Position status is Liquidated
    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, position_id);
        assert_eq!(pos.status, PositionStatus::Liquidated);
    });
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

    // Time is within term (e.g. t=2000, start_time=1000)
    env.ledger().with_mut(|l| l.timestamp = 2000);

    // Position collateral is 105 tokens, declared price = 100 USD.
    // Liquidation threshold is 110% (110 USD).
    // Health factor = 105 USD * 10000 / 100 USD = 10500 bps (105%) <= 11000 bps (110%) -> UNHEALTHY!
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
                collateral_amount: 105_000_000, // 105 units collateral
                interest_schedule_bps: vec![&env, 0],
                liquidation_threshold_bps: 11000, // 110%
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    let nft_borrower_before = nft_token.balance(&borrower);

    client.liquidate(&1, &liquidator);

    // Assert status updated to Liquidated
    env.as_contract(&contract_id, || {
        let pos = crate::storage::get_position(&env, 1);
        assert_eq!(pos.status, PositionStatus::Liquidated);
    });

    // Assert NFT was untouched
    assert_eq!(nft_token.balance(&borrower), nft_borrower_before);

    // Assert liquidator bounty paid
    assert!(col_token.balance(&liquidator) > 0);

    // Assert payouts
    assert!(col_token.balance(&lender) > 0);
    assert!(col_token.balance(&fee_receiver) > 0);
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

// ── admin_update_bounds ───────────────────────────────────────────────────────

#[test]
fn test_admin_update_bounds_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, client) = setup_initialized(&env);

    // Update to new valid bounds.
    client.admin_update_bounds(&13000, &25000, &12000, &12500);

    // Retrieve config via contract context and verify every bound was persisted.
    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let cfg = crate::storage::get_config(&env);
        assert_eq!(cfg.admin, admin); // admin unchanged
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

    // Initialize with the real admin.
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

    // Attempt admin_update_bounds as impostor — must panic (auth failure).
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

    // min >= max for buffer — must panic.
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

    // min >= max for liq threshold — must panic.
    client.admin_update_bounds(&12000, &20000, &15000, &11000);
}

#[test]
#[should_panic(expected = "Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps")]
fn test_admin_update_bounds_max_liq_ge_min_buffer_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (_admin, client) = setup_initialized(&env);

    // max_liq_threshold >= min_buffer — must panic.
    client.admin_update_bounds(&12000, &20000, &11000, &12500);
}

// ── admin_set_fees ────────────────────────────────────────────────────────────

#[test]
fn test_admin_set_fees_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (admin, client) = setup_initialized(&env);

    // Update to new valid fees.
    client.admin_set_fees(&200, &800); // 2% + 8% = 10% < 100%

    let contract_id = client.address.clone();
    env.as_contract(&contract_id, || {
        let cfg = crate::storage::get_config(&env);
        assert_eq!(cfg.admin, admin); // admin unchanged
        assert_eq!(cfg.platform_fee_bps, 200);
        assert_eq!(cfg.liquidator_fee_bps, 800);
        // Bounds must be untouched.
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

    // Attempt admin_set_fees as impostor — must panic (auth failure).
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

    // 5000 + 5000 = 10000 — must panic.
    client.admin_set_fees(&5000, &5000);
}
