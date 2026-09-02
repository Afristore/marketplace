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
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
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
