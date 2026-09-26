extern crate std;

use soroban_sdk::{
    testutils::Address as _, testutils::AuthorizedFunction, testutils::AuthorizedInvocation,
    testutils::Ledger as _, Address, BytesN, Env, IntoVal, String, Symbol,
};

use crate::contract::{
    CollectionKind, CollectionRecord, Error as LaunchpadError, Launchpad, LaunchpadClient,
    MAX_FEE_BPS,
};
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

#[test]
fn update_royalty_fails_if_not_creator() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);

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

    let new_receiver = Address::generate(&env);
    let result = client.try_update_royalty(&new_receiver, &250u32);
    assert!(result.is_err());
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

// ── Launchpad (contract.rs) helpers ───────────────────────────────────────────

const INITIAL_FEE_BPS: u32 = 250;

fn wasm_bytes(name: &str) -> std::vec::Vec<u8> {
    // Test binaries live in <target>/debug/deps, so walk up to <target>.
    let exe = std::env::current_exe().unwrap();
    let target_dir = exe
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .unwrap()
        .to_path_buf();
    let path = target_dir
        .join("wasm32v1-none")
        .join("release")
        .join(std::format!("{name}.wasm"));

    std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "missing wasm at {}. build it first with: cargo build --target wasm32v1-none --release --workspace",
            path.display()
        )
    })
}

fn register_launchpad(env: &Env) -> LaunchpadClient<'_> {
    let id = env.register(Launchpad, ());
    LaunchpadClient::new(env, &id)
}

/// Registers and initializes a launchpad with `INITIAL_FEE_BPS`.
/// Returns `(client, admin, fee_receiver)`.
fn setup_launchpad(env: &Env) -> (LaunchpadClient<'_>, Address, Address) {
    env.mock_all_auths();
    let client = register_launchpad(env);
    let admin = Address::generate(env);
    let fee_receiver = Address::generate(env);
    client.initialize(&admin, &fee_receiver, &INITIAL_FEE_BPS);
    (client, admin, fee_receiver)
}

/// Like `setup_launchpad`, and also uploads the four collection WASMs.
fn setup_launchpad_with_wasms(env: &Env) -> (LaunchpadClient<'_>, Address, Address) {
    let (client, admin, fee_receiver) = setup_launchpad(env);
    let upload = |name: &str| {
        env.deployer()
            .upload_contract_wasm(wasm_bytes(name).as_slice())
    };
    client.set_wasm_hashes(
        &upload("collection_nft_erc721"),
        &upload("collection_nft_erc1155"),
        &upload("lazy_mint_erc721"),
        &upload("lazy_mint_erc1155"),
    );
    (client, admin, fee_receiver)
}

fn salt(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn deploy_n721(client: &LaunchpadClient, creator: &Address, seed: u8) -> Address {
    let env = &client.env;
    client.deploy_normal_721(
        creator,
        &String::from_str(env, "Normal 721"),
        &String::from_str(env, "N721"),
        &1_000u64,
        &500u32,
        creator,
        &salt(env, seed),
    )
}

fn deploy_n1155(client: &LaunchpadClient, creator: &Address, seed: u8) -> Address {
    let env = &client.env;
    client.deploy_normal_1155(
        creator,
        &String::from_str(env, "Normal 1155"),
        &500u32,
        creator,
        &salt(env, seed),
    )
}

fn deploy_l721(client: &LaunchpadClient, creator: &Address, seed: u8) -> Address {
    let env = &client.env;
    client.deploy_lazy_721(
        creator,
        &BytesN::from_array(env, &[7u8; 32]),
        &String::from_str(env, "Lazy 721"),
        &String::from_str(env, "L721"),
        &1_000u64,
        &500u32,
        creator,
        &salt(env, seed),
    )
}

fn deploy_l1155(client: &LaunchpadClient, creator: &Address, seed: u8) -> Address {
    let env = &client.env;
    client.deploy_lazy_1155(
        creator,
        &BytesN::from_array(env, &[7u8; 32]),
        &String::from_str(env, "Lazy 1155"),
        &500u32,
        creator,
        &salt(env, seed),
    )
}

fn record(address: &Address, kind: CollectionKind, creator: &Address) -> CollectionRecord {
    CollectionRecord {
        address: address.clone(),
        kind,
        creator: creator.clone(),
    }
}

// ── Launchpad: update_platform_fee ────────────────────────────────────────────

#[test]
fn update_platform_fee_updates_receiver_and_bps() {
    let env = Env::default();
    let (client, _admin, fee_receiver) = setup_launchpad(&env);
    assert_eq!(client.platform_fee(), (fee_receiver, INITIAL_FEE_BPS));

    let new_receiver = Address::generate(&env);
    client.update_platform_fee(&new_receiver, &500u32);

    assert_eq!(client.platform_fee(), (new_receiver, 500u32));
}

#[test]
fn update_platform_fee_is_authorized_by_admin_only() {
    let env = Env::default();
    let (client, admin, _fee_receiver) = setup_launchpad(&env);

    let new_receiver = Address::generate(&env);
    client.update_platform_fee(&new_receiver, &300u32);

    assert_eq!(
        env.auths(),
        std::vec![(
            admin,
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&env, "update_platform_fee"),
                    (new_receiver, 300u32).into_val(&env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn update_platform_fee_fails_without_admin_auth() {
    let env = Env::default();
    let (client, _admin, fee_receiver) = setup_launchpad(&env);
    env.set_auths(&[]);

    let result = client.try_update_platform_fee(&Address::generate(&env), &500u32);

    assert!(result.is_err());
    assert_eq!(client.platform_fee(), (fee_receiver, INITIAL_FEE_BPS));
}

#[test]
fn update_platform_fee_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = register_launchpad(&env);

    let result = client.try_update_platform_fee(&Address::generate(&env), &100u32);

    assert_eq!(result, Err(Ok(LaunchpadError::NotInitialized)));
}

#[test]
fn update_platform_fee_requires_new_admin_after_transfer() {
    let env = Env::default();
    let (client, _old_admin, _fee_receiver) = setup_launchpad(&env);
    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    let new_receiver = Address::generate(&env);
    client.update_platform_fee(&new_receiver, &100u32);

    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, new_admin);
    assert_eq!(client.platform_fee(), (new_receiver, 100u32));
}

#[test]
fn update_platform_fee_last_write_wins() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let receiver_a = Address::generate(&env);
    let receiver_b = Address::generate(&env);

    client.update_platform_fee(&receiver_a, &100u32);
    client.update_platform_fee(&receiver_b, &900u32);

    assert_eq!(client.platform_fee(), (receiver_b, 900u32));
}

#[test]
fn update_platform_fee_can_change_bps_only() {
    let env = Env::default();
    let (client, _admin, fee_receiver) = setup_launchpad(&env);

    client.update_platform_fee(&fee_receiver, &1_000u32);

    assert_eq!(client.platform_fee(), (fee_receiver, 1_000u32));
}

#[test]
fn update_platform_fee_does_not_change_admin_or_collections() {
    let env = Env::default();
    let (client, admin, _fee_receiver) = setup_launchpad(&env);

    client.update_platform_fee(&Address::generate(&env), &100u32);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.collection_count(), 0u64);
    assert!(client.all_collections().is_empty());
}

// ── Launchpad: platform fee bounds ────────────────────────────────────────────

#[test]
fn update_platform_fee_accepts_zero_bps() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let new_receiver = Address::generate(&env);

    client.update_platform_fee(&new_receiver, &0u32);

    assert_eq!(client.platform_fee(), (new_receiver, 0u32));
}

#[test]
fn update_platform_fee_accepts_max_bps() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let new_receiver = Address::generate(&env);

    client.update_platform_fee(&new_receiver, &MAX_FEE_BPS);

    assert_eq!(client.platform_fee(), (new_receiver, MAX_FEE_BPS));
}

#[test]
fn update_platform_fee_rejects_bps_just_above_max() {
    let env = Env::default();
    let (client, _admin, fee_receiver) = setup_launchpad(&env);

    let result = client.try_update_platform_fee(&Address::generate(&env), &(MAX_FEE_BPS + 1));

    assert_eq!(result, Err(Ok(LaunchpadError::InvalidFeeBps)));
    assert_eq!(client.platform_fee(), (fee_receiver, INITIAL_FEE_BPS));
}

#[test]
fn update_platform_fee_rejects_u32_max_bps() {
    let env = Env::default();
    let (client, _admin, fee_receiver) = setup_launchpad(&env);

    let result = client.try_update_platform_fee(&Address::generate(&env), &u32::MAX);

    assert_eq!(result, Err(Ok(LaunchpadError::InvalidFeeBps)));
    assert_eq!(client.platform_fee(), (fee_receiver, INITIAL_FEE_BPS));
}

#[test]
fn initialize_rejects_fee_bps_above_max() {
    let env = Env::default();
    env.mock_all_auths();
    let client = register_launchpad(&env);
    let admin = Address::generate(&env);
    let receiver = Address::generate(&env);

    let result = client.try_initialize(&admin, &receiver, &(MAX_FEE_BPS + 1));
    assert_eq!(result, Err(Ok(LaunchpadError::InvalidFeeBps)));

    // The rejected call must not leave the contract half-initialized.
    client.initialize(&admin, &receiver, &MAX_FEE_BPS);
    assert_eq!(client.platform_fee(), (receiver, MAX_FEE_BPS));
}

// ── Launchpad: collections_by_creator ─────────────────────────────────────────

#[test]
fn collections_by_creator_is_empty_before_initialize() {
    let env = Env::default();
    let client = register_launchpad(&env);

    assert!(client
        .collections_by_creator(&Address::generate(&env))
        .is_empty());
}

#[test]
fn collections_by_creator_is_empty_for_creator_without_deploys() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let creator = Address::generate(&env);
    deploy_n721(&client, &creator, 1);

    assert!(client
        .collections_by_creator(&Address::generate(&env))
        .is_empty());
}

#[test]
fn collections_by_creator_returns_deployed_record() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let creator = Address::generate(&env);

    let addr = deploy_n721(&client, &creator, 1);

    let records = client.collections_by_creator(&creator);
    assert_eq!(records.len(), 1);
    assert_eq!(
        records.get(0).unwrap(),
        record(&addr, CollectionKind::Normal721, &creator)
    );
}

#[test]
fn collections_by_creator_preserves_order_across_all_kinds() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let creator = Address::generate(&env);

    let a = deploy_n721(&client, &creator, 1);
    let b = deploy_n1155(&client, &creator, 2);
    let c = deploy_l721(&client, &creator, 3);
    let d = deploy_l1155(&client, &creator, 4);

    let records = client.collections_by_creator(&creator);
    assert_eq!(records.len(), 4);
    assert_eq!(
        records.get(0).unwrap(),
        record(&a, CollectionKind::Normal721, &creator)
    );
    assert_eq!(
        records.get(1).unwrap(),
        record(&b, CollectionKind::Normal1155, &creator)
    );
    assert_eq!(
        records.get(2).unwrap(),
        record(&c, CollectionKind::LazyMint721, &creator)
    );
    assert_eq!(
        records.get(3).unwrap(),
        record(&d, CollectionKind::LazyMint1155, &creator)
    );
}

#[test]
fn collections_by_creator_isolates_creators() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let alice_1 = deploy_n721(&client, &alice, 1);
    let bob_1 = deploy_n1155(&client, &bob, 2);
    let alice_2 = deploy_l721(&client, &alice, 3);

    let alice_records = client.collections_by_creator(&alice);
    assert_eq!(alice_records.len(), 2);
    assert_eq!(
        alice_records.get(0).unwrap(),
        record(&alice_1, CollectionKind::Normal721, &alice)
    );
    assert_eq!(
        alice_records.get(1).unwrap(),
        record(&alice_2, CollectionKind::LazyMint721, &alice)
    );

    let bob_records = client.collections_by_creator(&bob);
    assert_eq!(bob_records.len(), 1);
    assert_eq!(
        bob_records.get(0).unwrap(),
        record(&bob_1, CollectionKind::Normal1155, &bob)
    );

    assert_eq!(
        alice_records.len() + bob_records.len(),
        client.all_collections().len()
    );
}

#[test]
fn collections_by_creator_ignores_failed_deploys() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let creator = Address::generate(&env);

    let result = client.try_deploy_normal_721(
        &creator,
        &String::from_str(&env, "No Wasm"),
        &String::from_str(&env, "NW"),
        &1_000u64,
        &500u32,
        &creator,
        &salt(&env, 1),
    );

    assert_eq!(result, Err(Ok(LaunchpadError::WasmHashNotSet)));
    assert!(client.collections_by_creator(&creator).is_empty());
}

// ── Launchpad: collection_count ───────────────────────────────────────────────

#[test]
fn collection_count_is_zero_before_initialize() {
    let env = Env::default();
    let client = register_launchpad(&env);

    assert_eq!(client.collection_count(), 0u64);
}

#[test]
fn collection_count_is_zero_after_initialize() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);

    assert_eq!(client.collection_count(), 0u64);
}

#[test]
fn collection_count_increments_for_every_collection_kind() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let creator = Address::generate(&env);

    deploy_n721(&client, &creator, 1);
    assert_eq!(client.collection_count(), 1u64);
    deploy_n1155(&client, &creator, 2);
    assert_eq!(client.collection_count(), 2u64);
    deploy_l721(&client, &creator, 3);
    assert_eq!(client.collection_count(), 3u64);
    deploy_l1155(&client, &creator, 4);
    assert_eq!(client.collection_count(), 4u64);
}

#[test]
fn collection_count_is_global_across_creators() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    deploy_n721(&client, &alice, 1);
    deploy_n721(&client, &bob, 2);
    deploy_n1155(&client, &bob, 3);

    assert_eq!(client.collection_count(), 3u64);
    assert_eq!(
        client.collection_count(),
        u64::from(client.all_collections().len())
    );
}

#[test]
fn collection_count_unchanged_by_failed_deploys() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let creator = Address::generate(&env);

    let result = client.try_deploy_normal_1155(
        &creator,
        &String::from_str(&env, "No Wasm"),
        &500u32,
        &creator,
        &salt(&env, 1),
    );

    assert_eq!(result, Err(Ok(LaunchpadError::WasmHashNotSet)));
    assert_eq!(client.collection_count(), 0u64);
}

#[test]
fn collection_count_unchanged_by_admin_operations() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad_with_wasms(&env);
    let creator = Address::generate(&env);
    deploy_n721(&client, &creator, 1);

    client.update_platform_fee(&Address::generate(&env), &100u32);
    client.transfer_admin(&Address::generate(&env));

    assert_eq!(client.collection_count(), 1u64);
}

// ── set_wasm_hashes authorisation ────────────────────────────────────────────

/// Read a stored wasm hash straight out of the contract's instance storage.
/// There is no public getter for these four, so the storage key is the only way
/// to assert that a refused call left the value alone.
fn stored_normal_721_hash(env: &Env, launchpad: &Address) -> Option<BytesN<32>> {
    env.as_contract(launchpad, || {
        env.storage()
            .instance()
            .get(&crate::contract::DataKey::WasmNormal721)
    })
}

/// `set_wasm_hashes` is gated by `only_admin`, which calls `require_auth()` on
/// the stored admin. With no authorisations the call must be refused *and* the
/// previously stored hashes must survive untouched.
#[test]
fn set_wasm_hashes_is_refused_without_the_admins_authorisation() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let launchpad = client.address.clone();

    let original = BytesN::from_array(&env, &[1u8; 32]);
    client.set_wasm_hashes(
        &original,
        &BytesN::from_array(&env, &[2u8; 32]),
        &BytesN::from_array(&env, &[3u8; 32]),
        &BytesN::from_array(&env, &[4u8; 32]),
    );
    assert_eq!(stored_normal_721_hash(&env, &launchpad), Some(original.clone()));

    let attacker = BytesN::from_array(&env, &[9u8; 32]);
    env.set_auths(&[]);
    let refused = client.try_set_wasm_hashes(
        &attacker,
        &BytesN::from_array(&env, &[9u8; 32]),
        &BytesN::from_array(&env, &[9u8; 32]),
        &BytesN::from_array(&env, &[9u8; 32]),
    );

    assert!(refused.is_err(), "an unauthorised caller must not set the wasm hashes");
    assert_eq!(
        stored_normal_721_hash(&env, &launchpad),
        Some(original),
        "a refused call must not overwrite the stored hashes"
    );
}

/// The positive control: with the admin's authorisation the same call does
/// replace the stored hash, so the test above cannot be passing because the
/// entry point is broken for everyone.
#[test]
fn set_wasm_hashes_replaces_the_stored_hash_when_authorised() {
    let env = Env::default();
    let (client, _admin, _fee_receiver) = setup_launchpad(&env);
    let launchpad = client.address.clone();

    let first = BytesN::from_array(&env, &[5u8; 32]);
    let second = BytesN::from_array(&env, &[6u8; 32]);
    let other = BytesN::from_array(&env, &[7u8; 32]);

    client.set_wasm_hashes(&first, &other, &other, &other);
    assert_eq!(stored_normal_721_hash(&env, &launchpad), Some(first.clone()));

    client.set_wasm_hashes(&second, &other, &other, &other);
    assert_eq!(
        stored_normal_721_hash(&env, &launchpad),
        Some(second),
        "an authorised call must be able to replace the hash"
    );
}
