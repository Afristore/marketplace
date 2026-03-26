extern crate std;

use soroban_sdk::{
    testutils::Address as _,
    Address, BytesN, Env, String,
};

use crate::{CollectionKind, Launchpad, LaunchpadClient};

fn wasm_bytes(name: &str) -> std::vec::Vec<u8> {
    let manifest = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let path = manifest
        .join("../../target/wasm32-unknown-unknown/release")
        .join(std::format!("{name}.wasm"));

    std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "missing wasm at {}. build it first with: cargo build --target wasm32-unknown-unknown --release -p collection-nft-erc1155 -p lazy-mint-erc721 -p collection-nft-erc721 -p lazy-mint-erc1155",
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

    client.initialize(&admin, &fee_receiver, &250u32);

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
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[10u8; 32]);
    let salt_b = BytesN::from_array(&env, &[11u8; 32]);
    let royalty_receiver = Address::generate(&env);

    let deployed_a = client.deploy_normal_721(
        &creator,
        &String::from_str(&env, "Creator 721 A"),
        &String::from_str(&env, "C721A"),
        &1_000u64,
        &500u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_normal_721(
        &creator,
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
    assert!(matches!(all.get(0).unwrap().kind, CollectionKind::Normal721));
    assert!(matches!(all.get(1).unwrap().kind, CollectionKind::Normal721));
}

#[test]
fn deploys_normal_1155_twice_with_unique_addresses() {
    let env = Env::default();
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[20u8; 32]);
    let salt_b = BytesN::from_array(&env, &[21u8; 32]);
    let royalty_receiver = Address::generate(&env);

    let deployed_a = client.deploy_normal_1155(
        &creator,
        &String::from_str(&env, "Creator 1155 A"),
        &500u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_normal_1155(
        &creator,
        &String::from_str(&env, "Creator 1155 B"),
        &500u32,
        &royalty_receiver,
        &salt_b,
    );

    assert_ne!(deployed_a, deployed_b);
    assert_eq!(client.collection_count(), 2u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 2);
    assert!(matches!(all.get(0).unwrap().kind, CollectionKind::Normal1155));
    assert!(matches!(all.get(1).unwrap().kind, CollectionKind::Normal1155));
}

#[test]
fn deploys_lazy_721_twice_with_unique_addresses() {
    let env = Env::default();
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[30u8; 32]);
    let salt_b = BytesN::from_array(&env, &[31u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[7u8; 32]);
    let royalty_receiver = Address::generate(&env);

    let deployed_a = client.deploy_lazy_721(
        &creator,
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
    assert!(matches!(all.get(0).unwrap().kind, CollectionKind::LazyMint721));
    assert!(matches!(all.get(1).unwrap().kind, CollectionKind::LazyMint721));
}

#[test]
fn deploys_lazy_1155_twice_with_unique_addresses() {
    let env = Env::default();
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);

    let salt_a = BytesN::from_array(&env, &[40u8; 32]);
    let salt_b = BytesN::from_array(&env, &[41u8; 32]);
    let creator_pubkey = BytesN::from_array(&env, &[9u8; 32]);
    let royalty_receiver = Address::generate(&env);

    let deployed_a = client.deploy_lazy_1155(
        &creator,
        &creator_pubkey,
        &String::from_str(&env, "Lazy 1155 A"),
        &600u32,
        &royalty_receiver,
        &salt_a,
    );

    let deployed_b = client.deploy_lazy_1155(
        &creator,
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
    assert!(matches!(all.get(0).unwrap().kind, CollectionKind::LazyMint1155));
    assert!(matches!(all.get(1).unwrap().kind, CollectionKind::LazyMint1155));
}

// ── TTL-extension regression tests ──────────────────────────────────────────
// These verify that extend_instance_ttl calls (added for storage TTL safety)
// do not panic and that state-modifying admin functions still work correctly.

#[test]
fn transfer_admin_and_update_fee_with_ttl() {
    let env = Env::default();
    let (client, _admin, _fee_receiver, _creator) = setup_launchpad(&env);

    // transfer_admin now calls extend_instance_ttl
    let new_admin = Address::generate(&env);
    client.transfer_admin(&new_admin);
    assert_eq!(client.admin(), new_admin);

    // update_platform_fee now calls extend_instance_ttl
    let new_fee_rx = Address::generate(&env);
    client.update_platform_fee(&new_fee_rx, &300u32);
    let (rx, bps) = client.platform_fee();
    assert_eq!(rx, new_fee_rx);
    assert_eq!(bps, 300);
}

#[test]
fn deploy_all_four_types_extends_ttl() {
    let env = Env::default();
    let (client, _admin, _fee_receiver, creator) = setup_launchpad(&env);
    let royalty_receiver = Address::generate(&env);
    let creator_pubkey = BytesN::from_array(&env, &[5u8; 32]);

    // Each deploy_* now calls extend_instance_ttl before deploying
    let _a1 = client.deploy_normal_721(
        &creator,
        &String::from_str(&env, "N721"),
        &String::from_str(&env, "N7"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[50u8; 32]),
    );

    let _a2 = client.deploy_normal_1155(
        &creator,
        &String::from_str(&env, "N1155"),
        &500u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[51u8; 32]),
    );

    let _a3 = client.deploy_lazy_721(
        &creator,
        &creator_pubkey,
        &String::from_str(&env, "L721"),
        &String::from_str(&env, "L7"),
        &100u64,
        &500u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[52u8; 32]),
    );

    let _a4 = client.deploy_lazy_1155(
        &creator,
        &creator_pubkey,
        &String::from_str(&env, "L1155"),
        &500u32,
        &royalty_receiver,
        &BytesN::from_array(&env, &[53u8; 32]),
    );

    assert_eq!(client.collection_count(), 4u64);

    let all = client.all_collections();
    assert_eq!(all.len(), 4);
    assert!(matches!(all.get(0).unwrap().kind, CollectionKind::Normal721));
    assert!(matches!(all.get(1).unwrap().kind, CollectionKind::Normal1155));
    assert!(matches!(all.get(2).unwrap().kind, CollectionKind::LazyMint721));
    assert!(matches!(all.get(3).unwrap().kind, CollectionKind::LazyMint1155));

    let by_creator = client.collections_by_creator(&creator);
    assert_eq!(by_creator.len(), 4);
}
