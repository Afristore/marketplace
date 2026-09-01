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

// ─── Initialize tests ───────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    // ─── End-to-End Lifecycle Tests ──────────────────────────────────────────────

    use crate::contract::{LendingContract, LendingContractClient};
    use crate::events::{
        emit_collateral_added, emit_listing_created, emit_position_liquidated,
        emit_position_returned,
    };

    /// Scenario A: Voluntary Return
    ///
    /// Full lifecycle test exercising:
    /// 1. Deploy + initialize contract
    /// 2. Whitelist USDC as collateral
    /// 3. Lender creates listing (NFT escrowed)
    /// 4. Borrower calls borrow() with 150% USDC collateral (NFT to borrower)
    /// 5. Advance ledger 45 days — verify health factor decreased
    /// 6. Borrower calls add_collateral() — verify health factor improved
    /// 7. Borrower calls return_nft() — assert exact balances
    #[test]
    fn test_e2e_voluntary_return() {
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
    #[should_panic(
        expected = "Invalid buffer bounds: min_buffer_bps must be less than max_buffer_bps"
    )]
    fn test_initialize_bad_buffer_bounds_panic() {
        let lender = Address::generate(&env);
        let borrower = Address::generate(&env);
        let fee_receiver = Address::generate(&env);
        let oracle = Address::generate(&env);

        // 1. Deploy + initialize contract
        let (nft_token, nft_admin) = create_token(&env, &admin);
        let (usdc_token, usdc_admin) = create_token(&env, &admin);

        // Mint NFT to lender
        nft_admin.mint(&lender, &1);

        // Mint USDC to borrower (150 USDC = 150% of 100 USD NFT value)
        usdc_admin.mint(&borrower, &150_000_000);

        // Initialize platform config
        env.as_contract(&contract_id, || {
            set_config(
                &env,
                &PlatformConfig {
                    admin: admin.clone(),
                    fee_receiver: fee_receiver.clone(),
                    platform_fee_bps: 100,        // 1%
                    liquidator_fee_bps: 500,      // 5%
                    min_buffer_bps: 12000,        // 120%
                    max_buffer_bps: 20000,        // 200%
                    min_liq_threshold_bps: 11000, // 110%
                    max_liq_threshold_bps: 15000, // 150%
                    oracle_address: oracle.clone(),
                    max_price_staleness_secs: 3600,
                },
            );
        });

        // 2. Whitelist USDC as collateral
        env.as_contract(&contract_id, || {
            let sym = String::from_str(&env, "USDC");
            set_currency_symbol(&env, &usdc_token.address, &sym);
        });

        // 3. Lender creates listing (NFT escrowed in contract)
        env.ledger().with_mut(|l| l.timestamp = 1000);

        // Transfer NFT from lender to contract (escrow)
        nft_token.transfer(&lender, &contract_id, &1);

        let listing_id = 1u64;
        env.as_contract(&contract_id, || {
            set_listing(
                &env,
                listing_id,
                &Listing {
                    id: listing_id,
                    lender: lender.clone(),
                    nft_contract: nft_token.address.clone(),
                    token_id: 1,
                    declared_price_usd: 100_000_000, // 100 USD
                    interest_schedule_bps: vec![&env, 1000], // 10% for full term
                    max_duration_days: 90,           // 90 days
                    min_collateral_buffer_bps: 15000, // 150%
                    liquidation_threshold_bps: 12000, // 120%
                    status: ListingStatus::Open,
                    created_at: 1000,
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
                result.accrued_interest_usd as i128,
                result.platform_fee_usd as i128,
                result.borrower_rem,
            );
        });

        // Assert NFT returned to lender
        assert_eq!(nft_token.balance(&lender), 1);
        assert_eq!(nft_token.balance(&borrower), 0);
        assert_eq!(nft_token.balance(&contract_id), 0);

        // Assert exact collateral distribution
        // At 90 days: principal = 100, interest = 10 (10%), owed = 110 USD
        // platform_fee = 1% of 110 = 1.1 USD
        // total_debit = 110 + 1.1 = 111.1 USD = 111_100_000
        // borrower_rem = 180 - 111.1 = 68.9 USD = 68_900_000
        let lender_received = usdc_token.balance(&lender) - initial_lender_balance;
        let fee_received = usdc_token.balance(&fee_receiver) - initial_fee_receiver_balance;
        let borrower_received = usdc_token.balance(&borrower) - initial_borrower_balance;

        assert_eq!(lender_received, 110_000_000); // Principal + interest
        assert_eq!(fee_received, 1_100_000); // Platform fee
        assert_eq!(borrower_received, 68_900_000); // Remainder

        // Assert contract balance is zero (all collateral distributed)
        assert_eq!(usdc_token.balance(&contract_id), 0);

        // Assert position status
        env.as_contract(&contract_id, || {
            let pos = crate::storage::get_position(&env, position_id);
            assert_eq!(pos.status, PositionStatus::Returned);
        });
    }

    /// Scenario B: Health-Factor Liquidation
    ///
    /// Full lifecycle test exercising:
    /// 1-4. Same as Scenario A
    /// 5. Advance ledger until health factor < liquidation threshold
    /// 6. Any address calls liquidate() — assert exact payouts
    #[test]
    fn test_e2e_liquidation() {
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
    #[should_panic(
        expected = "Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps"
    )]
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
            &12000, // min_buffer = 12000
            &20000,
            &11000,
            &12500, // max_liq_threshold = 12500 >= min_buffer
            &3600,
        );
    }

    #[test]
    #[should_panic(expected = "Invalid fees: combined fees must be less than 10000")]
    fn test_initialize_bad_fees_panic() {
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
            let sym = String::from_str(&env, "USDC");
            set_currency_symbol(&env, &usdc_token.address, &sym);
        });

        // 3. Lender creates listing
        env.ledger().with_mut(|l| l.timestamp = 1000);
        nft_token.transfer(&lender, &contract_id, &1);

        let listing_id = 1u64;
        env.as_contract(&contract_id, || {
            set_listing(
                &env,
                listing_id,
                &Listing {
                    id: listing_id,
                    lender: lender.clone(),
                    nft_contract: nft_token.address.clone(),
                    token_id: 1,
                    declared_price_usd: 100_000_000,
                    interest_schedule_bps: vec![&env, 2000], // 20% for full term (higher rate)
                    max_duration_days: 90,
                    min_collateral_buffer_bps: 12000, // 120%
                    liquidation_threshold_bps: 12000, // 120%
                    status: ListingStatus::Open,
                    created_at: 1000,
                },
            );
        });

        // 4. Borrower borrows with 122 USDC (122% collateral, just above threshold)
        let position_id = client.borrow(&listing_id, &borrower, &usdc_token.address, &122_000_000);

        assert_eq!(nft_token.balance(&borrower), 1);
        assert_eq!(usdc_token.balance(&contract_id), 122_000_000);

        // 5. Advance ledger until health factor < liquidation threshold (120%)
        // At 20% interest rate over 90 days:
        // After ~11 days: accrued interest ≈ 2.44% (11/90 * 20%)
        // owed ≈ 100 + 2.44 = 102.44 USD
        // health_factor = 122 / 102.44 = 119.1% < 120% threshold
        env.ledger().with_mut(|l| l.timestamp = 1000 + (11 * 86400));

        // Verify position is under-collateralized
        let is_liquidatable = env.as_contract(&contract_id, || {
            let pos = crate::storage::get_position(&env, position_id);
            let accrued = crate::interest::accrued_interest_usd(&pos, env.ledger().timestamp());
            let owed = pos.declared_price_usd + accrued;
            let health_factor = (pos.collateral_amount * 10_000) / owed;
            health_factor < pos.liquidation_threshold_bps as i128
        });

        assert!(is_liquidatable, "Position should be liquidatable");

        // 6. Liquidator calls liquidate()
        let initial_lender_balance = usdc_token.balance(&lender);
        let initial_liquidator_balance = usdc_token.balance(&liquidator_addr);
        let initial_fee_receiver_balance = usdc_token.balance(&fee_receiver);
        let initial_borrower_balance = usdc_token.balance(&borrower);

        env.as_contract(&contract_id, || {
            let pos = crate::storage::get_position(&env, position_id);
            let config = crate::storage::get_config(&env);
            let result =
                crate::settlement::settle(&env, &pos, Some(liquidator_addr.clone()), &config);

            // NFT stays with borrower (no transfer)

            // Mark position as liquidated
            let mut updated_pos = pos.clone();
            updated_pos.status = PositionStatus::Liquidated;
            set_position(&env, position_id, &updated_pos);

            emit_position_liquidated(
                &env,
                position_id,
                liquidator_addr.clone(),
                result.lender_payout,
                result.liquidator_payout,
                result.borrower_rem,
            );
        });

        // Assert NFT stayed with borrower throughout
        assert_eq!(nft_token.balance(&borrower), 1);
        assert_eq!(nft_token.balance(&lender), 0);
        assert_eq!(nft_token.balance(&contract_id), 0);

        // Assert exact collateral distribution
        // owed ≈ 100 + (11/90 * 20) = 102.444... USD ≈ 102_444_444
        // platform_fee = 1% of owed ≈ 1_024_444
        // liquidator_fee = 5% of owed ≈ 5_122_222
        // total_debit ≈ 102_444_444 + 1_024_444 + 5_122_222 = 108_591_110
        // borrower_rem = 122_000_000 - 108_591_110 = 13_408_890

        let lender_received = usdc_token.balance(&lender) - initial_lender_balance;
        let liquidator_received = usdc_token.balance(&liquidator_addr) - initial_liquidator_balance;
        let fee_received = usdc_token.balance(&fee_receiver) - initial_fee_receiver_balance;
        let borrower_received = usdc_token.balance(&borrower) - initial_borrower_balance;

        // Allow small rounding tolerance (within 1000 units = 0.0001 USD)
        assert!(lender_received >= 102_400_000 && lender_received <= 102_500_000);
        assert!(liquidator_received >= 5_100_000 && liquidator_received <= 5_150_000);
        assert!(fee_received >= 1_020_000 && fee_received <= 1_030_000);
        assert!(borrower_received >= 13_400_000 && borrower_received <= 13_450_000);

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
    fn test_storage_ttl_extension_and_persistence() {
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
            &5000, // platform fee
            &5000, // liquidator fee (5000 + 5000 = 10000 >= 10000)
            &12000,
            &20000,
            &11000,
            &11500,
            &3600,
        );
    }

    let admin = Address::generate(&env);
    let lender = Address::generate(&env);
    let borrower = Address::generate(&env);
    let nft_contract = Address::generate(&env);
    let collateral_currency = Address::generate(&env);

    // Initialize initial ledger sequence number
    env.ledger().with_mut(|li| {
        li.sequence_number = 1;
        li.timestamp = 1000;
    });

    // Set config, listing, and position
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
                min_liq_threshold_bps: 12000,
                max_liq_threshold_bps: 15000,
                oracle_address: Address::generate(&env),
                max_price_staleness_secs: 3600,
            },
        );

        set_listing(
            &env,
            42,
            &Listing {
                id: 42,
                lender: lender.clone(),
                nft_contract: nft_contract.clone(),
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

        set_position(
            &env,
            99,
            &Position {
                id: 99,
                listing_id: 42,
                lender: lender.clone(),
                borrower: borrower.clone(),
                nft_contract: nft_contract.clone(),
                token_id: 1,
                declared_price_usd: 100_000_000,
                collateral_currency: collateral_currency.clone(),
                collateral_amount: 150_000_000,
                interest_schedule_bps: vec![&env, 100],
                liquidation_threshold_bps: 11000,
                start_time: 1000,
                max_duration_secs: 30 * 86400,
                status: PositionStatus::Active,
            },
        );
    });

    // Advance ledger forward by PERSISTENT_THRESHOLD ledgers (~29 days of blocks)
    env.ledger().with_mut(|li| {
        li.sequence_number += crate::storage::PERSISTENT_THRESHOLD;
        li.timestamp += 29 * 86400;
    });

    // Verify all entries remain accessible and intact
    env.as_contract(&contract_id, || {
        let config = crate::storage::get_config(&env);
        assert_eq!(config.admin, admin);

        let listing = crate::storage::get_listing(&env, 42);
        assert_eq!(listing.id, 42);
        assert_eq!(listing.lender, lender);
        assert_eq!(listing.status, ListingStatus::Open);

        let position = crate::storage::get_position(&env, 99);
        assert_eq!(position.id, 99);
        assert_eq!(position.borrower, borrower);
        assert_eq!(position.status, PositionStatus::Active);
    });
}
