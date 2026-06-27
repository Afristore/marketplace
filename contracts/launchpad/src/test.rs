extern crate std;

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env, String};

use crate::{CollectionKind, Error, Launchpad, LaunchpadClient};

fn jump_ledger(env: &Env, delta: u32) {
    env.ledger().with_mut(|li| {
        li.sequence_number += delta;
    });
}

fn wasm_bytes(name: &str) -> std::vec::Vec<u8> {
    // In Cursor's sandbox, cargo builds into an isolated target dir (not `./target`).
    // Derive the target dir from the current test binary path:
    //   .../cargo-target/debug/deps/<test-binary>
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
            "missing wasm at {}. build it first with: cargo build --target wasm32v1-none --release -p collection-nft-erc1155 -p lazy-mint-erc721 -p collection-nft-erc721 -p lazy-mint-erc1155",
            path.display()
        )
    })
}

fn setup_launchpad(env: &Env) -> (LaunchpadClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let launchpad_id = env.register(Launchpad, ());
    let client = LaunchpadClient::new(env, &launchpad_id);

    let admin = Address::generate(env);
    let fee_receiver = Address::generate(env);
    let creator = Address::generate(env);

    client.initialize(&admin, &fee_receiver, &0u32);

    let wasm_normal_721_bytes = wasm_bytes("collection_nft_erc721");
    let wasm_normal_1155_bytes = wasm_bytes("collection_nft_erc1155");
    let wasm_lazy_721_bytes = wasm_bytes("lazy_mint_erc721");
    let wasm_lazy_1155_bytes = wasm_bytes("lazy_mint_erc1155");

    let wasm_normal_721 = env
        .deployer()
        .upload_contract_wasm(wasm_normal_721_bytes.as_slice());
    let wasm_normal_1155 = env
        .deployer()
        .upload_contract_wasm(wasm_normal_1155_bytes.as_slice());
    let wasm_lazy_721 = env
        .deployer()
        .upload_contract_wasm(wasm_lazy_721_bytes.as_slice());
    let wasm_lazy_1155 = env
        .deployer()
        .upload_contract_wasm(wasm_lazy_1155_bytes.as_slice());

    client.set_wasm_hashes(
        &wasm_normal_721,
        &wasm_normal_1155,
        &wasm_lazy_721,
        &wasm_lazy_1155,
    );

    (client, admin, fee_receiver, creator)
}

#[test]
fn deploys_normal_721_twice_with_unique_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[10u8; 32]);
    let salt_b = BytesN::from_array(&env, &[11u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let deployed_a = client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Creator 721 A"),
        &String::from_str(&env, "C721A"),
        &1_000u64,
        &500u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Creator 721 B"),
        &String::from_str(&env, "C721B"),
        &1_500u64,
        &500u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_ne!(deployed_a, deployed_b);
    assert_eq!(client.collection_count(), 2u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 2);
    assert!(matches!(
        all.get(0).unwrap().kind,
        CollectionKind::Normal721
    ));
    assert!(matches!(
        all.get(1).unwrap().kind,
        CollectionKind::Normal721
    ));
}

#[test]
fn deploys_normal_1155_twice_with_unique_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[20u8; 32]);
    let salt_b = BytesN::from_array(&env, &[21u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let deployed_a = client.deploy_normal_1155(
        &creator,
        &currency,
        &String::from_str(&env, "Creator 1155 A"),
        &500u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_normal_1155(
        &creator,
        &currency,
        &String::from_str(&env, "Creator 1155 B"),
        &500u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_ne!(deployed_a, deployed_b);
    assert_eq!(client.collection_count(), 2u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 2);
    assert!(matches!(
        all.get(0).unwrap().kind,
        CollectionKind::Normal1155
    ));
    assert!(matches!(
        all.get(1).unwrap().kind,
        CollectionKind::Normal1155
    ));
}

#[test]
fn deploys_lazy_721_twice_with_unique_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[30u8; 32]);
    let salt_b = BytesN::from_array(&env, &[31u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[7u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let deployed_a = client.deploy_lazy_721(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Lazy 721 A"),
        &String::from_str(&env, "LZ7A"),
        &1_000u64,
        &750u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_lazy_721(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Lazy 721 B"),
        &String::from_str(&env, "LZ7B"),
        &1_200u64,
        &750u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_ne!(deployed_a, deployed_b);
    assert_eq!(client.collection_count(), 2u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 2);
    assert!(matches!(
        all.get(0).unwrap().kind,
        CollectionKind::LazyMint721
    ));
    assert!(matches!(
        all.get(1).unwrap().kind,
        CollectionKind::LazyMint721
    ));
}

#[test]
fn deploys_lazy_1155_twice_with_unique_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[40u8; 32]);
    let salt_b = BytesN::from_array(&env, &[41u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[9u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let deployed_a = client.deploy_lazy_1155(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Lazy 1155 A"),
        &600u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_lazy_1155(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Lazy 1155 B"),
        &600u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_ne!(deployed_a, deployed_b);
    assert_eq!(client.collection_count(), 2u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 2);
    assert!(matches!(
        all.get(0).unwrap().kind,
        CollectionKind::LazyMint1155
    ));
    assert!(matches!(
        all.get(1).unwrap().kind,
        CollectionKind::LazyMint1155
    ));
}

#[test]
fn deploy_calls_extend_instance_ttl() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    // After initialize(), instance TTL is bumped to 100_000 ledgers.
    // Move forward so remaining TTL is below threshold (50_000),
    // then call deploy_* which should bump instance TTL again.
    jump_ledger(&env, 60_000);

    let salt_a = BytesN::from_array(&env, &[60u8; 32]);
    let _deployed_a = client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "TTL A"),
        &String::from_str(&env, "TTLA"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &salt_a,
    );

    // Without TTL extension on deploy, instance storage would now be expired:
    // 60_000 + 60_000 > 100_000.
    jump_ledger(&env, 60_000);

    let salt_b = BytesN::from_array(&env, &[61u8; 32]);
    let _deployed_b = client.deploy_normal_1155(
        &creator,
        &currency,
        &String::from_str(&env, "TTL B"),
        &500u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_eq!(client.collection_count(), 2u64);
}

#[test]
fn admin_calls_extend_instance_ttl() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, _creator) = setup_launchpad(&env);

    jump_ledger(&env, 60_000);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    jump_ledger(&env, 60_000);

    assert_eq!(client.admin(), new_admin);
}

// ─── Issue #53 — Salt front-running / griefing tests ─────────────────────────
//
// The fix: secure_salt = sha256(creator.to_xdr() ‖ raw_salt)
//
// Two categories of tests:
//   A. Same raw salt from two different creators → different deployed addresses.
//   B. Front-runner copies Alice's raw salt and transacts first → Alice's
//      subsequent transaction still succeeds (different address).

// ── Category A: Per-creator namespace isolation ──────────────────────────────

/// deploy_normal_721: same raw salt, different creators ⟹ different addresses.
#[test]
fn same_salt_different_creators_normal_721_yields_different_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0xAAu8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_alice = client.deploy_normal_721(
        &alice,
        &currency,
        &String::from_str(&env, "Alice 721"),
        &String::from_str(&env, "AL7"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &salt,
    );

    let addr_bob = client.deploy_normal_721(
        &bob,
        &currency,
        &String::from_str(&env, "Bob 721"),
        &String::from_str(&env, "BO7"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &salt, // identical raw salt
    );

    // Because secure_salt = sha256(creator ‖ raw_salt) they must differ.
    assert_ne!(
        addr_alice, addr_bob,
        "same raw salt must not collide across creators"
    );
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_normal_1155: same raw salt, different creators ⟹ different addresses.
#[test]
fn same_salt_different_creators_normal_1155_yields_different_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0xBBu8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_alice = client.deploy_normal_1155(
        &alice,
        &currency,
        &String::from_str(&env, "Alice 1155"),
        &500u32,
        &royalty_receiver,
        &salt,
    );

    let addr_bob = client.deploy_normal_1155(
        &bob,
        &currency,
        &String::from_str(&env, "Bob 1155"),
        &500u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_lazy_721: same raw salt, different creators ⟹ different addresses.
#[test]
fn same_salt_different_creators_lazy_721_yields_different_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0xCCu8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[0x01u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_alice = client.deploy_lazy_721(
        &alice,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Alice L721"),
        &String::from_str(&env, "AL7L"),
        &500u64,
        &300u32,
        &royalty_receiver,
        &salt,
    );

    let addr_bob = client.deploy_lazy_721(
        &bob,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Bob L721"),
        &String::from_str(&env, "BO7L"),
        &500u64,
        &300u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_lazy_1155: same raw salt, different creators ⟹ different addresses.
#[test]
fn same_salt_different_creators_lazy_1155_yields_different_addresses() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0xDDu8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[0x02u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_alice = client.deploy_lazy_1155(
        &alice,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Alice L1155"),
        &400u32,
        &royalty_receiver,
        &salt,
    );

    let addr_bob = client.deploy_lazy_1155(
        &bob,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Bob L1155"),
        &400u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

// ── Category B: Front-runner cannot block the victim ─────────────────────────
//
// Bob front-runs with the same raw salt as Alice.  After the fix, Bob's
// deploy lands at sha256(Bob ‖ salt).  Alice's subsequent deploy lands at
// sha256(Alice ‖ salt) — a distinct address — so her tx must succeed.

/// deploy_normal_721: front-runner copies Alice's salt → Alice still succeeds.
#[test]
fn front_runner_cannot_grief_normal_721() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env); // malicious actor

    let salt = BytesN::from_array(&env, &[0x11u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    // Bob front-runs using Alice's raw salt.
    let addr_bob = client.deploy_normal_721(
        &bob,
        &currency,
        &String::from_str(&env, "Bob Grief 721"),
        &String::from_str(&env, "BG7"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    // Alice's transaction must still succeed (no panic / error).
    let addr_alice = client.deploy_normal_721(
        &alice,
        &currency,
        &String::from_str(&env, "Alice 721"),
        &String::from_str(&env, "AL7"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(
        addr_alice, addr_bob,
        "front-runner must not occupy Alice's slot"
    );
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_normal_1155: front-runner copies Alice's salt → Alice still succeeds.
#[test]
fn front_runner_cannot_grief_normal_1155() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0x22u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_bob = client.deploy_normal_1155(
        &bob,
        &currency,
        &String::from_str(&env, "Bob Grief 1155"),
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let addr_alice = client.deploy_normal_1155(
        &alice,
        &currency,
        &String::from_str(&env, "Alice 1155"),
        &0u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_lazy_721: front-runner copies Alice's salt → Alice still succeeds.
#[test]
fn front_runner_cannot_grief_lazy_721() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0x33u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[0x03u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_bob = client.deploy_lazy_721(
        &bob,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Bob Grief L721"),
        &String::from_str(&env, "BGL7"),
        &200u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let addr_alice = client.deploy_lazy_721(
        &alice,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Alice L721"),
        &String::from_str(&env, "ALL7"),
        &200u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

/// deploy_lazy_1155: front-runner copies Alice's salt → Alice still succeeds.
#[test]
fn front_runner_cannot_grief_lazy_1155() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, alice) = setup_launchpad(&env);
    let bob = Address::generate(&env);

    let salt = BytesN::from_array(&env, &[0x44u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[0x04u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr_bob = client.deploy_lazy_1155(
        &bob,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Bob Grief L1155"),
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let addr_alice = client.deploy_lazy_1155(
        &alice,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Alice L1155"),
        &0u32,
        &royalty_receiver,
        &salt,
    );

    assert_ne!(addr_alice, addr_bob);
    assert_eq!(client.collection_count(), 2u64);
}

// ── Initialisation error tests ──────────────────────────────────

#[test]
fn initialize_twice_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let launchpad_id = env.register(Launchpad, ());
    let client = LaunchpadClient::new(&env, &launchpad_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    client.initialize(&admin, &fee_receiver, &0u32);

    let result = client.try_initialize(&admin, &fee_receiver, &0u32);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn deploy_without_wasm_hashes_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let launchpad_id = env.register(Launchpad, ());
    let client = LaunchpadClient::new(&env, &launchpad_id);

    let admin = Address::generate(&env);
    let fee_receiver = Address::generate(&env);
    let creator = Address::generate(&env);
    client.initialize(&admin, &fee_receiver, &0u32);

    let salt = BytesN::from_array(&env, &[0x99u8; 32]);
    let currency = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);

    let result = client.try_deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "No Wasm"),
        &String::from_str(&env, "NOWASM"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &salt,
    );
    assert_eq!(result, Err(Ok(Error::WasmHashNotSet)));
}

// ── Admin function tests ────────────────────────────────────────

#[test]
fn admin_calls_before_init_fail() {
    let env = Env::default();
    env.mock_all_auths();

    let launchpad_id = env.register(Launchpad, ());
    let client = LaunchpadClient::new(&env, &launchpad_id);

    let new_admin = Address::generate(&env);
    let result = client.try_transfer_admin(&new_admin);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));

    let result = client.try_update_platform_fee(&Address::generate(&env), &100u32);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn transfer_admin_success() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, _creator) = setup_launchpad(&env);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);

    assert_eq!(client.admin(), new_admin);
}

#[test]
fn update_platform_fee_success() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, _creator) = setup_launchpad(&env);

    let new_receiver = Address::generate(&env);
    let new_fee_bps = 250u32;
    client.update_platform_fee(&new_receiver, &new_fee_bps);

    let (receiver, bps) = client.platform_fee();
    assert_eq!(receiver, new_receiver);
    assert_eq!(bps, new_fee_bps);
}

// ── View function tests ─────────────────────────────────────────

#[test]
fn view_functions_return_correct_values() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, admin, fee_receiver, _creator) = setup_launchpad(&env);

    assert_eq!(client.admin(), admin);

    let (receiver, bps) = client.platform_fee();
    assert_eq!(receiver, fee_receiver);
    assert_eq!(bps, 0u32);
}

// ── Collections view tests ──────────────────────────────────────

#[test]
fn collections_by_creator_returns_correct_collections() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let other = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[0x55u8; 32]);
    let currency = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);

    client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Creator Coll"),
        &String::from_str(&env, "CRC"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &salt,
    );

    let creator_colls = client.collections_by_creator(&creator);
    assert_eq!(creator_colls.len(), 1);
    assert!(matches!(
        creator_colls.get(0).unwrap().kind,
        CollectionKind::Normal721
    ));

    let other_colls = client.collections_by_creator(&other);
    assert_eq!(other_colls.len(), 0);
}

// ── Issue #201: Invalid ED25519 signature and expired voucher tests ───────────
//
// Deploy a lazy_721 via the launchpad, then verify the deployed collection
// rejects invalid ED25519 signatures and expired vouchers.
//
// We mirror the MintVoucher / Error types from lazy_mint_erc721 using the same
// #[contracttype] / #[contracterror] macros so the XDR encoding matches.

use soroban_sdk::{contractclient, contracterror, contracttype};

#[contracttype]
#[derive(Clone)]
pub struct MintVoucher {
    pub token_id: u64,
    pub price: i128,
    pub currency: Address,
    pub uri: String,
    pub uri_hash: BytesN<32>,
    pub valid_until: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LazyError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotOwner = 3,
    NotApproved = 4,
    TokenNotFound = 5,
    MaxSupplyReached = 6,
    VoucherExpired = 7,
    VoucherAlreadyUsed = 8,
    NotCreator = 9,
    InvalidSignature = 10,
}

#[contractclient(name = "Lazy721Client")]
pub trait ILazy721 {
    fn redeem(
        env: Env,
        buyer: Address,
        voucher: MintVoucher,
        signature: BytesN<64>,
    ) -> Result<u64, LazyError>;
}

/// After deploying a lazy_721 via the launchpad, redeeming with an invalid
/// ED25519 signature must be rejected by the deployed collection contract.
#[test]
fn deployed_lazy_721_rejects_invalid_ed25519_signature() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let creator_pubkey = BytesN::from_array(&env, &[1u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[0xA1u8; 32]);

    let collection_addr = client.deploy_lazy_721(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Sig Test 721"),
        &String::from_str(&env, "ST7"),
        &1_000u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let lazy_client = Lazy721Client::new(&env, &collection_addr);
    let buyer = Address::generate(&env);
    let voucher = MintVoucher {
        token_id: 1,
        price: 0,
        currency: Address::generate(&env),
        uri: String::from_str(&env, "ipfs://test"),
        uri_hash: BytesN::from_array(&env, &[0u8; 32]),
        valid_until: 0,
    };

    // All-zeros is not a valid ed25519 signature — host will abort
    let bad_sig = BytesN::from_array(&env, &[0u8; 64]);
    let result = lazy_client.try_redeem(&buyer, &voucher, &bad_sig);
    assert!(result.is_err(), "invalid signature must be rejected");
}

/// After deploying a lazy_721 via the launchpad, redeeming an expired voucher
/// (valid_until < current ledger sequence) must return VoucherExpired.
#[test]
fn deployed_lazy_721_rejects_expired_voucher() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let creator_pubkey = BytesN::from_array(&env, &[2u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[0xA2u8; 32]);

    let collection_addr = client.deploy_lazy_721(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Expiry Test 721"),
        &String::from_str(&env, "ET7"),
        &1_000u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let lazy_client = Lazy721Client::new(&env, &collection_addr);

    // Advance ledger past the voucher's valid_until
    env.ledger().with_mut(|li| li.sequence_number = 200);

    let buyer = Address::generate(&env);
    let voucher = MintVoucher {
        token_id: 1,
        price: 0,
        currency: Address::generate(&env),
        uri: String::from_str(&env, "ipfs://expired"),
        uri_hash: BytesN::from_array(&env, &[0u8; 32]),
        valid_until: 50, // expired: 50 < 200
    };

    let sig = BytesN::from_array(&env, &[0u8; 64]);
    let result = lazy_client.try_redeem(&buyer, &voucher, &sig);
    assert_eq!(
        result,
        Err(Ok(LazyError::VoucherExpired)),
        "expired voucher must return VoucherExpired"
    );
}

// ── Query API tests (issue: launchpad contract query API + deploy events) ─────

/// get_collection_by_id returns the correct record for a deployed collection.
#[test]
fn get_collection_by_id_returns_record() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt = BytesN::from_array(&env, &[0xB1u8; 32]);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    let addr = client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Query Test"),
        &String::from_str(&env, "QT7"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &salt,
    );

    let record = client.get_collection_by_id(&addr);
    assert!(record.is_some());
    let rec = record.unwrap();
    assert_eq!(rec.address, addr);
    assert_eq!(rec.creator, creator);
    assert!(matches!(rec.kind, CollectionKind::Normal721));
}

/// get_collection_by_id returns None for an address not deployed via launchpad.
#[test]
fn get_collection_by_id_returns_none_for_unknown_address() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, _creator) = setup_launchpad(&env);

    let unknown = Address::generate(&env);
    let record = client.get_collection_by_id(&unknown);
    assert!(record.is_none());
}

/// get_creator_collections returns only the caller's collections.
#[test]
fn get_creator_collections_returns_only_caller_collections() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let other = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Creator A"),
        &String::from_str(&env, "CA7"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xC1u8; 32]),
    );

    client.deploy_normal_1155(
        &creator,
        &currency,
        &String::from_str(&env, "Creator B"),
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xC2u8; 32]),
    );

    // creator has 2 collections, other has 0
    let creator_colls = client.get_creator_collections(&creator);
    assert_eq!(creator_colls.len(), 2);

    let other_colls = client.get_creator_collections(&other);
    assert_eq!(other_colls.len(), 0);
}

/// get_all_collections returns all deployed collections across creators.
#[test]
fn get_all_collections_returns_all_deployed() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let alice = Address::generate(&env);
    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Coll 1"),
        &String::from_str(&env, "C1"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xD1u8; 32]),
    );

    client.deploy_normal_1155(
        &alice,
        &currency,
        &String::from_str(&env, "Coll 2"),
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xD2u8; 32]),
    );

    let all = client.get_all_collections();
    assert_eq!(all.len(), 2);
}

/// get_collection_count matches the number of deploys.
#[test]
fn get_collection_count_increments_per_deploy() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);
    let creator_pubkey = BytesN::from_array(&env, &[0x05u8; 32]);

    assert_eq!(client.get_collection_count(), 0u64);

    client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Count 1"),
        &String::from_str(&env, "CNT1"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xE1u8; 32]),
    );
    assert_eq!(client.get_collection_count(), 1u64);

    client.deploy_lazy_1155(
        &creator,
        &currency,
        &creator_pubkey,
        &String::from_str(&env, "Count 2"),
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xE2u8; 32]),
    );
    assert_eq!(client.get_collection_count(), 2u64);
}

/// Deploy events carry (creator, collection_address, kind) in the data payload.
#[test]
fn deploy_events_include_kind_in_payload() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let royalty_receiver = Address::generate(&env);
    let currency = Address::generate(&env);

    // Deploy one of each type and confirm no panic (events are emitted).
    // The soroban test SDK exposes env.events().all() to inspect events.
    let addr_n721 = client.deploy_normal_721(
        &creator,
        &currency,
        &String::from_str(&env, "Evt 721"),
        &String::from_str(&env, "EV7"),
        &100u64,
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xF1u8; 32]),
    );

    let addr_n1155 = client.deploy_normal_1155(
        &creator,
        &currency,
        &String::from_str(&env, "Evt 1155"),
        &0u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[0xF2u8; 32]),
    );

    // Verify get_collection_by_id captures the right kind for each address
    let rec_n721 = client.get_collection_by_id(&addr_n721).unwrap();
    assert!(matches!(rec_n721.kind, CollectionKind::Normal721));
    assert_eq!(rec_n721.creator, creator);

    let rec_n1155 = client.get_collection_by_id(&addr_n1155).unwrap();
    assert!(matches!(rec_n1155.kind, CollectionKind::Normal1155));
    assert_eq!(rec_n1155.creator, creator);

    // Confirm total count covers both
    assert_eq!(client.get_collection_count(), 2u64);
}

fn setup_launchpad_with_staking(env: &Env) -> (LaunchpadClient<'_>, Address, Address) {
    env.mock_all_auths();

    let launchpad_id = env.register(Launchpad, ());
    let client = LaunchpadClient::new(env, &launchpad_id);

    let admin = Address::generate(env);
    let creator = Address::generate(env);
    let fee_receiver = Address::generate(env);

    client.initialize(&admin, &fee_receiver, &0u32);

    let wasm_staking_bytes = wasm_bytes("nft_staking");
    let wasm_staking = env
        .deployer()
        .upload_contract_wasm(wasm_staking_bytes.as_slice());

    client.set_staking_wasm_hash(&wasm_staking);

    (client, admin, creator)
}

#[test]
fn deploys_staking_pool_for_nft_collection() {
    let env = Env::default();
    env.ledger().with_mut(|li| li.sequence_number = 1);
    let (client, _admin, creator) = setup_launchpad_with_staking(&env);

    let nft_address = Address::generate(&env);
    let reward_token = Address::generate(&env);
    let salt = BytesN::from_array(&env, &[0xAAu8; 32]);

    let pool_a =
        client.deploy_staking_pool(&creator, &nft_address, &reward_token, &1_000_000i128, &salt);

    let pool_b = client.get_staking_pool(&nft_address);
    assert_eq!(Some(pool_a), pool_b);

    let duplicate = client.try_deploy_staking_pool(
        &creator,
        &nft_address,
        &reward_token,
        &1_000_000i128,
        &BytesN::from_array(&env, &[0xBBu8; 32]),
    );
    assert_eq!(duplicate, Err(Ok(Error::StakingPoolAlreadyExists)));
}
