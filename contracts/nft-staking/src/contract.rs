use soroban_sdk::{contract, contractimpl, panic_with_error, Address, Env, IntoVal};

use crate::events::*;
use crate::storage::*;
use crate::types::*;

#[contract]
pub struct NftStaking;

#[contractimpl]
impl NftStaking {
    /// One-shot initializer called by the Launchpad factory after clone deploy.
    /// Locks in the NFT collection, reward token, and emission rate for this pool.
    pub fn init(
        env: Env,
        admin: Address,
        nft_address: Address,
        reward_token: Address,
        reward_rate: i128,
    ) {
        if is_initialized(&env) {
            panic_with_error!(&env, StakingError::AlreadyInitialized);
        }
        if reward_rate <= 0 {
            panic_with_error!(&env, StakingError::InvalidDuration);
        }

        set_initialized(&env);
        env.storage().persistent().set(&DataKey::Admin, &admin);
        set_nft_address(&env, &nft_address);
        set_reward_token(&env, &reward_token);
        set_reward_config(
            &env,
            &RewardConfig {
                rewards_per_second: reward_rate,
            },
        );
    }

    pub fn set_admin(env: Env, admin: Address) {
        let key = DataKey::Admin;
        if env.storage().persistent().get::<_, Address>(&key).is_some() {
            panic_with_error!(&env, StakingError::Unauthorized);
        }
        admin.require_auth();
        env.storage().persistent().set(&key, &admin);
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<_, Address>(&DataKey::Admin)
    }

    pub fn get_nft_address(env: Env) -> Address {
        get_nft_address(&env)
            .unwrap_or_else(|| panic_with_error!(&env, StakingError::NotInitialized))
    }

    pub fn get_reward_token(env: Env) -> Address {
        get_reward_token(&env)
            .unwrap_or_else(|| panic_with_error!(&env, StakingError::NotInitialized))
    }

    pub fn get_reward_rate(env: Env) -> i128 {
        get_reward_config(&env)
            .map(|c| c.rewards_per_second)
            .unwrap_or_else(|| panic_with_error!(&env, StakingError::NotInitialized))
    }

    fn require_admin(env: &Env) {
        let admin = Self::get_admin(env.clone())
            .unwrap_or_else(|| panic_with_error!(env, StakingError::Unauthorized));
        admin.require_auth();
    }

    fn rewards_per_second(env: &Env) -> i128 {
        get_reward_config(env)
            .map(|c| c.rewards_per_second)
            .unwrap_or(0)
    }

    fn require_pool_nft(env: &Env, token_address: &Address) {
        let expected = get_nft_address(env)
            .unwrap_or_else(|| panic_with_error!(env, StakingError::NotInitialized));
        if *token_address != expected {
            panic_with_error!(env, StakingError::InvalidToken);
        }
    }

    pub fn set_paused(env: Env, paused: bool) {
        Self::require_admin(&env);
        env.storage().persistent().set(&DataKey::IsPaused, &paused);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::IsPaused)
            .unwrap_or(false)
    }

    pub fn stake(env: Env, user: Address, token_address: Address, token_id: u64) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, StakingError::ContractPaused);
        }
        user.require_auth();
        Self::require_pool_nft(&env, &token_address);

        let position_key = DataKey::StakedPosition(user.clone(), token_address.clone(), token_id);

        if load_staked_position(&env, &position_key).is_some() {
            panic_with_error!(&env, StakingError::AlreadyStaked);
        }

        env.invoke_contract::<()>(
            &token_address,
            &soroban_sdk::Symbol::new(&env, "transfer_from"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                user.clone().into_val(&env),
                env.current_contract_address().into_val(&env),
                (token_id as u64).into_val(&env),
            ],
        );

        let position = StakedPosition {
            owner: user.clone(),
            token_address: token_address.clone(),
            token_id,
            staked_at: env.ledger().timestamp(),
            rewards_earned: 0,
        };

        save_staked_position(&env, &position_key, &position);
        add_user_stake(
            &env,
            &user,
            DataKey::StakedPosition(user.clone(), token_address.clone(), token_id),
        );
        set_total_staked(&env, get_total_staked(&env) + 1);

        StakedEvent {
            user,
            token_address,
            token_id,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    pub fn unstake(env: Env, user: Address, token_address: Address, token_id: u64) {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, StakingError::ContractPaused);
        }
        user.require_auth();
        Self::require_pool_nft(&env, &token_address);

        let position_key = DataKey::StakedPosition(user.clone(), token_address.clone(), token_id);
        let mut position = load_staked_position(&env, &position_key)
            .unwrap_or_else(|| panic_with_error!(&env, StakingError::NotStaked));

        if position.owner != user {
            panic_with_error!(&env, StakingError::Unauthorized);
        }

        let rate = Self::rewards_per_second(&env);
        let elapsed = env.ledger().timestamp() - position.staked_at;
        let rewards = (elapsed as i128) * rate;
        position.rewards_earned += rewards;

        env.invoke_contract::<()>(
            &token_address,
            &soroban_sdk::Symbol::new(&env, "transfer_from"),
            soroban_sdk::vec![
                &env,
                env.current_contract_address().into_val(&env),
                env.current_contract_address().into_val(&env),
                user.clone().into_val(&env),
                (token_id as u64).into_val(&env),
            ],
        );

        remove_staked_position(&env, &position_key);
        remove_user_stake(&env, &user, &position_key);
        set_total_staked(&env, get_total_staked(&env).saturating_sub(1));

        UnstakedEvent {
            user,
            token_address,
            token_id,
            rewards_paid: position.rewards_earned,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    pub fn claim_rewards(env: Env, user: Address) -> i128 {
        if Self::is_paused(env.clone()) {
            panic_with_error!(&env, StakingError::ContractPaused);
        }
        user.require_auth();

        let rate = Self::rewards_per_second(&env);
        let stake_keys = get_user_stakes(&env, &user);
        let mut total_rewards: i128 = 0;

        for key in stake_keys.iter() {
            if let Some(mut position) = load_staked_position(&env, &key) {
                let elapsed = env.ledger().timestamp() - position.staked_at;
                let rewards = (elapsed as i128) * rate;
                position.rewards_earned += rewards;
                position.staked_at = env.ledger().timestamp();
                total_rewards += rewards;
                save_staked_position(&env, &key, &position);
            }
        }

        if total_rewards <= 0 {
            panic_with_error!(&env, StakingError::NoRewardsToClaim);
        }

        RewardsClaimedEvent {
            user,
            amount: total_rewards,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        total_rewards
    }

    pub fn get_staked_position(
        env: Env,
        user: Address,
        token_address: Address,
        token_id: u64,
    ) -> Option<StakedPosition> {
        let key = DataKey::StakedPosition(user, token_address, token_id);
        load_staked_position(&env, &key)
    }

    pub fn get_user_stakes(env: Env, user: Address) -> soroban_sdk::Vec<StakedPosition> {
        let keys = get_user_stakes(&env, &user);
        let mut positions = soroban_sdk::Vec::new(&env);
        for key in keys.iter() {
            if let Some(pos) = load_staked_position(&env, &key) {
                positions.push_back(pos);
            }
        }
        positions
    }

    pub fn total_staked(env: Env) -> u64 {
        get_total_staked(&env)
    }

    pub fn calculate_rewards(env: Env, user: Address) -> i128 {
        let rate = Self::rewards_per_second(&env);
        let stake_keys = get_user_stakes(&env, &user);
        let mut total: i128 = 0;
        for key in stake_keys.iter() {
            if let Some(position) = load_staked_position(&env, &key) {
                let elapsed = env.ledger().timestamp() - position.staked_at;
                total += (elapsed as i128) * rate + position.rewards_earned;
            }
        }
        total
    }
}
