#![cfg(test)]

mod mock_nft {
    use soroban_sdk::{contract, contractimpl, Address, Env};
    #[contract]
    pub struct MockNft;
    #[contractimpl]
    impl MockNft {
        pub fn transfer(_env: Env, _from: Address, _to: Address, _token_id: u64) {}
        pub fn transfer_from(
            _env: Env,
            _spender: Address,
            _from: Address,
            _to: Address,
            _token_id: u64,
        ) {
        }
        pub fn owner_of(_env: Env, _token_id: u64) -> Address {
            use soroban_sdk::testutils::Address as _;
            Address::generate(&_env)
        }
    }
}

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env,
};

use crate::contract::NftStakingClient;

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

#[test]
fn test_stake_and_get_position() {
    let (_env, staking, user, collection, _admin) = setup_with_mock();

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
    let (_env, staking, user, collection, _admin) = setup_with_mock();

    assert_eq!(staking.total_staked(), 0);
    staking.stake(&user, &collection, &0);
    assert_eq!(staking.total_staked(), 1);
    staking.stake(&user, &collection, &1);
    assert_eq!(staking.total_staked(), 2);
}

#[test]
fn test_multiple_stakes_per_user() {
    let (_env, staking, user, collection1, _admin) = setup_with_mock();

    staking.stake(&user, &collection1, &0);
    staking.stake(&user, &collection1, &1);

    let stakes = staking.get_user_stakes(&user);
    assert_eq!(stakes.len(), 2);
}

#[test]
fn test_calculate_rewards() {
    let (env, staking, user, collection, _admin) = setup_with_mock();

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
    let (_env, staking, user, collection, _admin) = setup_with_mock();

    staking.stake(&user, &collection, &0);
    staking.unstake(&user, &collection, &0);

    let pos = staking.get_staked_position(&user, &collection, &0);
    assert!(pos.is_none());
}
