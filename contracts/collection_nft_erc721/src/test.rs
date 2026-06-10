extern crate std;

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env, String};

use crate::{DataKey, Error, NormalNFT721, NormalNFT721Client};

fn jump_ledger(env: &Env, delta: u32) {
    env.ledger().with_mut(|li| {
        li.sequence_number += delta;
    });
}

fn setup() -> (
    Env,
    NormalNFT721Client<'static>,
    Address, /*contract_id*/
    Address, /*creator*/
) {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    env.mock_all_auths();

    let contract_id = env.register(NormalNFT721, ());
    let client = NormalNFT721Client::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);

    client.initialize(
        &creator,
        &String::from_str(&env, "Test Collection 721"),
        &String::from_str(&env, "T721"),
        &1_000u64,
        &500u32,
        &royalty_receiver,
    );

    (env, client, contract_id, creator)
}

// ── TTL tests (pre-existing) ──────────────────────────────────────────────────

#[test]
fn instance_ttl_is_extended_on_mint() {
    let (env, client, _contract_id, _creator) = setup();

    let alice = Address::generate(&env);

    // After init, instance TTL is bumped by the initializer.
    // Move past the threshold so missing "extend_instance_ttl" on mint would expire it.
    jump_ledger(&env, 60_000);
    let token_id_0 = client.mint(&alice, &String::from_str(&env, "uri-0"));

    jump_ledger(&env, 60_000);
    let token_id_1 = client.mint(&alice, &String::from_str(&env, "uri-1"));

    assert_eq!(token_id_0, 0u64);
    assert_eq!(token_id_1, 1u64);
}

#[test]
fn persistent_ttl_is_extended_on_transfer_keys() {
    let (env, client, contract_id, _creator) = setup();

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let token_id = client.mint(&alice, &String::from_str(&env, "uri"));

    client.transfer(&alice, &bob, &token_id);

    // Jump beyond TTL_THRESHOLD. If transfer() didn't extend TTL for the
    // updated keys, they'd disappear.
    jump_ledger(&env, 60_000);

    let (owner_has, alice_balance_has) = env.as_contract(&contract_id, || {
        let owner_has = env.storage().persistent().has(&DataKey::Owner(token_id));
        let alice_balance_has = env
            .storage()
            .persistent()
            .has(&DataKey::BalanceOf(alice.clone()));
        (owner_has, alice_balance_has)
    });

    assert!(owner_has);
    assert!(alice_balance_has);
    assert_eq!(client.owner_of(&token_id), bob);
}

#[test]
fn persistent_ttl_is_extended_on_burn_balance_key() {
    let (env, client, contract_id, _creator) = setup();

    let alice = Address::generate(&env);

    let token_id = client.mint(&alice, &String::from_str(&env, "uri"));
    // NormalNFT721's burn() path checks explicit approval (via Approved(token_id)),
    // so set a self-approval first to keep this test focused on TTL behavior.
    client.approve(&alice, &alice, &token_id);
    client.burn(&alice, &token_id);

    jump_ledger(&env, 60_000);

    let (owner_has, alice_balance_has) = env.as_contract(&contract_id, || {
        let owner_has = env.storage().persistent().has(&DataKey::Owner(token_id));
        let alice_balance_has = env
            .storage()
            .persistent()
            .has(&DataKey::BalanceOf(alice.clone()));
        (owner_has, alice_balance_has)
    });

    // burn() intentionally removes the token ownership key
    assert!(!owner_has);
    // but BalanceOf must still be kept alive.
    assert!(alice_balance_has);
}

// ── Query functions ───────────────────────────────────────────────────────────

#[test]
fn name_and_symbol_are_stored_correctly() {
    let (_, client, _, _) = setup();
    assert_eq!(
        client.name(),
        String::from_str(&client.env, "Test Collection 721")
    );
    assert_eq!(client.symbol(), String::from_str(&client.env, "T721"));
}

#[test]
fn total_supply_starts_at_zero() {
    let (_, client, _, _) = setup();
    assert_eq!(client.total_supply(), 0u64);
}

#[test]
fn max_supply_reflects_initialized_value() {
    let (_, client, _, _) = setup();
    assert_eq!(client.max_supply(), 1_000u64);
}

#[test]
fn balance_of_returns_zero_for_address_with_no_tokens() {
    let (env, client, _, _) = setup();
    let nobody = Address::generate(&env);
    assert_eq!(client.balance_of(&nobody), 0u64);
}

#[test]
fn royalty_info_matches_initialized_values() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    env.mock_all_auths();

    let contract_id = env.register(NormalNFT721, ());
    let client = NormalNFT721Client::new(&env, &contract_id);

    let creator = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);

    client.initialize(
        &creator,
        &String::from_str(&env, "Royalty Test"),
        &String::from_str(&env, "RT"),
        &100u64,
        &750u32,
        &royalty_receiver,
    );

    let (recv, bps) = client.royalty_info();
    assert_eq!(recv, royalty_receiver);
    assert_eq!(bps, 750u32);
}

// ── Minting ───────────────────────────────────────────────────────────────────

#[test]
fn mint_increments_total_supply_and_balance() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    assert_eq!(client.total_supply(), 0);
    let id0 = client.mint(&alice, &String::from_str(&env, "uri-0"));
    assert_eq!(client.total_supply(), 1);
    assert_eq!(client.balance_of(&alice), 1);

    let id1 = client.mint(&alice, &String::from_str(&env, "uri-1"));
    assert_eq!(client.total_supply(), 2);
    assert_eq!(client.balance_of(&alice), 2);
    assert_eq!(id0, 0u64);
    assert_eq!(id1, 1u64);
}

#[test]
fn mint_sets_owner_and_token_uri() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "ipfs://Qm123"));
    assert_eq!(client.owner_of(&id), alice);
    assert_eq!(
        client.token_uri(&id),
        String::from_str(&env, "ipfs://Qm123")
    );
}

#[test]
fn mint_to_multiple_addresses_tracks_balances_independently() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&alice, &String::from_str(&env, "alice-uri"));
    client.mint(&bob, &String::from_str(&env, "bob-uri-1"));
    client.mint(&bob, &String::from_str(&env, "bob-uri-2"));

    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.balance_of(&bob), 2);
    assert_eq!(client.total_supply(), 3);
}

// ── Max supply enforcement ────────────────────────────────────────────────────

#[test]
fn mint_fails_when_max_supply_is_reached() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    env.mock_all_auths();

    let contract_id = env.register(NormalNFT721, ());
    let client = NormalNFT721Client::new(&env, &contract_id);
    let creator = Address::generate(&env);
    let receiver = Address::generate(&env);

    // Max supply = 2
    client.initialize(
        &creator,
        &String::from_str(&env, "Small Collection"),
        &String::from_str(&env, "SC"),
        &2u64,
        &0u32,
        &receiver,
    );

    let alice = Address::generate(&env);
    client.mint(&alice, &String::from_str(&env, "uri-0"));
    client.mint(&alice, &String::from_str(&env, "uri-1"));

    // Third mint should fail
    let result = client.try_mint(&alice, &String::from_str(&env, "uri-2"));
    assert_eq!(result, Err(Ok(Error::MaxSupplyReached)));
}

#[test]
fn cannot_initialize_twice() {
    let (env, client, _, creator) = setup();
    let receiver = Address::generate(&env);

    let result = client.try_initialize(
        &creator,
        &String::from_str(&env, "Again"),
        &String::from_str(&env, "AG"),
        &100u64,
        &0u32,
        &receiver,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Transfers ─────────────────────────────────────────────────────────────────

#[test]
fn transfer_moves_ownership_and_updates_balances() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    assert_eq!(client.owner_of(&id), alice);
    assert_eq!(client.balance_of(&alice), 1);
    assert_eq!(client.balance_of(&bob), 0);

    client.transfer(&alice, &bob, &id);

    assert_eq!(client.owner_of(&id), bob);
    assert_eq!(client.balance_of(&alice), 0);
    assert_eq!(client.balance_of(&bob), 1);
}

#[test]
fn transfer_fails_when_called_by_non_owner() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let eve = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));

    // Eve is not the owner and has no approval
    let result = client.try_transfer(&eve, &alice, &id);
    assert!(result.is_err());
}

#[test]
fn transfer_clears_single_token_approval() {
    let (env, client, contract_id, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let charlie = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.approve(&alice, &charlie, &id);

    // Approval is set before transfer
    let approved_before = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Approved(id))
    });
    assert!(approved_before.is_some());

    client.transfer(&alice, &bob, &id);

    // Approval must be cleared after transfer
    let approved_after = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Approved(id))
    });
    assert!(approved_after.is_none());
}

#[test]
fn transfer_from_by_approved_spender_succeeds() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let spender = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.approve(&alice, &spender, &id);

    client.transfer_from(&spender, &alice, &bob, &id);
    assert_eq!(client.owner_of(&id), bob);
}

#[test]
fn transfer_from_by_operator_succeeds() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let operator = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.set_approval_for_all(&alice, &operator, &true);

    client.transfer_from(&operator, &alice, &bob, &id);
    assert_eq!(client.owner_of(&id), bob);
}

#[test]
fn transfer_from_fails_without_approval() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let eve = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    let result = client.try_transfer_from(&eve, &alice, &bob, &id);
    assert_eq!(result, Err(Ok(Error::NotApproved)));
}

// ── Approvals ─────────────────────────────────────────────────────────────────

#[test]
fn approve_sets_single_token_approval() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    assert_eq!(client.get_approved(&id), None);

    client.approve(&alice, &bob, &id);
    assert_eq!(client.get_approved(&id), Some(bob));
}

#[test]
fn approve_by_non_owner_fails() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let eve = Address::generate(&env);
    let bob = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    let result = client.try_approve(&eve, &bob, &id);
    assert_eq!(result, Err(Ok(Error::NotApproved)));
}

#[test]
fn set_approval_for_all_and_is_approved_for_all() {
    let (env, client, _, _) = setup();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);

    assert!(!client.is_approved_for_all(&owner, &operator));
    client.set_approval_for_all(&owner, &operator, &true);
    assert!(client.is_approved_for_all(&owner, &operator));

    client.set_approval_for_all(&owner, &operator, &false);
    assert!(!client.is_approved_for_all(&owner, &operator));
}

#[test]
fn operator_can_approve_on_behalf_of_owner() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let operator = Address::generate(&env);
    let charlie = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.set_approval_for_all(&alice, &operator, &true);

    // Operator should be able to call approve() for alice's token
    client.approve(&operator, &charlie, &id);
    assert_eq!(client.get_approved(&id), Some(charlie));
}

// ── Burns ─────────────────────────────────────────────────────────────────────

#[test]
fn burn_removes_token_and_decrements_supply_and_balance() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    assert_eq!(client.total_supply(), 1);
    assert_eq!(client.balance_of(&alice), 1);

    client.approve(&alice, &alice, &id);
    client.burn(&alice, &id);

    assert_eq!(client.total_supply(), 0);
    assert_eq!(client.balance_of(&alice), 0);

    // ownerOf should now return TokenNotFound
    let result = client.try_owner_of(&id);
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));
}

#[test]
fn burn_by_non_owner_without_approval_fails() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let eve = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    let result = client.try_burn(&eve, &id);
    assert_eq!(result, Err(Ok(Error::NotApproved)));
}

#[test]
fn burn_by_approved_spender_succeeds() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let spender = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.approve(&alice, &spender, &id);
    client.burn(&spender, &id);

    let result = client.try_owner_of(&id);
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));
}

#[test]
fn burn_by_operator_succeeds() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let operator = Address::generate(&env);

    let id = client.mint(&alice, &String::from_str(&env, "uri"));
    client.set_approval_for_all(&alice, &operator, &true);
    client.burn(&operator, &id);

    let result = client.try_owner_of(&id);
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));
}

#[test]
fn burn_nonexistent_token_fails() {
    let (_, client, _, _) = setup();
    let caller = soroban_sdk::Address::generate(&client.env);
    let result = client.try_burn(&caller, &999u64);
    assert_eq!(result, Err(Ok(Error::TokenNotFound)));
}

// ── Ownership management ──────────────────────────────────────────────────────

#[test]
fn transfer_ownership_updates_creator() {
    let (env, client, _, creator) = setup();
    let new_creator = Address::generate(&env);

    // original creator can transfer
    client.transfer_ownership(&new_creator);
    assert_eq!(client.creator(), new_creator);

    // new creator can mint
    let alice = Address::generate(&env);
    let id = client.mint(&alice, &String::from_str(&env, "new-uri"));
    assert_eq!(client.owner_of(&id), alice);
    let _ = creator; // suppress unused variable warning
}

#[test]
fn update_royalty_changes_receiver_and_bps() {
    let (env, client, _, _) = setup();
    let new_receiver = Address::generate(&env);

    client.update_royalty(&new_receiver, &250u32);
    let (recv, bps) = client.royalty_info();
    assert_eq!(recv, new_receiver);
    assert_eq!(bps, 250u32);
}

// ── Balance corruption fix test ───────────────────────────────────────────────

#[test]
fn transfer_from_zero_balance_fails_correctly() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Alice has no tokens, balance should be 0
    assert_eq!(client.balance_of(&alice), 0u64);

    // Mint a token to bob
    client.mint(&bob, &String::from_str(&env, "uri-0"));
    assert_eq!(client.balance_of(&bob), 1u64);

    // Try to transfer token 0 from alice (who doesn't own it) to bob
    // This should fail with NotApproved since Alice is not approved to transfer Bob's token
    let result = client.try_transfer_from(&alice, &alice, &bob, &0u64);
    assert_eq!(result, Err(Ok(Error::NotApproved)));
}

// ── next_token_id ─────────────────────────────────────────────────────────────

#[test]
fn next_token_id_advances_with_each_mint() {
    let (env, client, _, _) = setup();
    let alice = Address::generate(&env);

    assert_eq!(client.next_token_id(), 0u64);
    client.mint(&alice, &String::from_str(&env, "uri-0"));
    assert_eq!(client.next_token_id(), 1u64);
    client.mint(&alice, &String::from_str(&env, "uri-1"));
    assert_eq!(client.next_token_id(), 2u64);
}
