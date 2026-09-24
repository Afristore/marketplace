#![cfg(test)]

//tests

extern crate std;

mod mock_nft {
    use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

    #[contracttype]
    enum DataKey {
        Owner(u64),
    }

    #[contract]
    pub struct MockNft;

    #[contractimpl]
    impl MockNft {
        pub fn mint(env: Env, to: Address, token_id: u64) {
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
        }

        pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
            let owner: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Owner(token_id))
                .expect("token not minted");
            if owner != from {
                panic!("not owner");
            }
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
        }

        pub fn transfer_from(
            env: Env,
            _spender: Address,
            from: Address,
            to: Address,
            token_id: u64,
        ) {
            let owner: Address = env
                .storage()
                .persistent()
                .get(&DataKey::Owner(token_id))
                .expect("token not minted");
            if owner != from {
                panic!("not owner");
            }
            env.storage()
                .persistent()
                .set(&DataKey::Owner(token_id), &to);
        }

        pub fn owner_of(env: Env, token_id: u64) -> Address {
            env.storage()
                .persistent()
                .get(&DataKey::Owner(token_id))
                .expect("token not minted")
        }
    }
}

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, IntoVal, Symbol,
};

use crate::contract::NftStakingClient;
use crate::StakingError;

fn setup() -> (Env, NftStakingClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let nft = Address::generate(&env);
    let reward_token = Address::generate(&env);

    let staking_id = env.register_contract(None, crate::NftStaking);
    let staking = NftStakingClient::new(&env, &staking_id);

    staking.init(&admin, &nft, &reward_token, &1_000_000i128);

    (env, staking, admin, user1, user2)
}

fn setup_with_mock() -> (Env, NftStakingClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let collection = env.register_contract(None, mock_nft::MockNft);
    let reward_token = Address::generate(&env);

    let staking_id = env.register_contract(None, crate::NftStaking);
    let staking = NftStakingClient::new(&env, &staking_id);

    staking.init(&admin, &collection, &reward_token, &1_000_000i128);

    (env, staking, user, collection, admin)
}

fn mint_token(env: &Env, collection: &Address, to: &Address, token_id: u64) {
    env.invoke_contract::<()>(
        collection,
        &soroban_sdk::Symbol::new(env, "mint"),
        soroban_sdk::vec![env, to.clone().into_val(env), token_id.into_val(env),],
    );
}

/// Emission rate used by the claim-rewards setup below: reward-token units paid
/// out per second staked, per NFT position.
const REWARD_RATE: i128 = 1_000_000;

/// Setup variant for exercising `claim_rewards`, which actually moves reward
/// tokens. Unlike `setup_with_mock`, the reward token is a real Stellar Asset
/// Contract (so `balance`/`transfer` work) and the staking contract is pre-funded
/// so payouts don't hit `InsufficientRewardBalance`. Returns the reward-token
/// client so tests can assert on-chain balances directly.
fn setup_for_claim() -> (
    Env,
    NftStakingClient<'static>,
    Address,              // user
    Address,              // NFT collection (MockNft)
    TokenClient<'static>, // reward token
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let collection = env.register_contract(None, mock_nft::MockNft);

    // Real SAC reward token so the staking contract can hold and transfer a balance.
    let reward_token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();

    let staking_id = env.register_contract(None, crate::NftStaking);
    let staking = NftStakingClient::new(&env, &staking_id);

    staking.init(&admin, &collection, &reward_token, &REWARD_RATE);

    // Fund the staking contract generously so reward transfers succeed.
    StellarAssetClient::new(&env, &reward_token).mint(&staking_id, &1_000_000_000_000_i128);

    let reward_client = TokenClient::new(&env, &reward_token);

    (env, staking, user, collection, reward_client)
}

#[test]
fn test_stake_and_get_position() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);
    let pos = staking.get_staked_position(&user, &collection, &0);
    assert!(pos.is_some());
    let p = pos.unwrap();
    assert_eq!(p.owner, user);
    assert_eq!(p.token_id, 0);
}

#[test]
fn test_pause_unpause() {
    let (_env, staking, _user, _collection, admin) = setup_with_mock();

    assert!(!staking.is_paused());
    staking.set_paused(&true);
    assert!(staking.is_paused());
    staking.set_paused(&false);
    assert!(!staking.is_paused());
}

#[test]
fn test_total_staked() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    mint_token(&env, &collection, &user, 1);

    assert_eq!(staking.total_staked(), 0);
    staking.stake(&user, &collection, &0);
    assert_eq!(staking.total_staked(), 1);
    staking.stake(&user, &collection, &1);
    assert_eq!(staking.total_staked(), 2);
}

#[test]
fn test_multiple_stakes_per_user() {
    let (env, staking, user, collection1, _admin) = setup_with_mock();

    mint_token(&env, &collection1, &user, 0);
    mint_token(&env, &collection1, &user, 1);
    staking.stake(&user, &collection1, &0);
    staking.stake(&user, &collection1, &1);

    let stakes = staking.get_user_stakes(&user);
    assert_eq!(stakes.len(), 2);
}

#[test]
fn test_calculate_rewards() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);

    env.ledger().set(LedgerInfo {
        timestamp: 1000,
        protocol_version: 25,
        sequence_number: 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_persistent_entry_ttl: 200_000,
        min_temp_entry_ttl: 200_000,
        max_entry_ttl: 500_000,
    });

    staking.stake(&user, &collection, &0);

    env.ledger().set(LedgerInfo {
        timestamp: 3000,
        protocol_version: 25,
        sequence_number: 2,
        network_id: Default::default(),
        base_reserve: 10,
        min_persistent_entry_ttl: 200_000,
        min_temp_entry_ttl: 200_000,
        max_entry_ttl: 500_000,
    });

    let rewards = staking.calculate_rewards(&user);
    assert!(rewards > 0);
}

#[test]
fn test_get_user_stakes_empty() {
    let (_env, staking, user, _collection, _admin) = setup_with_mock();

    let positions = staking.get_user_stakes(&user);
    assert_eq!(positions.len(), 0);
}

#[test]
fn test_unstake_returns_nft() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);
    staking.unstake(&user, &collection, &0);

    let pos = staking.get_staked_position(&user, &collection, &0);
    assert!(pos.is_none());
}

#[test]
fn test_stake_fails_when_not_owner() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    let non_owner = Address::generate(&env);

    // Mint token 0 to user (the legitimate owner)
    mint_token(&env, &collection, &user, 0);

    // Non-owner attempts to stake token 0 — should panic via transfer ownership check
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        staking.stake(&non_owner, &collection, &0);
    }));
    assert!(result.is_err(), "non-owner staking must panic");

    // Verify no staking record was created for non-owner
    let pos = staking.get_staked_position(&non_owner, &collection, &0);
    assert!(pos.is_none());

    // Verify total staked count remains unchanged
    assert_eq!(staking.total_staked(), 0);

    // Verify token ownership unchanged (still owned by user)
    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, user, "token should still belong to original owner");
}

// ── claim_rewards: proportional reward calculation (issue #554) ──────────────

/// Primary case: rewards are linear in time staked × rate.
///
/// The contract's formula (contract.rs:333-377) is:
///   claimable = rewards_earned + (now - staked_at) * rewards_per_second
/// with no integer division, so the payout is an exact product. We stake at a
/// known timestamp, advance the ledger by a known duration, then assert the
/// returned amount, the emitted return value, and the on-chain token movement
/// all equal `elapsed * REWARD_RATE` exactly.
#[test]
fn test_claim_rewards_proportional_to_time_and_rate() {
    let (env, staking, user, collection, reward_token) = setup_for_claim();

    // Stake at t = 1000.
    env.ledger().set_timestamp(1000);
    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);

    // Advance 500 seconds: elapsed = 1500 - 1000 = 500.
    env.ledger().set_timestamp(1500);

    let elapsed: i128 = 500;
    let expected = elapsed * REWARD_RATE; // 500 * 1_000_000 = 500_000_000

    let paid = staking.claim_rewards(&user);
    assert_eq!(
        paid, expected,
        "claim must equal elapsed_seconds * reward_rate exactly"
    );
    // The tokens actually left the contract and reached the user.
    assert_eq!(
        reward_token.balance(&user),
        expected,
        "user's reward-token balance must match the exact computed payout"
    );

    // The clock reset on claim: an immediate re-claim has zero new accrual and
    // therefore reverts with NoRewardsToClaim rather than paying anything again.
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        staking.claim_rewards(&user);
    }));
    assert!(
        again.is_err(),
        "re-claiming with no elapsed time must revert (clock was reset)"
    );
}

/// Partial-period / multi-claim: claiming resets `staked_at`, so a second claim
/// after more time reflects ONLY the newly-elapsed window — no double-counting of
/// the already-claimed period — and the two claims sum to the full-duration reward.
#[test]
fn test_claim_rewards_multiple_sequential_claims_no_double_count() {
    let (env, staking, user, collection, reward_token) = setup_for_claim();

    // Stake at t = 1000.
    env.ledger().set_timestamp(1000);
    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);

    // First claim after 300s: elapsed = 300.
    env.ledger().set_timestamp(1300);
    let first_expected = 300i128 * REWARD_RATE;
    let first = staking.claim_rewards(&user);
    assert_eq!(
        first, first_expected,
        "first claim covers the first 300s only"
    );

    // Second claim after a further 700s: elapsed measured from the reset baseline
    // (1300), so only 700s counts — NOT 1000s from the original stake.
    env.ledger().set_timestamp(2000);
    let second_expected = 700i128 * REWARD_RATE;
    let second = staking.claim_rewards(&user);
    assert_eq!(
        second, second_expected,
        "second claim reflects only the newly-elapsed 700s, no double-count"
    );

    // The two claims summed equal the reward for the full 1000s window: no accrual
    // was lost or duplicated across the claim boundary.
    let total_expected = 1000i128 * REWARD_RATE;
    assert_eq!(
        first + second,
        total_expected,
        "sum of sequential claims must equal the full-duration reward"
    );
    assert_eq!(
        reward_token.balance(&user),
        total_expected,
        "user's total received tokens must equal the full-duration reward"
    );
}

/// Zero-duration edge case: claiming immediately after staking accrues nothing.
///
/// FINDING NOTE: the contract does NOT pay zero here — it takes the
/// `total_rewards <= 0` branch (contract.rs:356) and reverts with
/// `NoRewardsToClaim`. This is an intentional, named revert (no underflow: the
/// `now - staked_at` subtraction is 0, not negative), so we assert the panic
/// rather than a zero payout.
#[test]
fn test_claim_rewards_zero_duration_reverts() {
    let (env, staking, user, collection, reward_token) = setup_for_claim();

    env.ledger().set_timestamp(1000);
    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);

    // No time advance: elapsed = 0, rewards_earned = 0 -> total = 0 -> revert.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        staking.claim_rewards(&user);
    }));
    assert!(
        result.is_err(),
        "claiming with zero elapsed time must revert with NoRewardsToClaim"
    );

    // Nothing was paid out.
    assert_eq!(
        reward_token.balance(&user),
        0,
        "no reward tokens should move on a zero-duration claim"
    );
}

// Issue #553 (literal ask): unstaking an NFT the caller never staked must fail
// with the typed `NotStaked` error — not a generic panic — and must not mutate
// any state as a side effect. The position lookup is keyed by the caller's own
// address (DataKey::StakedPosition(user, token, id)), so "never staked" is the
// canonical path through the `NotStaked` guard in `unstake_erc721`.
#[test]
fn test_unstake_fails_when_not_staked() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    // Mint the token to the user but deliberately never stake it.
    mint_token(&env, &collection, &user, 0);

    // Sanity: precondition state is empty before the failing call.
    assert!(
        staking
            .get_staked_position(&user, &collection, &0)
            .is_none(),
        "no position should exist before staking"
    );
    assert_eq!(staking.total_staked(), 0);

    // The call must revert with the typed `NotStaked` error, asserted exactly
    // via the generated `try_` client method (repo-wide convention).
    let err = staking
        .try_unstake(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::NotStaked.into());

    // No storage mutation must have occurred: no stray position, unchanged
    // total, and the NFT still owned by the user (never moved to the pool).
    assert!(
        staking
            .get_staked_position(&user, &collection, &0)
            .is_none(),
        "failed unstake must not create a staking record"
    );
    assert_eq!(
        staking.total_staked(),
        0,
        "failed unstake must not change total staked"
    );
    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, user, "token ownership must be unchanged");
}

// Adjacent gap found during #553 work (not the issue's literal scope): unstaking
// an NFT that *is* staked, but by a *different* user, must also fail with
// `NotStaked` for the caller. Because positions are keyed by caller address, the
// victim's position lives under a different key and is invisible to the attacker
// — so this correctly collapses to the same `NotStaked` guard. This test proves
// a caller cannot unstake (and thereby steal) another user's staked NFT, and
// that the victim's position and the NFT custody are left intact.
#[test]
fn test_unstake_fails_when_staked_by_different_user() {
    let (env, staking, victim, collection, _admin) = setup_with_mock();
    let attacker = Address::generate(&env);

    // Victim legitimately stakes token 0.
    mint_token(&env, &collection, &victim, 0);
    staking.stake(&victim, &collection, &0);
    assert!(staking
        .get_staked_position(&victim, &collection, &0)
        .is_some());
    assert_eq!(staking.total_staked(), 1);

    // Attacker (who has staked nothing) tries to unstake the victim's token.
    let err = staking
        .try_unstake(&attacker, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::NotStaked.into());

    // The victim's position must be untouched and the pool must still custody
    // the NFT — the attacker must not have been able to divert it.
    assert!(
        staking
            .get_staked_position(&victim, &collection, &0)
            .is_some(),
        "victim's staking record must remain intact"
    );
    assert_eq!(
        staking.total_staked(),
        1,
        "failed unstake by non-staker must not change total staked"
    );
    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(
        owner, staking.address,
        "NFT must remain in the staking pool's custody"
    );
}

// ── Issue #829: is_paused ────────────────────────────────────────────────────

/// Default state: a freshly initialized pool is not paused.
#[test]
fn test_is_paused_defaults_to_false() {
    let (_env, staking, _user, _collection, _admin) = setup_with_mock();
    assert!(!staking.is_paused());
}

/// `is_paused` reflects `set_paused` toggles exactly.
#[test]
fn test_is_paused_reflects_set_paused() {
    let (_env, staking, _user, _collection, _admin) = setup_with_mock();

    staking.set_paused(&true);
    assert!(staking.is_paused());

    staking.set_paused(&false);
    assert!(!staking.is_paused());
}

/// When paused, stake and unstake entrypoints are gated by `ContractPaused`
/// and pre-existing state is left untouched.
#[test]
fn test_is_paused_blocks_stake_and_unstake() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake(&user, &collection, &0);

    staking.set_paused(&true);
    assert!(staking.is_paused());

    // New stakes are rejected while paused.
    mint_token(&env, &collection, &user, 1);
    let stake_err = staking
        .try_stake_erc721(&user, &collection, &1)
        .unwrap_err()
        .unwrap();
    assert_eq!(stake_err, StakingError::ContractPaused.into());

    // Unstaking the existing position is also rejected while paused.
    let unstake_err = staking
        .try_unstake_erc721(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(unstake_err, StakingError::ContractPaused.into());

    // State untouched by the rejected calls.
    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_some());
    assert_eq!(staking.total_staked(), 1);

    // Unpausing restores normal operation.
    staking.set_paused(&false);
    assert!(!staking.is_paused());
    staking.unstake_erc721(&user, &collection, &0);
    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_none());
}

// ── Issue #832: unstake_erc721 ───────────────────────────────────────────────

/// Happy path: direct `unstake_erc721` returns the NFT and clears all state.
#[test]
fn test_unstake_erc721_happy_path_returns_nft_and_clears_state() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);
    assert_eq!(staking.total_staked(), 1);

    staking.unstake_erc721(&user, &collection, &0);

    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_none());
    assert_eq!(staking.total_staked(), 0);
    assert_eq!(staking.get_user_stakes(&user).len(), 0);

    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, user);
}

/// Rewards path: `unstake_erc721` pays `elapsed * rate` before wiping the position.
#[test]
fn test_unstake_erc721_pays_accrued_rewards() {
    let (env, staking, user, collection, reward_token) = setup_for_claim();

    env.ledger().set_timestamp(1000);
    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);

    env.ledger().set_timestamp(1500);
    staking.unstake_erc721(&user, &collection, &0);

    let expected = 500i128 * REWARD_RATE;
    assert_eq!(reward_token.balance(&user), expected);
    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_none());
    assert_eq!(staking.total_staked(), 0);

    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, user);
}

/// Direct `unstake_erc721` on a never-staked token reverts with `NotStaked`.
#[test]
fn test_unstake_erc721_fails_when_not_staked() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);

    let err = staking
        .try_unstake_erc721(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::NotStaked.into());
    assert_eq!(staking.total_staked(), 0);

    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, user);
}

/// Paused pool: `unstake_erc721` reverts with `ContractPaused` and keeps state.
#[test]
fn test_unstake_erc721_fails_when_paused() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);

    staking.set_paused(&true);
    let err = staking
        .try_unstake_erc721(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::ContractPaused.into());

    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_some());
    assert_eq!(staking.total_staked(), 1);
    let owner: Address = env.invoke_contract(
        &collection,
        &Symbol::new(&env, "owner_of"),
        soroban_sdk::vec![&env, 0u64.into_val(&env)],
    );
    assert_eq!(owner, staking.address);
}

/// Wrong collection: `unstake_erc721` reverts with `InvalidToken`.
#[test]
fn test_unstake_erc721_fails_with_wrong_token() {
    let (env, staking, user, collection, _admin) = setup_with_mock();
    let wrong_token = Address::generate(&env);

    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);

    let err = staking
        .try_unstake_erc721(&user, &wrong_token, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::InvalidToken.into());

    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_some());
    assert_eq!(staking.total_staked(), 1);
}

/// Underfunded rewards: `unstake_erc721` reverts with `InsufficientRewardBalance`.
#[test]
fn test_unstake_erc721_fails_when_insufficient_reward_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let collection = env.register_contract(None, mock_nft::MockNft);
    let reward_token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();

    let staking_id = env.register_contract(None, crate::NftStaking);
    let staking = NftStakingClient::new(&env, &staking_id);
    staking.init(&admin, &collection, &reward_token, &REWARD_RATE);

    // Fund with a dust amount so the accrued payout cannot be covered.
    StellarAssetClient::new(&env, &reward_token).mint(&staking_id, &1_000_i128);

    env.ledger().set_timestamp(1000);
    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);

    env.ledger().set_timestamp(1500);
    let err = staking
        .try_unstake_erc721(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::InsufficientRewardBalance.into());

    // Failed unstake must not wipe the position.
    assert!(staking
        .get_staked_position(&user, &collection, &0)
        .is_some());
    assert_eq!(staking.total_staked(), 1);
}

/// Second unstake of the same token reverts with `NotStaked`.
#[test]
fn test_unstake_erc721_double_unstake_fails() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

    mint_token(&env, &collection, &user, 0);
    staking.stake_erc721(&user, &collection, &0);
    staking.unstake_erc721(&user, &collection, &0);

    let err = staking
        .try_unstake_erc721(&user, &collection, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::NotStaked.into());
    assert_eq!(staking.total_staked(), 0);
}

// ── Shared helpers for issues #822–#825 (init / admin / nft address) ─────────

const MAX_REWARD_RATE: i128 = 1_000_000_000_000_000;

/// Registers a staking contract that has *not* been initialized yet.
fn setup_uninitialized() -> (Env, NftStakingClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let staking_id = env.register_contract(None, crate::NftStaking);
    let staking = NftStakingClient::new(&env, &staking_id);

    (env, staking)
}

/// True if `addr` authorized the most recent top-level invocation.
fn authorized(env: &Env, addr: &Address) -> bool {
    env.auths().iter().any(|(a, _)| a == addr)
}

/// Error surfaced to the caller when a required `require_auth` is missing.
fn auth_error() -> soroban_sdk::Error {
    soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
}

/// Mocks a single-address authorization for `fn_name(args)` on the pool.
fn mock_single_auth(
    env: &Env,
    staking: &NftStakingClient,
    signer: &Address,
    fn_name: &'static str,
    args: soroban_sdk::Vec<soroban_sdk::Val>,
) {
    env.mock_auths(&[MockAuth {
        address: signer,
        invoke: &MockAuthInvoke {
            contract: &staking.address,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
}

// ── Issue #822: init ─────────────────────────────────────────────────────────

/// Happy path: `init` persists admin, collection, reward token and rate, and
/// leaves the pool unpaused and empty.
#[test]
fn test_init_stores_full_config() {
    let (env, staking) = setup_uninitialized();
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let reward_token = Address::generate(&env);

    staking.init(&admin, &nft, &reward_token, &1_000_000i128);

    assert_eq!(staking.get_admin(), Some(admin));
    assert_eq!(staking.get_nft_address(), nft);
    assert_eq!(staking.get_reward_token(), reward_token);
    assert_eq!(staking.get_reward_rate(), 1_000_000i128);
    assert!(!staking.is_paused());
    assert_eq!(staking.total_staked(), 0);
}

/// `init` requires the admin's authorization.
#[test]
fn test_init_requires_admin_auth() {
    let (env, staking) = setup_uninitialized();
    let admin = Address::generate(&env);

    staking.init(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &1i128,
    );
    assert!(authorized(&env, &admin));
}

/// Without the admin's signature `init` fails and nothing is stored.
#[test]
fn test_init_fails_without_admin_auth() {
    let env = Env::default();
    let staking_id = env.register(crate::NftStaking, ());
    let staking = NftStakingClient::new(&env, &staking_id);

    let err = staking
        .try_init(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &1i128,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, auth_error());
    assert_eq!(staking.get_admin(), None);
}

/// A second `init` reverts with `AlreadyInitialized` and cannot overwrite the
/// original configuration, even when called by a different admin.
#[test]
fn test_init_twice_fails_and_preserves_config() {
    let (env, staking, admin, _user1, _user2) = setup();
    let original_nft = staking.get_nft_address();
    let original_reward = staking.get_reward_token();

    let attacker = Address::generate(&env);
    let err = staking
        .try_init(
            &attacker,
            &Address::generate(&env),
            &Address::generate(&env),
            &5i128,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::AlreadyInitialized.into());

    assert_eq!(staking.get_admin(), Some(admin));
    assert_eq!(staking.get_nft_address(), original_nft);
    assert_eq!(staking.get_reward_token(), original_reward);
    assert_eq!(staking.get_reward_rate(), 1_000_000i128);
}

/// Zero and negative reward rates are rejected with `InvalidDuration`.
#[test]
fn test_init_rejects_non_positive_reward_rate() {
    let (env, staking) = setup_uninitialized();
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let reward_token = Address::generate(&env);

    for rate in [0i128, -1i128, i128::MIN] {
        let err = staking
            .try_init(&admin, &nft, &reward_token, &rate)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, StakingError::InvalidDuration.into());
    }
    assert_eq!(staking.get_admin(), None);
}

/// Rates above the cap are rejected with `RewardRateTooHigh`.
#[test]
fn test_init_rejects_reward_rate_above_max() {
    let (env, staking) = setup_uninitialized();
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let reward_token = Address::generate(&env);

    for rate in [MAX_REWARD_RATE + 1, i128::MAX] {
        let err = staking
            .try_init(&admin, &nft, &reward_token, &rate)
            .unwrap_err()
            .unwrap();
        assert_eq!(err, StakingError::RewardRateTooHigh.into());
    }
    assert_eq!(staking.get_admin(), None);
}

/// Boundary values: a rate of exactly 1 and exactly the cap are both accepted.
#[test]
fn test_init_accepts_boundary_reward_rates() {
    for rate in [1i128, MAX_REWARD_RATE] {
        let (env, staking) = setup_uninitialized();
        staking.init(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &rate,
        );
        assert_eq!(staking.get_reward_rate(), rate);
    }
}

/// A rejected `init` does not burn the one-shot initializer: a subsequent
/// valid call still succeeds.
#[test]
fn test_init_succeeds_after_failed_attempt() {
    let (env, staking) = setup_uninitialized();
    let admin = Address::generate(&env);
    let nft = Address::generate(&env);
    let reward_token = Address::generate(&env);

    assert!(staking
        .try_init(&admin, &nft, &reward_token, &0i128)
        .is_err());

    staking.init(&admin, &nft, &reward_token, &42i128);
    assert_eq!(staking.get_admin(), Some(admin));
    assert_eq!(staking.get_nft_address(), nft);
    assert_eq!(staking.get_reward_rate(), 42i128);
}

// ── Issue #823: set_admin ────────────────────────────────────────────────────

/// Happy path: the admin is replaced and both the current and the incoming
/// admin must authorize the rotation.
#[test]
fn test_set_admin_updates_admin_with_both_auths() {
    let (env, staking, admin, new_admin, _user2) = setup();

    staking.set_admin(&new_admin);

    assert!(authorized(&env, &admin));
    assert!(authorized(&env, &new_admin));
    assert_eq!(staking.get_admin(), Some(new_admin));
}

/// Re-setting the current admin is a harmless no-op.
#[test]
fn test_set_admin_to_same_address() {
    let (_env, staking, admin, _user1, _user2) = setup();

    staking.set_admin(&admin);
    assert_eq!(staking.get_admin(), Some(admin));
}

/// Before `init` there is no admin, so `set_admin` reverts with `Unauthorized`
/// rather than letting the first caller claim the pool.
#[test]
fn test_set_admin_fails_before_init() {
    let (env, staking) = setup_uninitialized();

    let err = staking
        .try_set_admin(&Address::generate(&env))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, StakingError::Unauthorized.into());
    assert_eq!(staking.get_admin(), None);
}

/// Only the current admin signing is not enough: the new admin must consent.
#[test]
fn test_set_admin_fails_without_new_admin_auth() {
    let (env, staking, admin, new_admin, _user2) = setup();

    mock_single_auth(
        &env,
        &staking,
        &admin,
        "set_admin",
        (&new_admin,).into_val(&env),
    );
    let err = staking.try_set_admin(&new_admin).unwrap_err().unwrap();
    assert_eq!(err, auth_error());
    assert_eq!(staking.get_admin(), Some(admin));
}

/// A non-admin cannot take over the pool by nominating themselves.
#[test]
fn test_set_admin_fails_when_called_by_non_admin() {
    let (env, staking, admin, attacker, _user2) = setup();

    mock_single_auth(
        &env,
        &staking,
        &attacker,
        "set_admin",
        (&attacker,).into_val(&env),
    );
    let err = staking.try_set_admin(&attacker).unwrap_err().unwrap();
    assert_eq!(err, auth_error());
    assert_eq!(staking.get_admin(), Some(admin));
}

/// After rotation the new admin holds admin rights and the old one loses them.
#[test]
fn test_set_admin_transfers_admin_privileges() {
    let (env, staking, old_admin, new_admin, _user2) = setup();

    staking.set_admin(&new_admin);

    mock_single_auth(
        &env,
        &staking,
        &old_admin,
        "set_paused",
        (true,).into_val(&env),
    );
    let err = staking.try_set_paused(&true).unwrap_err().unwrap();
    assert_eq!(err, auth_error());
    assert!(!staking.is_paused());

    mock_single_auth(
        &env,
        &staking,
        &new_admin,
        "set_paused",
        (true,).into_val(&env),
    );
    staking.set_paused(&true);
    assert!(staking.is_paused());
}

/// `set_admin` only touches the admin slot; pool config is left intact.
#[test]
fn test_set_admin_does_not_alter_pool_config() {
    let (_env, staking, _admin, new_admin, _user2) = setup();
    let nft = staking.get_nft_address();
    let reward_token = staking.get_reward_token();

    staking.set_admin(&new_admin);

    assert_eq!(staking.get_nft_address(), nft);
    assert_eq!(staking.get_reward_token(), reward_token);
    assert_eq!(staking.get_reward_rate(), 1_000_000i128);
}

// ── Issue #824: get_admin ────────────────────────────────────────────────────

/// Before `init` no admin is set.
#[test]
fn test_get_admin_none_before_init() {
    let (_env, staking) = setup_uninitialized();
    assert_eq!(staking.get_admin(), None);
}

/// After `init` the configured admin is returned.
#[test]
fn test_get_admin_returns_init_admin() {
    let (_env, staking, admin, _user1, _user2) = setup();
    assert_eq!(staking.get_admin(), Some(admin));
}

/// `get_admin` tracks every rotation made through `set_admin`.
#[test]
fn test_get_admin_reflects_successive_rotations() {
    let (env, staking, _admin, second, _user2) = setup();
    let third = Address::generate(&env);

    staking.set_admin(&second);
    assert_eq!(staking.get_admin(), Some(second));

    staking.set_admin(&third);
    assert_eq!(staking.get_admin(), Some(third));
}

/// `get_admin` is a public read: it needs no authorization.
#[test]
fn test_get_admin_requires_no_auth() {
    let (env, staking, admin, _user1, _user2) = setup();

    env.set_auths(&[]);
    assert_eq!(staking.get_admin(), Some(admin));
    assert!(env.auths().is_empty());
}

/// A failed `set_admin` leaves `get_admin` unchanged.
#[test]
fn test_get_admin_unchanged_after_failed_set_admin() {
    let (env, staking, admin, attacker, _user2) = setup();

    env.set_auths(&[]);
    assert!(staking.try_set_admin(&attacker).is_err());
    assert_eq!(staking.get_admin(), Some(admin));
}

// ── Issue #825: get_nft_address ──────────────────────────────────────────────

/// Happy path: returns the collection passed to `init`.
#[test]
fn test_get_nft_address_returns_init_collection() {
    let (_env, staking, _user, collection, _admin) = setup_with_mock();
    assert_eq!(staking.get_nft_address(), collection);
}

/// Before `init` the getter reverts with `NotInitialized`.
#[test]
fn test_get_nft_address_fails_before_init() {
    let (_env, staking) = setup_uninitialized();

    let err = staking.try_get_nft_address().unwrap_err().unwrap();
    assert_eq!(err, StakingError::NotInitialized.into());
}

/// A rejected `init` must not leave a partially stored collection behind.
#[test]
fn test_get_nft_address_fails_after_rejected_init() {
    let (env, staking) = setup_uninitialized();

    assert!(staking
        .try_init(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &(MAX_REWARD_RATE + 1),
        )
        .is_err());

    let err = staking.try_get_nft_address().unwrap_err().unwrap();
    assert_eq!(err, StakingError::NotInitialized.into());
}

/// The collection is immutable: re-init, admin rotation and pausing do not
/// change it.
#[test]
fn test_get_nft_address_immutable_after_init() {
    let (env, staking, _user, collection, _admin) = setup_with_mock();

    assert!(staking
        .try_init(
            &Address::generate(&env),
            &Address::generate(&env),
            &Address::generate(&env),
            &1i128,
        )
        .is_err());
    staking.set_admin(&Address::generate(&env));
    staking.set_paused(&true);

    assert_eq!(staking.get_nft_address(), collection);
}

/// `get_nft_address` is a public read: it needs no authorization.
#[test]
fn test_get_nft_address_requires_no_auth() {
    let (env, staking, _user, collection, _admin) = setup_with_mock();

    env.set_auths(&[]);
    assert_eq!(staking.get_nft_address(), collection);
    assert!(env.auths().is_empty());
}

/// Each pool reports its own collection; pools do not share this slot.
#[test]
fn test_get_nft_address_is_per_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let reward_token = Address::generate(&env);
    let nft_a = Address::generate(&env);
    let nft_b = Address::generate(&env);

    let pool_a = NftStakingClient::new(&env, &env.register(crate::NftStaking, ()));
    let pool_b = NftStakingClient::new(&env, &env.register(crate::NftStaking, ()));
    pool_a.init(&admin, &nft_a, &reward_token, &1i128);
    pool_b.init(&admin, &nft_b, &reward_token, &1i128);

    assert_eq!(pool_a.get_nft_address(), nft_a);
    assert_eq!(pool_b.get_nft_address(), nft_b);
}

/// The stored collection is what gates staking: other collections are rejected.
#[test]
fn test_get_nft_address_gates_stake() {
    let (env, staking, user, collection, _admin) = setup_with_mock();
    let other = env.register(mock_nft::MockNft, ());
    mint_token(&env, &other, &user, 0);

    assert_ne!(staking.get_nft_address(), other);
    let err = staking.try_stake(&user, &other, &0).unwrap_err().unwrap();
    assert_eq!(err, StakingError::InvalidToken.into());
    assert_eq!(staking.get_nft_address(), collection);
}
