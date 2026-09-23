use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, IntoVal, Symbol, Vec};

use crate::events;
use crate::settlement;
use crate::storage::{
    get_config, get_position, increment_listing_count, load_listing, save_listing, set_position,
};
use crate::types::{InterestTier, LendingError, LendingListing, ListingStatus, PositionStatus};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    pub fn create_listing(
        env: Env,
        lender: Address,
        collection: Address,
        token_id: u64,
        price: i128,
        currency: Symbol,
        min_duration: u64,
        max_duration: u64,
        interest_schedule: Vec<InterestTier>,
    ) -> u64 {
        lender.require_auth();

        if price <= 0 {
            panic_with_error!(&env, LendingError::InvalidPrice);
        }

        if interest_schedule.is_empty() {
            panic_with_error!(&env, LendingError::EmptyInterestSchedule);
        }

        if min_duration == 0 || max_duration < min_duration {
            panic_with_error!(&env, LendingError::InvalidBounds);
        }

        for tier in interest_schedule.iter() {
            if tier.duration < min_duration
                || tier.duration > max_duration
                || tier.interest_bps > 10000
            {
                panic_with_error!(&env, LendingError::InvalidBounds);
            }
        }

        // Transfer NFT from lender to contract for escrow
        env.invoke_contract::<()>(
            &collection,
            &soroban_sdk::Symbol::new(&env, "transfer_from"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                lender.clone().into_val(&env),
                env.current_contract_address().into_val(&env),
                token_id.into_val(&env),
                1u64.into_val(&env),
            ],
        );

        let listing_id = increment_listing_count(&env);
        let listing = LendingListing {
            listing_id,
            lender,
            collection,
            token_id,
            price,
            currency,
            min_duration,
            max_duration,
            interest_schedule,
            status: ListingStatus::Open,
            created_at: env.ledger().sequence(),
        };

        save_listing(&env, &listing);
        listing_id
    }

    /// Borrower tops up collateral on an active position to improve its health factor.
    ///
    /// - Requires borrower auth.
    /// - Panics if the position is not Active.
    /// - Panics if the top-up amount is not positive.
    /// - Transfers the extra collateral tokens from borrower to the contract.
    /// - Increments `position.collateral_amount`; emits the `collateral_added` event.
    pub fn add_collateral(env: Env, position_id: u64, amount: i128) {
        let mut position = get_position(&env, position_id);

        position.borrower.require_auth();

        if position.status != PositionStatus::Active {
            panic!("Position is not Active");
        }

        if amount <= 0 {
            panic!("Collateral top-up amount must be positive");
        }

        // Transfer additional collateral from borrower to contract.
        env.invoke_contract::<()>(
            &position.collateral_currency,
            &Symbol::new(&env, "transfer"),
            soroban_sdk::vec![
                &env,
                position.borrower.clone().into_val(&env),
                env.current_contract_address().into_val(&env),
                amount.into_val(&env),
            ],
        );

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

    /// Borrower voluntarily closes their position before term expiry.
    ///
    /// - Requires borrower auth.
    /// - Panics if the position is not Active.
    /// - Panics if the loan term has already expired (use liquidate() instead).
    /// - Transfers the NFT: borrower → contract → lender.
    /// - Calls settle() with no liquidator; emits position_returned event.
    pub fn return_nft(env: Env, position_id: u64) {
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
        env.invoke_contract::<()>(
            &position.nft_contract,
            &Symbol::new(&env, "transfer"),
            soroban_sdk::vec![
                &env,
                position.borrower.clone().into_val(&env),
                env.current_contract_address().into_val(&env),
                (position.token_id as i128).into_val(&env),
            ],
        );
        env.invoke_contract::<()>(
            &position.nft_contract,
            &Symbol::new(&env, "transfer"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                position.lender.clone().into_val(&env),
                (position.token_id as i128).into_val(&env),
            ],
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

    pub fn get_listing(env: Env, listing_id: u64) -> Option<LendingListing> {
        load_listing(&env, listing_id)
    }
}
