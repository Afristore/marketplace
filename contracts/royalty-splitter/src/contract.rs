use soroban_sdk::{
    contract, contractimpl, panic_with_error, token::Client as TokenClient, Address, Env, Vec,
};

use crate::{
    storage::{
        is_initialized, load_beneficiaries, load_shares, load_token, save_beneficiaries,
        save_shares, save_token, set_initialized, MAX_BENEFICIARIES,
    },
    types::SplitterError,
};

#[contract]
pub struct RoyaltySplitter;

#[contractimpl]
impl RoyaltySplitter {
    /// Lock in the token, beneficiaries, and BPS shares forever.
    /// Shares must sum to exactly 10 000. Can only be called once.
    pub fn initialize(env: Env, token: Address, beneficiaries: Vec<Address>, shares: Vec<u32>) {
        if is_initialized(&env) {
            panic_with_error!(&env, SplitterError::AlreadyInitialized);
        }
        if beneficiaries.len() == 0 {
            panic_with_error!(&env, SplitterError::NoBeneficiaries);
        }
        if beneficiaries.len() > MAX_BENEFICIARIES {
            panic_with_error!(&env, SplitterError::TooManyBeneficiaries);
        }
        if beneficiaries.len() != shares.len() {
            panic_with_error!(&env, SplitterError::LengthMismatch);
        }

        let mut total: u32 = 0;
        for i in 0..shares.len() {
            total += shares.get(i).unwrap();
        }
        if total != 10_000 {
            panic_with_error!(&env, SplitterError::InvalidShares);
        }

        save_token(&env, &token);
        save_beneficiaries(&env, &beneficiaries);
        save_shares(&env, &shares);
        set_initialized(&env);
    }

    /// Drain the contract's full token balance to all beneficiaries
    /// proportionally. Callable by anyone; no auth required.
    /// The caller receives any rounding remainder (dust) as a gas incentive.
    pub fn distribute(env: Env, token_address: Address, caller: Address) {
        if !is_initialized(&env) {
            panic_with_error!(&env, SplitterError::NotInitialized);
        }

        let token_client = TokenClient::new(&env, &token_address);
        let contract_addr = env.current_contract_address();

        let balance = token_client.balance(&contract_addr);
        if balance <= 0 {
            return;
        }

        let beneficiaries = load_beneficiaries(&env);
        let shares = load_shares(&env);
        let len = beneficiaries.len();

        let mut distributed: i128 = 0;
        for i in 0..len {
            let share = shares.get(i).unwrap() as i128;
            let amount = balance * share / 10_000;
            if amount > 0 {
                token_client.transfer(&contract_addr, &beneficiaries.get(i).unwrap(), &amount);
                distributed += amount;
            }
        }

        let remainder = balance - distributed;
        if remainder > 0 {
            token_client.transfer(&contract_addr, &caller, &remainder);
        }
    }

    pub fn get_token(env: Env) -> Address {
        load_token(&env)
    }

    pub fn get_beneficiaries(env: Env) -> Vec<Address> {
        load_beneficiaries(&env)
    }

    pub fn get_shares(env: Env) -> Vec<u32> {
        load_shares(&env)
    }
}
