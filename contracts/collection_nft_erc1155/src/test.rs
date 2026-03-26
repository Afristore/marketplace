extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String, Vec,
};

use crate::{NormalNFT1155, NormalNFT1155Client};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup(env: &Env) -> (NormalNFT1155Client<'_>, Address) {
    env.mock_all_auths();
    let id = env.register(NormalNFT1155, ());
    let client = NormalNFT1155Client::new(env, &id);
    let creator = Address::generate(env);
    let royalty_rx = Address::generate(env);
    client.initialize(
        &creator,
        &String::from_str(env, "TestNFT1155"),
        &500u32,
        &royalty_rx,
    );
    (client, creator)
}

// ── Normal-path tests ────────────────────────────────────────────────────────

#[test]
fn mint_new_sets_balance_and_supply() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);

    let tid = client.mint_new(&alice, &100u128, &String::from_str(&env, "ipfs://1"));
    assert_eq!(tid, 0);
    assert_eq!(client.balance_of(&alice, &0), 100);
    assert_eq!(client.total_supply(&0), 100);
    assert_eq!(client.next_token_id(), 1);
}

#[test]
fn mint_transfer_burn_lifecycle() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Mint — triggers extend_instance_ttl + TotalSupply extend_ttl
    let tid = client.mint_new(&alice, &50u128, &String::from_str(&env, "ipfs://a"));
    assert_eq!(client.balance_of(&alice, &tid), 50);
    assert_eq!(client.total_supply(&tid), 50);

    // Transfer partial — triggers Balance(from) extend_ttl
    client.transfer(&alice, &bob, &tid, &20u128);
    assert_eq!(client.balance_of(&alice, &tid), 30);
    assert_eq!(client.balance_of(&bob, &tid), 20);
    assert_eq!(client.total_supply(&tid), 50); // supply unchanged by transfer

    // Burn — triggers Balance(from) + TotalSupply extend_ttl
    client.burn(&alice, &tid, &10u128);
    assert_eq!(client.balance_of(&alice, &tid), 20);
    assert_eq!(client.total_supply(&tid), 40);
}

#[test]
fn resupply_mint_existing_token() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);

    let tid = client.mint_new(&alice, &10u128, &String::from_str(&env, "ipfs://orig"));

    // Resupply with explicit mint() — same token_id, additional amount
    client.mint(&alice, &tid, &5u128, &String::from_str(&env, "ipfs://different"));
    assert_eq!(client.balance_of(&alice, &tid), 15);
    assert_eq!(client.total_supply(&tid), 15);
    // URI is set once; resupply does not overwrite
    assert_eq!(client.uri(&tid), String::from_str(&env, "ipfs://orig"));
}

#[test]
fn mint_batch_works() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);

    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    let mut uris = Vec::new(&env);

    ids.push_back(100u64);
    amounts.push_back(10u128);
    uris.push_back(String::from_str(&env, "ipfs://100"));

    ids.push_back(101u64);
    amounts.push_back(20u128);
    uris.push_back(String::from_str(&env, "ipfs://101"));

    client.mint_batch(&alice, &ids, &amounts, &uris);
    assert_eq!(client.balance_of(&alice, &100), 10);
    assert_eq!(client.balance_of(&alice, &101), 20);
    assert_eq!(client.total_supply(&100), 10);
    assert_eq!(client.total_supply(&101), 20);
}

#[test]
fn batch_transfer_works() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint_new(&alice, &30u128, &String::from_str(&env, "ipfs://a"));
    client.mint_new(&alice, &40u128, &String::from_str(&env, "ipfs://b"));

    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    ids.push_back(0u64);
    amounts.push_back(10u128);
    ids.push_back(1u64);
    amounts.push_back(15u128);

    client.batch_transfer(&alice, &bob, &ids, &amounts);
    assert_eq!(client.balance_of(&alice, &0), 20);
    assert_eq!(client.balance_of(&bob, &0), 10);
    assert_eq!(client.balance_of(&alice, &1), 25);
    assert_eq!(client.balance_of(&bob, &1), 15);
}

#[test]
fn operator_transfer_from() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let operator = Address::generate(&env);

    client.mint_new(&alice, &50u128, &String::from_str(&env, "ipfs://x"));
    client.set_approval_for_all(&alice, &operator, &true);
    assert!(client.is_approved_for_all(&alice, &operator));

    client.transfer_from(&operator, &alice, &bob, &0, &25u128);
    assert_eq!(client.balance_of(&alice, &0), 25);
    assert_eq!(client.balance_of(&bob, &0), 25);
}

#[test]
fn transfer_ownership_and_update_royalty() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let new_creator = Address::generate(&env);
    let new_rx = Address::generate(&env);

    // Both admin functions now call extend_instance_ttl internally
    client.transfer_ownership(&new_creator);
    assert_eq!(client.creator(), new_creator);

    client.update_royalty(&new_rx, &750u32);
    let (rx, bps) = client.royalty_info();
    assert_eq!(rx, new_rx);
    assert_eq!(bps, 750);
}

#[test]
fn multiple_mints_and_transfers_no_ttl_panic() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Rapid sequence: each call invokes extend_instance_ttl + persistent TTL bumps
    for _ in 0..5 {
        let tid = client.mint_new(&alice, &10u128, &String::from_str(&env, "ipfs://seq"));
        client.transfer(&alice, &bob, &tid, &5u128);
    }
    // alice keeps 5 of each, bob gets 5 of each
    for i in 0u64..5 {
        assert_eq!(client.balance_of(&alice, &i), 5);
        assert_eq!(client.balance_of(&bob, &i), 5);
    }
    assert_eq!(client.next_token_id(), 5);
}

// ── Error-path tests ─────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn double_initialize_fails() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let other = Address::generate(&env);
    client.initialize(
        &other,
        &String::from_str(&env, "Dup"),
        &0u32,
        &other,
    );
}

#[test]
#[should_panic]
fn burn_insufficient_balance_fails() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);

    client.mint_new(&alice, &10u128, &String::from_str(&env, "ipfs://x"));
    // Burning more than balance — should trigger InsufficientBalance
    client.burn(&alice, &0, &11u128);
}

#[test]
#[should_panic]
fn transfer_insufficient_balance_fails() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint_new(&alice, &5u128, &String::from_str(&env, "ipfs://x"));
    client.transfer(&alice, &bob, &0, &6u128);
}

#[test]
#[should_panic]
fn unapproved_transfer_from_fails() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let rando = Address::generate(&env);

    client.mint_new(&alice, &50u128, &String::from_str(&env, "ipfs://x"));
    // rando has no approval — should trigger NotApproved
    client.transfer_from(&rando, &alice, &bob, &0, &10u128);
}

#[test]
#[should_panic]
fn mint_batch_length_mismatch_fails() {
    let env = Env::default();
    let (client, _creator) = setup(&env);
    let alice = Address::generate(&env);

    let mut ids = Vec::new(&env);
    let mut amounts = Vec::new(&env);
    let mut uris = Vec::new(&env);

    ids.push_back(0u64);
    ids.push_back(1u64);
    amounts.push_back(10u128); // only 1 amount vs 2 ids
    uris.push_back(String::from_str(&env, "ipfs://a"));
    uris.push_back(String::from_str(&env, "ipfs://b"));

    client.mint_batch(&alice, &ids, &amounts, &uris);
}
