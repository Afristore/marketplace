use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::events;
use crate::oracle;
use crate::settlement;
use crate::storage::{
    extend_instance_ttl, get_config, get_listing, get_position, has_config,
    is_currency_whitelisted, next_position_id, set_config, set_listing, set_position,
};
use crate::types::{ListingStatus, PlatformConfig, Position, PositionStatus};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
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
        // Assuming NFT uses the standard token interface for transfer
        nft_client.transfer(
            &contract_address,
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
        extend_instance_ttl(&env);
        borrower.require_auth();

        let mut listing = get_listing(&env, listing_id);

        if listing.status != ListingStatus::Open {
            panic!("Listing is not Open");
        }

        if !is_currency_whitelisted(&env, &collateral_currency) {
            panic!("Collateral currency not whitelisted");
        }

        let config = get_config(&env);
        let oracle_price = oracle::get_price(&env, &config.oracle_address, &collateral_currency);

        // oracle_price is likely USD per unit of collateral (7 decimals)
        // token_to_usd: collateral_amount * oracle_price / 10^decimals
        // For simplicity assuming both are 7 decimals
        let collateral_value_usd = (collateral_amount * oracle_price) / 10_000_000;

        let required_collateral =
            (listing.declared_price_usd * (listing.min_collateral_buffer_bps as i128)) / 10_000;

        if collateral_value_usd < required_collateral {
            panic!("Under-collateralized");
        }

        // Transfer collateral from borrower to contract
        let contract_address = env.current_contract_address();
        let collateral_client = token::Client::new(&env, &collateral_currency);
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

        #[allow(deprecated)]
        env.events()
            .publish((soroban_sdk::symbol_short!("borrow"), position_id), ());

        position_id
    }

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
}
