use soroban_sdk::{contract, contractimpl, token, Address, Env, Symbol};

use crate::interest::accrued_interest_usd;
use crate::oracle;
use crate::settlement::settle;
use crate::storage::{
    get_config, get_listing, get_position, is_currency_whitelisted, next_position_id, set_listing,
    set_position,
    extend_instance_ttl, get_config, get_currency_symbol, get_listing, get_position,
    is_currency_whitelisted, next_position_id, set_currency_symbol, set_listing, set_position,
};
use crate::types::{ListingStatus, Position, PositionStatus};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
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
        let mut listing = get_listing(&env, listing_id);

        listing.lender.require_auth();

        if listing.status != ListingStatus::Open {
            panic!("Listing is not Open");
        }

        // Return NFT to lender
        let nft_client = token::Client::new(&env, &listing.nft_contract);
        // Assuming NFT uses the standard token interface for transfer
        nft_client.transfer(
            &env.current_contract_address(),
            &listing.lender,
            &(listing.token_id as i128),
        );

        listing.status = ListingStatus::Cancelled;
        set_listing(&env, listing_id, &listing);

        #[allow(deprecated)]
        // Emitting event (dummy implementation since event spec is not fully provided)
        env.events()
            .publish((soroban_sdk::symbol_short!("cancel"), listing_id), ());
    }

    pub fn borrow(
        env: Env,
        listing_id: u64,
        borrower: Address,
        collateral_currency: Address,
        collateral_amount: i128,
    ) -> u64 {
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
        let collateral_client = token::Client::new(&env, &collateral_currency);
        collateral_client.transfer(
            &borrower,
            &env.current_contract_address(),
            &collateral_amount,
        );
        let contract_address = env.current_contract_address();
        collateral_client.transfer(&borrower, &contract_address, &collateral_amount);

        // Transfer NFT from contract to borrower
        let nft_client = token::Client::new(&env, &listing.nft_contract);
        nft_client.transfer(
            &env.current_contract_address(),
            &borrower,
            &(listing.token_id as i128),
        );

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

        events::emit_position_opened(
            &env,
            position_id,
            listing_id,
            borrower.clone(),
            collateral_amount,
        );

        position_id
    }

    // ── Liquidate ─────────────────────────────────────────────────────────────

    /// Permissionless settlement for unhealthy or expired positions.
    ///
    /// # Liquidator address design
    ///
    /// The liquidator is passed explicitly as a function argument and must
    /// `require_auth()` before the call proceeds.  This is intentional:
    ///
    /// - Soroban's host does not expose an `env.invoker()` equivalent in the
    ///   public API — the canonical way to identify the caller is via an
    ///   authenticated address argument.
    /// - Requiring auth on the liquidator prevents griefing attacks where a
    ///   third party front-runs and redirects the liquidator bounty to an
    ///   arbitrary address.
    /// - The function remains *permissionless* in the sense that **any**
    ///   address can call it when the position is eligible; the auth merely
    ///   confirms that the liquidator themselves authorised the call.
    ///
    /// # Eligibility conditions (either triggers liquidation)
    ///
    /// 1. **Term expired** — `now > position.start_time + position.max_duration_secs`
    /// 2. **Unhealthy**    — `health_factor_bps <= position.liquidation_threshold_bps`
    ///    where `health_factor_bps = collateral_value_usd * 10_000 / owed_usd`
    ///
    /// Healthy positions within their term cause a panic.
    ///
    /// # NFT
    ///
    /// The NFT is **never touched** by this function.  It remains wherever the
    /// borrower holds it; the lender's compensation comes from the collateral
    /// waterfall, not an NFT transfer.
    pub fn liquidate(env: Env, position_id: u64, liquidator: Address) {
        // The liquidator explicitly authenticates so the bounty cannot be
        // redirected by a front-runner.
        liquidator.require_auth();

        let mut position = get_position(&env, position_id);

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        let now = env.ledger().timestamp();
        let config = get_config(&env);

        // ── Eligibility check ─────────────────────────────────────────────────
        let is_expired = now > position.start_time + position.max_duration_secs;

        let is_unhealthy = if !is_expired {
            // Collateral value in USD (7-decimal fixed-point, oracle price also 7-dec)
            let oracle_price =
                oracle::get_price(&env, &config.oracle_address, &position.collateral_currency);

            let collateral_value_usd = (position.collateral_amount * oracle_price) / 10_000_000;

            // Owed = declared price + interest accrued so far under the
            // month-based schedule (interest::accrued_interest_usd).
            let accrued = accrued_interest_usd(&position, now);
            let owed_usd = position.declared_price_usd + accrued;

            // Health factor expressed in bps (10 000 = 100 %).
            // Guard against division-by-zero if declared_price is somehow 0.
            let health_factor_bps = if owed_usd > 0 {
                collateral_value_usd * 10_000 / owed_usd
            } else {
                10_000 // treat as perfectly healthy if nothing is owed
            };

            health_factor_bps <= (position.liquidation_threshold_bps as i128)
        } else {
            false
        };

        if !is_expired && !is_unhealthy {
            panic!("Position is healthy; cannot liquidate");
        }

        // ── Settlement ────────────────────────────────────────────────────────
        // settle() handles the full collateral waterfall (lender payout,
        // platform fee, liquidator bounty, borrower remainder).  The NFT is
        // NOT touched here — it stays with the borrower as per spec.
        let result = settle(&env, &position, Some(liquidator.clone()), &config);

        // Mark Expired for time-triggered liquidations, Liquidated for
        // health-triggered ones, matching common DeFi convention.
        position.status = if is_expired {
            PositionStatus::Expired
        } else {
            PositionStatus::Liquidated
        };
        set_position(&env, position_id, &position);

        #[allow(deprecated)]
        env.events().publish(
            (soroban_sdk::symbol_short!("liquidate"), position_id),
            (
                liquidator,
                result.lender_payout,
                result.liquidator_payout,
                result.borrower_rem,
            ),
        );
    }

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
