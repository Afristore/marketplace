use soroban_sdk::{
    contract, contractimpl, panic_with_error, token::Client as TokenClient, Address, Env,
};

use crate::{
    events::BorrowEvent,
    storage::{
        get_admin, get_borrow_token, get_collateral_token, is_initialized, is_paused,
        load_borrow_position, save_borrow_position, set_admin, set_borrow_token,
        set_collateral_token, set_initialized, set_paused, LEDGER_TTL_BUMP, LEDGER_TTL_THRESHOLD,
    },
    types::{BorrowPosition, LendingError},
};

#[contract]
pub struct LendingContract;

#[contractimpl]
impl LendingContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        collateral_token: Address,
        borrow_token: Address,
    ) {
        if is_initialized(&env) {
            panic_with_error!(&env, LendingError::AlreadyInitialized);
        }

        set_admin(&env, &admin);
        set_collateral_token(&env, &collateral_token);
        set_borrow_token(&env, &borrow_token);
        set_initialized(&env);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);
    }

    pub fn set_paused(env: Env, paused: bool) {
        let admin = get_admin(&env)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::NotInitialized));
        admin.require_auth();
        set_paused(&env, paused);
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn borrow(
        env: Env,
        borrower: Address,
        collateral_amount: i128,
        borrow_amount: i128,
    ) {
        if !is_initialized(&env) {
            panic_with_error!(&env, LendingError::NotInitialized);
        }

        if is_paused(&env) {
            panic_with_error!(&env, LendingError::ContractPaused);
        }

        borrower.require_auth();

        // Explicit security guard: collateral_amount must be strictly positive (> 0)
        // Must occur prior to token transfers or state updates.
        if collateral_amount <= 0 {
            panic_with_error!(&env, LendingError::InvalidCollateral);
        }

        if borrow_amount <= 0 {
            panic_with_error!(&env, LendingError::InvalidAmount);
        }

        let collateral_token_addr = get_collateral_token(&env)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::NotInitialized));
        let borrow_token_addr = get_borrow_token(&env)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::NotInitialized));

        let borrow_token_client = TokenClient::new(&env, &borrow_token_addr);
        let available_liquidity = borrow_token_client.balance(&env.current_contract_address());
        if available_liquidity < borrow_amount {
            panic_with_error!(&env, LendingError::InsufficientLiquidity);
        }

        let collateral_token_client = TokenClient::new(&env, &collateral_token_addr);

        // Transfer collateral from borrower to contract
        collateral_token_client.transfer(
            &borrower,
            &env.current_contract_address(),
            &collateral_amount,
        );

        // Transfer borrow token from contract to borrower
        borrow_token_client.transfer(
            &env.current_contract_address(),
            &borrower,
            &borrow_amount,
        );

        // State update
        let existing = load_borrow_position(&env, &borrower);
        let (new_collateral, new_borrow) = match existing {
            Some(pos) => (
                pos.collateral_amount + collateral_amount,
                pos.borrow_amount + borrow_amount,
            ),
            None => (collateral_amount, borrow_amount),
        };

        let position = BorrowPosition {
            borrower: borrower.clone(),
            collateral_amount: new_collateral,
            borrow_amount: new_borrow,
            timestamp: env.ledger().timestamp(),
        };

        save_borrow_position(&env, &position);

        env.storage()
            .instance()
            .extend_ttl(LEDGER_TTL_THRESHOLD, LEDGER_TTL_BUMP);

        BorrowEvent {
            borrower,
            collateral_amount,
            borrow_amount,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    pub fn settle(env: Env, borrower: Address, interest_rate_bps: u32) -> i128 {
        if !is_initialized(&env) {
            panic_with_error!(&env, LendingError::NotInitialized);
        }

        if is_paused(&env) {
            panic_with_error!(&env, LendingError::ContractPaused);
        }

        borrower.require_auth();

        let position = load_borrow_position(&env, &borrower)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::PositionNotFound));

        let now = env.ledger().timestamp();
        crate::settlement::settle_position(&env, now, &position, interest_rate_bps)
    }

    pub fn get_position(env: Env, borrower: Address) -> Option<BorrowPosition> {
        load_borrow_position(&env, &borrower)
    }

    pub fn get_collateral_token(env: Env) -> Address {
        get_collateral_token(&env)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::NotInitialized))
    }

    pub fn get_borrow_token(env: Env) -> Address {
        get_borrow_token(&env)
            .unwrap_or_else(|| panic_with_error!(&env, LendingError::NotInitialized))
    }
}
