extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String, Vec,
};

use crate::{NormalNFT721, NormalNFT721Client};

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup(env: &Env) -> (NormalNFT721Client<'_>, Address, Address) {
    env.mock_all_auths();
    let id = env.register(NormalNFT721, ());
    let client = NormalNFT721Client::new(env, &id);
    let creator = Address::generate(env);
    let royalty_rx = Address::generate(env);
    client.initialize(
        &creator,
        &String::from_str(env, "TestNFT"),
        &String::from_str(env, "TNFT"),
        &1000u64,
        &500u32,
        &royalty_rx,
    );
    (client, creator, royalty_rx)
}

// ── Normal-path tests ────────────────────────────────────────────────────────

#[test]
fn mint_sets_owner_and_balances() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);

    let tid = client.mint(&alice, &String::from_str(&env, "ipfs://1"));
    assert_eq!(tid, 0);
    assert_eq!(client.owner_of(&0), alice);
    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.total_supply(), 1);
    assert_eq!(client.token_uri(&0), String::from_str(&env, "ipfs://1"));
}

#[test]
fn mint_transfer_burn_lifecycle() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Mint
    let tid = client.mint(&alice, &String::from_str(&env, "ipfs://a"));
    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.total_supply(), 1);

    // Transfer — exercises extend_ttl on BalanceOf(from) and Owner(token_id)
    client.transfer(&alice, &bob, &tid);
    assert_eq!(client.owner_of(&tid), bob);
    assert_eq!(client.balance_of(&alice), 0);
    assert_eq!(client.balance_of(&bob), 1);
    assert_eq!(client.total_supply(), 1);

    // Burn — exercises extend_ttl on BalanceOf(owner)
    client.burn(&bob, &tid);
    assert_eq!(client.balance_of(&bob), 0);
    assert_eq!(client.total_supply(), 0);
}

#[test]
fn batch_mint_works() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);

    let mut uris = Vec::new(&env);
    uris.push_back(String::from_str(&env, "ipfs://a"));
    uris.push_back(String::from_str(&env, "ipfs://b"));
    uris.push_back(String::from_str(&env, "ipfs://c"));

    client.batch_mint(&alice, &uris);
    assert_eq!(client.balance_of(&alice), 3);
    assert_eq!(client.total_supply(), 3);
    assert_eq!(client.owner_of(&0), alice);
    assert_eq!(client.owner_of(&1), alice);
    assert_eq!(client.owner_of(&2), alice);
}

#[test]
fn approve_and_transfer_from() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let spender = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "ipfs://x"));
    client.approve(&alice, &spender, &0);
    assert_eq!(client.get_approved(&0), Some(spender.clone()));

    client.transfer_from(&spender, &alice, &bob, &0);
    assert_eq!(client.owner_of(&0), bob);
    // Single-token approval cleared after transfer
    assert_eq!(client.get_approved(&0), None);
}

#[test]
fn set_approval_for_all_and_transfer() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let operator = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "ipfs://y"));
    client.set_approval_for_all(&alice, &operator, &true);
    assert!(client.is_approved_for_all(&alice, &operator));

    client.transfer_from(&operator, &alice, &bob, &0);
    assert_eq!(client.owner_of(&0), bob);
}

#[test]
fn transfer_ownership_and_update_royalty() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
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
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Rapid sequence: each call invokes extend_instance_ttl + persistent TTL bumps
    for i in 0u64..5 {
        client.mint(&alice, &String::from_str(&env, "ipfs://seq"));
        client.transfer(&alice, &bob, &i);
    }
    assert_eq!(client.balance_of(&alice), 0);
    assert_eq!(client.balance_of(&bob), 5);
    assert_eq!(client.total_supply(), 5);
}

// ── Error-path tests ─────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn double_initialize_fails() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let other = Address::generate(&env);
    client.initialize(
        &other,
        &String::from_str(&env, "Dup"),
        &String::from_str(&env, "DUP"),
        &100u64,
        &0u32,
        &other,
    );
}

#[test]
#[should_panic]
fn transfer_non_owner_fails() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let mallory = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "ipfs://x"));
    // mallory is not the owner — should trigger NotOwner
    client.transfer(&mallory, &bob, &0);
}

#[test]
#[should_panic]
fn burn_non_owner_fails() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "ipfs://x"));
    client.burn(&bob, &0);
}

#[test]
#[should_panic]
fn burn_nonexistent_token_fails() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    // token_id 99 was never minted — should trigger TokenNotFound
    client.burn(&alice, &99);
}

#[test]
#[should_panic]
fn max_supply_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(NormalNFT721, ());
    let client = NormalNFT721Client::new(&env, &id);
    let creator = Address::generate(&env);
    let rx = Address::generate(&env);

    // Max supply = 2
    client.initialize(
        &creator,
        &String::from_str(&env, "LimitedNFT"),
        &String::from_str(&env, "LNFT"),
        &2u64,
        &500u32,
        &rx,
    );

    let alice = Address::generate(&env);
    client.mint(&alice, &String::from_str(&env, "ipfs://1"));
    client.mint(&alice, &String::from_str(&env, "ipfs://2"));
    // Third mint exceeds max supply
    client.mint(&alice, &String::from_str(&env, "ipfs://3"));
}

#[test]
#[should_panic]
fn unapproved_transfer_from_fails() {
    let env = Env::default();
    let (client, _creator, _) = setup(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let rando = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "ipfs://z"));
    // rando has no approval — should trigger NotApproved
    client.transfer_from(&rando, &alice, &bob, &0);
}
