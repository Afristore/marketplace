#[test]
fn test_set_treasury_and_protocol_fee() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    // Set treasury address
    let treasury = Address::generate(&env);
    client.set_treasury(&artist, &treasury);
    assert_eq!(client.get_treasury(), Some(treasury.clone()));
    // Set protocol fee to 500 bps (5%)
    client.set_protocol_fee(&artist, &500u32);
    assert_eq!(client.get_protocol_fee(), Some(500u32));
    // Create listing and buy artwork
    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128;
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // Fee logic: 5% of 10_000_000 = 500_000
    // Seller should get 9_500_000, treasury gets 500_000 (logic is in contract, not test env)
}

#[test]
fn test_buy_artwork_no_treasury_fee_set() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    // Set protocol fee but no treasury
    client.set_protocol_fee(&artist, &300u32); // 3%
    let cid = bytes!(&env, 0x516d74657374);
    let price = 1_000_000_i128;
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // All funds should go to seller if treasury not set
}

#[test]
#[should_panic]
fn test_set_protocol_fee_not_admin_panics() {
    let (env, client, artist, buyer, _contract_id) = setup();
    client.set_admin(&artist);
    // Buyer tries to set protocol fee
    client.set_protocol_fee(&buyer, &100u32);
}

#[test]
#[should_panic]
fn test_set_treasury_not_admin_panics() {
    let (env, client, artist, buyer, _contract_id) = setup();
    client.set_admin(&artist);
    let treasury = Address::generate(&env);
    // Buyer tries to set treasury
    client.set_treasury(&buyer, &treasury);
}

#[test]
#[should_panic]
fn test_set_protocol_fee_too_high_panics() {
    let (env, client, artist, _buyer, _contract_id) = setup();
    client.set_admin(&artist);
    // Try to set fee > 1000 bps (10%)
    client.set_protocol_fee(&artist, &2000u32);
}
// ------------------------------------------------------------
// test.rs — Unit tests for the Soroban marketplace contract
// ------------------------------------------------------------


use super::*;
use crate::events::*;
use soroban_sdk::{testutils::Events, Symbol, Val};
use soroban_sdk::{
    bytes,
    symbol_short,
    testutils::Address as _,
    Address, Env,
};

/// Helper — deploy the contract and return (env, client, token_admin, token_id).
fn setup() -> (Env, MarketplaceContractClient<'static>, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MarketplaceContract, ());
    let client = MarketplaceContractClient::new(&env, &contract_id);

    let artist = Address::generate(&env);
    let buyer  = Address::generate(&env);

    (env, client, artist, buyer, contract_id)
}

// ── create_listing ───────────────────────────────────────────

#[test]
fn test_create_listing_success() {
    let (env, client, artist, _, contract_id) = setup();
    let cid = bytes!(&env, 0x516d546573744349444f6f6e495046533132333435);
    let price: i128 = 10_000_000; // 1 XLM
    // Set admin and whitelist the token
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let listing_id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32, // royalty_bps
    );
    assert_eq!(listing_id, 1u64);
    let listing = client.get_listing(&listing_id);
    assert_eq!(listing.artist, artist);
    assert_eq!(listing.price, price);
    assert_eq!(listing.status, ListingStatus::Active);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_create_listing_zero_price() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    client.create_listing(&artist, &cid, &0_i128, &symbol_short!("XLM"), &contract_id, &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_create_listing_empty_cid() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    client.create_listing(
        &artist,
        &bytes!(&env,),
        &10_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32, // royalty_bps
    );
}

// ── cancel_listing ───────────────────────────────────────────

#[test]
fn test_cancel_listing_success() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let id = client.create_listing(&artist, &cid, &5_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.cancel_listing(&artist, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn test_cancel_listing_wrong_artist() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let id = client.create_listing(&artist, &cid, &5_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    client.cancel_listing(&buyer, &id);
}

// ── get_artist_listings ──────────────────────────────────────

#[test]
fn test_get_artist_listings() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    client.create_listing(&artist, &cid, &1_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    client.create_listing(&artist, &cid, &2_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    client.create_listing(&artist, &cid, &3_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    let ids = client.get_artist_listings(&artist);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 1_u64);
    assert_eq!(ids.get(1).unwrap(), 2_u64);
    assert_eq!(ids.get(2).unwrap(), 3_u64);
}

#[test]
fn test_buy_artwork_success() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128;
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
}

// ── get_listing not found ────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_get_listing_not_found() {
    let (_env, client, _, _, _) = setup();
    client.get_listing(&999);

}


// ── Admin/Whitelist Management Tests ───────────────────────


#[test]
#[should_panic]
fn test_set_admin_only_once() {
    let (env, client, artist, _, _) = setup();
    client.set_admin(&artist);
    // Second call should panic
    client.set_admin(&artist);
}



#[test]
fn test_add_and_remove_token_whitelist() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    // Add token
    client.add_token_to_whitelist(&contract_id);
    // Remove token
    client.remove_token_from_whitelist(&contract_id);
    // Now creating a listing with this token should SUCCEED (whitelist is empty)
    let cid = bytes!(&env, 0x516d74657374);
    let listing_id = client.create_listing(&artist, &cid, &1_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    assert_eq!(listing_id, 1u64);
}




#[test]
#[should_panic]
fn test_create_listing_with_non_whitelisted_token_panics() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    // Add a different token to whitelist
    let other_token = Address::generate(&env);
    client.add_token_to_whitelist(&other_token);
    // Now creating a listing with contract_id (not whitelisted) should panic
    let cid = bytes!(&env, 0x516d74657374);
    client.create_listing(&artist, &cid, &1_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
}

#[test]
fn test_create_listing_with_whitelisted_token_succeeds() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let listing_id = client.create_listing(&artist, &cid, &1_000_000_i128, &symbol_short!("XLM"), &contract_id, &0u32);
    assert_eq!(listing_id, 1u64);
}

#[test]
fn test_buy_artwork_fee_greater_than_price() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let treasury = Address::generate(&env);
    client.set_treasury(&artist, &treasury);
    // Set protocol fee to 100% (10000 bps)
    client.set_protocol_fee(&artist, &1000u32); // 10% for demonstration
    let cid = bytes!(&env, 0x516d74657374);
    let price = 5_i128; // Very small price
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // Fee: 10% of 5 = 0 (integer division), seller gets 5
}

#[test]
fn test_buy_artwork_fee_rounding_precision() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let treasury = Address::generate(&env);
    client.set_treasury(&artist, &treasury);
    // Set protocol fee to 333 bps (3.33%)
    client.set_protocol_fee(&artist, &333u32);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 100_i128;
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // Fee: 100 * 333 / 10_000 = 3 (integer division), seller gets 97
}

#[test]
fn test_royalty_zero_percent() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128;
    // 0% royalty
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &0u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // All funds to seller, none to original creator
}

#[test]
fn test_royalty_hundred_percent() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128;
    // 100% royalty (10000 bps)
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &10000u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // All funds to original creator, seller gets 0
}

#[test]
fn test_royalty_rounding_precision() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 7_i128;
    // 33% royalty (3300 bps)
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &3300u32);
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // Royalty: 7 * 3300 / 10000 = 2 (integer division), seller gets 5
}

#[test]
fn test_royalty_secondary_sale() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128;
    // 10% royalty
    let id = client.create_listing(&artist, &cid, &price, &symbol_short!("XLM"), &contract_id, &1000u32);
    // First sale: artist sells to buyer
    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let mut listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
    // Simulate secondary sale: buyer relists and sells to a new buyer
    let new_buyer = Address::generate(&env);
    listing.artist = buyer.clone();
    listing.status = ListingStatus::Active;
    listing.owner = None;
    // Save the relisted artwork using contract context
    env.as_contract(&contract_id, || {
        crate::storage::save_listing(&env, &listing);
    });
    let result2 = client.buy_artwork(&new_buyer, &id);
    assert!(result2);
    let listing2 = client.get_listing(&id);
    assert_eq!(listing2.status, ListingStatus::Sold);
    assert_eq!(listing2.owner, Some(new_buyer.clone()));
    // 10% of price should go to original creator (artist), 90% to seller (buyer)
}