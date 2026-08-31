use soroban_sdk::{
    contract, contractimpl, panic_with_error, Address, Env, IntoVal, Symbol, Vec,
};

use crate::storage::{increment_listing_count, load_listing, save_listing};
use crate::types::{InterestTier, LendingError, LendingListing, ListingStatus};

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

    pub fn get_listing(env: Env, listing_id: u64) -> Option<LendingListing> {
        load_listing(&env, listing_id)
    }
}
