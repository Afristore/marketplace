use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};
use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};

use crate::events;
use crate::interest::accrued_interest_usd;
use crate::oracle;
use crate::settlement::settle;
use crate::storage::{
    get_config, get_listing, get_position, has_config, is_currency_whitelisted, next_listing_id,
    next_position_id, set_config, set_listing, set_position,
use crate::oracle;
use crate::settlement;
use crate::storage::{
    extend_instance_ttl, get_config, get_currency_symbol, get_listing, get_position,
    is_currency_whitelisted, next_position_id, set_currency_symbol, set_listing, set_position,
};
use crate::types::{Listing, ListingStatus, PlatformConfig, Position, PositionStatus};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    // ── Config ────────────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        fee_receiver: Address,
        oracle_address: Address,
        platform_fee_bps: u32,
        liquidator_fee_bps: u32,
        min_buffer_bps: u32,
        max_buffer_bps: u32,
        min_liq_threshold_bps: u32,
        max_liq_threshold_bps: u32,
        max_price_staleness_secs: u64,
    ) {
        if has_config(&env) {
            panic!("Already initialized");
        }

        admin.require_auth();

        if min_buffer_bps >= max_buffer_bps {
            panic!("Invalid buffer bounds: min_buffer_bps must be less than max_buffer_bps");
        }

        if min_liq_threshold_bps >= max_liq_threshold_bps {
            panic!("Invalid liquidation threshold bounds: min_liq_threshold_bps must be less than max_liq_threshold_bps");
        }

        if max_liq_threshold_bps >= min_buffer_bps {
            panic!("Invalid bounds: max_liq_threshold_bps must be less than min_buffer_bps");
        }

        if platform_fee_bps.saturating_add(liquidator_fee_bps) >= 10000 {
            panic!("Invalid fees: combined fees must be less than 10000");
        }

        let config = PlatformConfig {
            admin,
            fee_receiver,
            platform_fee_bps,
            liquidator_fee_bps,
            min_buffer_bps,
            max_buffer_bps,
            min_liq_threshold_bps,
            max_liq_threshold_bps,
            oracle_address,
            max_price_staleness_secs,
        };

        set_config(&env, &config);
    }

    // ── Listings ──────────────────────────────────────────────────────────────

    pub fn create_listing(
        env: Env,
        lender: Address,
        nft_contract: Address,
        token_id: u128,
        declared_price_usd: i128,
        interest_schedule_bps: Vec<u32>,
        max_duration_days: u32,
        min_collateral_buffer_bps: u32,
        liquidation_threshold_bps: u32,
    ) -> u64 {
        lender.require_auth();

        let config = get_config(&env);

        if declared_price_usd <= 0 {
            panic!("declared_price_usd must be greater than zero");
        }

        if min_collateral_buffer_bps < config.min_buffer_bps
            || min_collateral_buffer_bps > config.max_buffer_bps
        {
            panic!("min_collateral_buffer_bps out of allowed range");
        }

        if liquidation_threshold_bps < config.min_liq_threshold_bps
            || liquidation_threshold_bps > config.max_liq_threshold_bps
        {
            panic!("liquidation_threshold_bps out of allowed range");
        }

        // Escrow the NFT from the lender into the contract.
        let nft_client = token::Client::new(&env, &nft_contract);
        nft_client.transfer(&lender, &env.current_contract_address(), &(token_id as i128));

        let listing_id = next_listing_id(&env);
        let listing = Listing {
            id: listing_id,
            lender: lender.clone(),
            nft_contract: nft_contract.clone(),
            token_id,
            declared_price_usd,
            interest_schedule_bps,
            max_duration_days,
            min_collateral_buffer_bps,
            liquidation_threshold_bps,
            status: ListingStatus::Open,
            created_at: env.ledger().timestamp(),
        };

        set_listing(&env, listing_id, &listing);

        events::emit_listing_created(
            &env,
            listing_id,
            lender,
            nft_contract,
            token_id,
            declared_price_usd,
        );

        listing_id
    /// Admin-only: approve a token as valid collateral, mapped to its Reflector asset symbol.
    ///
    /// - Requires `config.admin` auth; non-admin callers panic.
    /// - Returns early if the currency is already whitelisted with the same symbol.
    /// - Verifies `currency` is a real token contract by probing `decimals()`.
    /// - Records the currency → Reflector symbol mapping via `set_currency_symbol()`.
    ///   The currency then reads back as whitelisted through `is_currency_whitelisted()`.
    pub fn whitelist_currency(env: Env, currency: Address, reflector_asset: Symbol) {
        extend_instance_ttl(&env);

        let config = get_config(&env);
        config.admin.require_auth();

        if is_currency_whitelisted(&env, &currency)
            && get_currency_symbol(&env, &currency) == reflector_asset
        {
            return;
        }

        // Sanity-check that `currency` points at a real token contract.
        let _ = token::Client::new(&env, &currency).decimals();

        set_currency_symbol(&env, &currency, &reflector_asset);
    }

    pub fn cancel_listing(env: Env, listing_id: u64) {
        extend_instance_ttl(&env);
        let mut listing = get_listing(&env, listing_id);

        listing.lender.require_auth();

        if listing.status != ListingStatus::Open {
            panic!("Listing is not Open");
        }

        // Return NFT to lender
        let contract_address = env.current_contract_address();
        let nft_client = token::Client::new(&env, &listing.nft_contract);
        nft_client.transfer(
            &contract_address,
            &listing.lender,
            &(listing.token_id as i128),
        );

        listing.status = ListingStatus::Cancelled;
        set_listing(&env, listing_id, &listing);

        events::emit_listing_cancelled(&env, listing_id, listing.lender.clone());
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    pub fn borrow(
        env: Env,
        listing_id: u64,
        borrower: Address,
        collateral_currency: Address,
        collateral_amount: i128,
    ) -> u64 {
        extend_instance_ttl(&env);
        borrower.require_auth();

        let mut listing = get_listing(&env, listing_id);

        if listing.status != ListingStatus::Open {
            panic!("Listing is not Open");
        }

        if listing.max_duration_days == 0 {
            panic!("max_duration_days must be greater than zero");
        }

        if !is_currency_whitelisted(&env, &collateral_currency) {
            panic!("Collateral currency not whitelisted");
        }

        let config = get_config(&env);
        let oracle_price = oracle::get_price(&env, &config.oracle_address, &collateral_currency);

        // oracle_price is USD per unit of collateral (7 decimals)
        let collateral_value_usd = (collateral_amount * oracle_price) / 10_000_000;
        let collateral_client = token::Client::new(&env, &collateral_currency);
        let decimals = collateral_client.decimals();
        let divisor = 10_i128.pow(decimals);
        let collateral_value_usd = (collateral_amount * oracle_price) / divisor;

        let required_collateral =
            (listing.declared_price_usd * (listing.min_collateral_buffer_bps as i128)) / 10_000;

        if collateral_value_usd < required_collateral {
            panic!("Under-collateralized");
        }

        // Transfer collateral from borrower to contract
        let contract_address = env.current_contract_address();
        collateral_client.transfer(&borrower, &contract_address, &collateral_amount);

        // Transfer NFT from contract to borrower
        let nft_client = token::Client::new(&env, &listing.nft_contract);
        nft_client.transfer(&contract_address, &borrower, &(listing.token_id as i128));

        listing.status = ListingStatus::Filled;
        set_listing(&env, listing_id, &listing);

        let position_id = next_position_id(&env);
        let position = Position {
            id: position_id,
            listing_id,
            lender: listing.lender.clone(),
            borrower: borrower.clone(),
            nft_contract: listing.nft_contract.clone(),
            token_id: listing.token_id,
            declared_price_usd: listing.declared_price_usd,
            collateral_currency: collateral_currency.clone(),
            collateral_amount,
            interest_schedule_bps: listing.interest_schedule_bps.clone(),
            liquidation_threshold_bps: listing.liquidation_threshold_bps,
            start_time: env.ledger().timestamp(),
            max_duration_secs: (listing.max_duration_days as u64) * 86400,
            status: PositionStatus::Active,
        };

        set_position(&env, position_id, &position);

        events::emit_position_opened(&env, position_id, listing_id, borrower, collateral_amount);
        events::emit_position_opened(
            &env,
            position_id,
            listing_id,
            borrower.clone(),
            collateral_amount,
        );

        position_id
    }

    // ── Add Collateral ────────────────────────────────────────────────────────

    pub fn add_collateral(env: Env, position_id: u64, borrower: Address, amount: i128) {
        borrower.require_auth();

        let mut position = get_position(&env, position_id);

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        // Transfer additional collateral from borrower to contract
        let col_client = token::Client::new(&env, &position.collateral_currency);
        col_client.transfer(&borrower, &env.current_contract_address(), &amount);

        let new_total = position.collateral_amount + amount;
        position.collateral_amount = new_total;
        set_position(&env, position_id, &position);

        events::emit_collateral_added(&env, position_id, borrower, amount, new_total);
    }

    // ── Return NFT ────────────────────────────────────────────────────────────

    pub fn return_nft(env: Env, position_id: u64) {
    /// Borrower voluntarily closes their position before term expiry.
    ///
    /// - Requires borrower auth.
    /// - Panics if the position is not Active.
    /// - Panics if the loan term has already expired (use liquidate() instead).
    /// - Transfers the NFT: borrower → contract → lender.
    /// - Calls settle() with no liquidator; emits position_returned event.
    pub fn return_nft(env: Env, position_id: u64) {
        extend_instance_ttl(&env);
        let mut position = get_position(&env, position_id);

        position.borrower.require_auth();

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        let now = env.ledger().timestamp();
        if now > position.start_time + position.max_duration_secs {
            panic!("Position has expired; must be liquidated");
        }

        // Transfer NFT back from borrower to contract (then to lender implicitly via settle)
        let nft_client = token::Client::new(&env, &position.nft_contract);
        nft_client.transfer(
            &position.borrower,
            &env.current_contract_address(),
            &(position.token_id as i128),
        );

        // Return NFT to lender
        nft_client.transfer(
            &env.current_contract_address(),
        let deadline = position.start_time + position.max_duration_secs;
        if now > deadline {
            panic!("Loan term has expired; use liquidate()");
        }

        // Transfer NFT from borrower back to contract, then to lender.
        let contract_address = env.current_contract_address();
        let nft_client = token::Client::new(&env, &position.nft_contract);
        nft_client.transfer(
            &position.borrower,
            &contract_address,
            &(position.token_id as i128),
        );
        nft_client.transfer(
            &contract_address,
            &position.lender,
            &(position.token_id as i128),
        );

        let config = get_config(&env);
        let result = settle(&env, &position, None, &config);
        // Settle collateral waterfall (no liquidator on voluntary return).
        let config = get_config(&env);
        let result = settlement::settle(&env, &position, None, &config);

        position.status = PositionStatus::Returned;
        set_position(&env, position_id, &position);

        events::emit_position_returned(
            &env,
            position_id,
            result.accrued_interest_usd,
            result.platform_fee_usd,
            result.borrower_rem,
        );
    }

    // ── Liquidate ─────────────────────────────────────────────────────────────

    pub fn liquidate(env: Env, position_id: u64, liquidator: Address) {
        liquidator.require_auth();

    pub fn add_collateral(env: Env, position_id: u64, amount: i128) {
        let mut position = get_position(&env, position_id);
        position.borrower.require_auth();

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        if amount <= 0 {
            panic!("Amount must be greater than zero");
        }

        let contract_address = env.current_contract_address();
        let collateral_client = token::Client::new(&env, &position.collateral_currency);
        collateral_client.transfer(&position.borrower, &contract_address, &amount);
        position.collateral_amount += amount;
        set_position(&env, position_id, &position);

        events::emit_collateral_added(
            &env,
            position_id,
            position.borrower.clone(),
            amount,
            position.collateral_amount,
        );
    }

    pub fn liquidate(env: Env, position_id: u64, liquidator: Address) {
        liquidator.require_auth();
        let mut position = get_position(&env, position_id);

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        let config = get_config(&env);
        let now = env.ledger().timestamp();
        let oracle_price =
            oracle::get_price(&env, &config.oracle_address, &position.collateral_currency);

        // Check if position is expired
        let is_expired = now > position.start_time + position.max_duration_secs;

        // Check if position is under the liquidation threshold (unhealthy)
        if !is_expired {
            let collateral_value_usd = (position.collateral_amount * oracle_price) / 10_000_000;
            let accrued = accrued_interest_usd(&position, now);
            let owed = position.declared_price_usd + accrued;
            let liq_threshold = owed * (position.liquidation_threshold_bps as i128) / 10_000;

            if collateral_value_usd >= liq_threshold {
                panic!("Position is healthy; cannot liquidate");
            }
        }

        let result = settle(&env, &position, Some(liquidator.clone()), &config);

        position.status = if is_expired {
            PositionStatus::Expired
        } else {
            PositionStatus::Liquidated
        };
        let result = settlement::settle(&env, &position, Some(liquidator.clone()), &config);

        position.status = PositionStatus::Liquidated;
        set_position(&env, position_id, &position);

        events::emit_position_liquidated(
            &env,
            position_id,
            liquidator,
            result.lender_payout,
            result.liquidator_payout,
            result.borrower_rem,
        );
    }
}
