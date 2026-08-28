use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::oracle;
use crate::storage::{
    get_config, get_listing, is_currency_whitelisted, next_position_id, set_listing, set_position,
};
use crate::types::{ListingStatus, Position, PositionStatus};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
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
        let collateral_client = token::Client::new(&env, &collateral_currency);
        collateral_client.transfer(
            &borrower,
            &env.current_contract_address(),
            &collateral_amount,
        );

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

        #[allow(deprecated)]
        env.events()
            .publish((soroban_sdk::symbol_short!("borrow"), position_id), ());

        position_id
    }

    pub fn liquidate(env: Env, position_id: u64, liquidator: Option<Address>) {
        let mut position = crate::storage::get_position(&env, position_id);

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        let config = get_config(&env);
        let oracle_price = oracle::get_price(&env, &config.oracle_address, &position.collateral_currency);
        let collateral_value_usd = (position.collateral_amount * oracle_price) / 10_000_000;

        let current_time = env.ledger().timestamp();
        let is_expired = current_time >= position.start_time + position.max_duration_secs;

        let current_health_bps = if position.declared_price_usd > 0 {
            ((collateral_value_usd * 10_000) / position.declared_price_usd) as u32
        } else {
            0
        };

        let is_unhealthy = current_health_bps <= position.liquidation_threshold_bps;

        if !is_expired && !is_unhealthy {
            panic!("Position is neither expired nor unhealthy");
        }

        if is_expired {
            position.status = PositionStatus::Expired;
        } else {
            position.status = PositionStatus::Liquidated;
        }

        let collateral_client = token::Client::new(&env, &position.collateral_currency);

        let platform_fee = (position.collateral_amount * (config.platform_fee_bps as i128)) / 10_000;
        if platform_fee > 0 {
            collateral_client.transfer(
                &env.current_contract_address(),
                &config.fee_receiver,
                &platform_fee,
            );
        }

        let liquidator_payout = if let Some(ref l) = liquidator {
            let fee = (position.collateral_amount * (config.liquidator_fee_bps as i128)) / 10_000;
            if fee > 0 {
                collateral_client.transfer(&env.current_contract_address(), l, &fee);
            }
            fee
        } else {
            0
        };

        let remaining_collateral = position.collateral_amount - platform_fee - liquidator_payout;
        if remaining_collateral > 0 {
            collateral_client.transfer(
                &env.current_contract_address(),
                &position.lender,
                &remaining_collateral,
            );
        }

        // NFT stays with the borrower as required

        set_position(&env, position_id, &position);

        #[allow(deprecated)]
        env.events()
            .publish((soroban_sdk::symbol_short!("liquidat"), position_id), ());
    }

    pub fn admin_update_bounds(
        env: Env,
        min_buffer_bps: u32,
        max_buffer_bps: u32,
        min_liq_threshold_bps: u32,
        max_liq_threshold_bps: u32,
    ) {
        let mut config = get_config(&env);
        config.admin.require_auth();

        if min_buffer_bps > max_buffer_bps {
            panic!("Invalid buffer bounds: min > max");
        }
        if min_liq_threshold_bps > max_liq_threshold_bps {
            panic!("Invalid liquidation threshold bounds: min > max");
        }

        config.min_buffer_bps = min_buffer_bps;
        config.max_buffer_bps = max_buffer_bps;
        config.min_liq_threshold_bps = min_liq_threshold_bps;
        config.max_liq_threshold_bps = max_liq_threshold_bps;

        crate::storage::set_config(&env, &config);
    }

    pub fn admin_set_fees(env: Env, platform_fee_bps: u32, liquidator_fee_bps: u32) {
        let mut config = get_config(&env);
        config.admin.require_auth();

        if platform_fee_bps + liquidator_fee_bps > 10_000 {
            panic!("Total fees cannot exceed 10000 bps");
        }

        config.platform_fee_bps = platform_fee_bps;
        config.liquidator_fee_bps = liquidator_fee_bps;

        crate::storage::set_config(&env, &config);
    }

    pub fn return_nft(env: Env, position_id: u64) {
        let mut position = crate::storage::get_position(&env, position_id);

        position.borrower.require_auth();

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        let current_time = env.ledger().timestamp();
        if current_time >= position.start_time + position.max_duration_secs {
            panic!("Term has already expired");
        }

        let config = get_config(&env);

        // Transfer NFT from borrower back to lender
        let nft_client = token::Client::new(&env, &position.nft_contract);
        nft_client.transfer(
            &position.borrower,
            &position.lender,
            &(position.token_id as i128),
        );

        let collateral_client = token::Client::new(&env, &position.collateral_currency);

        let platform_fee = (position.collateral_amount * (config.platform_fee_bps as i128)) / 10_000;
        if platform_fee > 0 {
            collateral_client.transfer(
                &env.current_contract_address(),
                &config.fee_receiver,
                &platform_fee,
            );
        }

        let interest_bps = if !position.interest_schedule_bps.is_empty() {
            position.interest_schedule_bps.get(0).unwrap()
        } else {
            0
        };
        let interest_amount = (position.collateral_amount * (interest_bps as i128)) / 10_000;
        if interest_amount > 0 {
            collateral_client.transfer(
                &env.current_contract_address(),
                &position.lender,
                &interest_amount,
            );
        }

        let remaining_collateral = position.collateral_amount - platform_fee - interest_amount;
        if remaining_collateral > 0 {
            collateral_client.transfer(
                &env.current_contract_address(),
                &position.borrower,
                &remaining_collateral,
            );
        }

        position.status = PositionStatus::Returned;
        set_position(&env, position_id, &position);

        #[allow(deprecated)]
        env.events()
            .publish((soroban_sdk::symbol_short!("returned"), position_id), ());
    }
}
