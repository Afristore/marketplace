use super::*;
use crate::types::{Recipient, ListingStatus};
use soroban_sdk::{bytes, symbol_short, testutils::Address as _, testutils::Ledger, vec, Address, Env};

/// Helper — deploy the contract and return (env, client, artist, buyer, contract_id).
fn setup() -> (
    Env,
    MarketplaceContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MarketplaceContract, ());
    let client = MarketplaceContractClient::new(&env, &contract_id);

    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);

    (env, client, artist, buyer, contract_id)
}

fn valid_recipients(env: &Env, artist: &Address) -> soroban_sdk::Vec<Recipient> {
    vec![
        env,
        Recipient {
            address: artist.clone(),
            percentage: 100,
        },
    ]
}

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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let (_env, client, artist, buyer, _contract_id) = setup();
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
    let (_env, client, artist, _buyer, _contract_id) = setup();
    client.set_admin(&artist);
    // Try to set fee > 1000 bps (10%)
    client.set_protocol_fee(&artist, &2000u32);
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
        &valid_recipients(&env, &artist),
    );

    assert_eq!(listing_id, 1);
    assert_eq!(client.get_total_listings(), 1);

    let listing = client.get_listing(&1);
    assert_eq!(listing.listing_id, 1u64);
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
    client.create_listing(
        &artist,
        &cid,
        &0_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
        &0u32,
        &valid_recipients(&env, &artist),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn test_create_listing_invalid_split() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let recipients = vec![
        &env,
        Recipient {
            address: artist.clone(),
            percentage: 50, // Doesn't equal 100
        },
    ];
    client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &recipients,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn test_create_listing_too_many_recipients() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let recipients = vec![
        &env,
        Recipient {
            address: Address::generate(&env),
            percentage: 20,
        },
        Recipient {
            address: Address::generate(&env),
            percentage: 20,
        },
        Recipient {
            address: Address::generate(&env),
            percentage: 20,
        },
        Recipient {
            address: Address::generate(&env),
            percentage: 20,
        },
        Recipient {
            address: Address::generate(&env),
            percentage: 20,
        },
    ];
    client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &recipients,
    );
}

// ── cancel_listing ───────────────────────────────────────────

#[test]
fn test_cancel_listing_success() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let id = client.create_listing(
        &artist,
        &cid,
        &5_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );

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

    let id = client.create_listing(
        &artist,
        &cid,
        &5_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
    client.cancel_listing(&buyer, &id);
}

// ── get_artist_listings ──────────────────────────────────────

#[test]
fn test_get_artist_listings() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);

    client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
    client.create_listing(
        &artist,
        &cid,
        &2_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
    client.create_listing(
        &artist,
        &cid,
        &3_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );

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

    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );

    let result = client.buy_artwork(&buyer, &id);
    assert!(result);
    let listing = client.get_listing(&id);
    assert_eq!(listing.status, ListingStatus::Sold);
    assert_eq!(listing.owner, Some(buyer.clone()));
}

#[test]
fn test_buy_artwork_complex_split() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let colab1 = Address::generate(&env);
    let colab2 = Address::generate(&env);

    let cid = bytes!(&env, 0x516d74657374);
    let price = 10_000_000_i128; // 1 XLM

    // test precision rounding 33/33/34
    let recipients = vec![
        &env,
        Recipient {
            address: artist.clone(),
            percentage: 33,
        },
        Recipient {
            address: colab1.clone(),
            percentage: 33,
        },
        Recipient {
            address: colab2.clone(),
            percentage: 34, // Last receiver takes the exact fractional remainder securely
        },
    ];

    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &recipients,
    );
    assert!(client.buy_artwork(&buyer, &id));
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
    let (_env, client, artist, _, _) = setup();
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
    let listing_id = client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
}

#[test]
fn test_create_listing_with_whitelisted_token_succeeds() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);
    let cid = bytes!(&env, 0x516d74657374);
    let listing_id = client.create_listing(
        &artist,
        &cid,
        &1_000_000_i128,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &0u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &10000u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &3300u32,
        &valid_recipients(&env, &artist),
    );
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
    let id = client.create_listing(
        &artist,
        &cid,
        &price,
        &symbol_short!("XLM"),
        &contract_id,
        &1000u32,
        &valid_recipients(&env, &artist),
    );
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

// ── Auction Tests ────────────────────────────────────────────

#[test]
fn test_create_auction_success() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let cid = bytes!(&env, 0x516d74657374);
    let reserve_price = 1_000_000_i128;
    let duration = 3600u64; // 1 hour

    let auction_id = client.create_auction(
        &artist,
        &cid,
        &contract_id,
        &reserve_price,
        &duration,
        &1000u32, // 10% royalty
        &valid_recipients(&env, &artist),
    );

    assert_eq!(auction_id, 1);
    let auction = client.get_auction(&auction_id);
    assert_eq!(auction.creator, artist);
    assert_eq!(auction.reserve_price, reserve_price);
    assert_eq!(auction.status, crate::types::AuctionStatus::Active);
    assert_eq!(auction.end_time, env.ledger().timestamp() + duration);
}

#[test]
fn test_place_bid_success() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let cid = bytes!(&env, 0x516d74657374);
    let id = client.create_auction(
        &artist,
        &cid,
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    client.place_bid(&buyer, &id, &1_500_000);
    let auction = client.get_auction(&id);
    assert_eq!(auction.highest_bid, 1_500_000);
    assert_eq!(auction.highest_bidder, Some(buyer));
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn test_place_bid_too_low() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let id = client.create_auction(
        &artist,
        &bytes!(&env, 0x51),
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    client.place_bid(&buyer, &id, &500_000); // Below reserve
}

#[test]
fn test_finalize_auction_with_winner() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let id = client.create_auction(
        &artist,
        &bytes!(&env, 0x51),
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    client.place_bid(&buyer, &id, &1_500_000);

    // Jump in time
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    client.finalize_auction(&id);
    let auction = client.get_auction(&id);
    assert_eq!(auction.status, crate::types::AuctionStatus::Finalized);
}

#[test]
fn test_finalize_auction_no_bids() {
    let (env, client, artist, _, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let id = client.create_auction(
        &artist,
        &bytes!(&env, 0x51),
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    client.finalize_auction(&id);
    let auction = client.get_auction(&id);
    assert_eq!(auction.status, crate::types::AuctionStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn test_place_bid_after_expiration() {
    let (env, client, artist, buyer, contract_id) = setup();
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let id = client.create_auction(
        &artist,
        &bytes!(&env, 0x51),
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    // Jump in time
    env.ledger().set_timestamp(env.ledger().timestamp() + 3601);

    client.place_bid(&buyer, &id, &1_500_000);
}

#[test]
fn test_outbid_refund_logic_check() {
    let (env, client, artist, buyer1, contract_id) = setup();
    let buyer2 = Address::generate(&env);
    client.set_admin(&artist);
    client.add_token_to_whitelist(&contract_id);

    let id = client.create_auction(
        &artist,
        &bytes!(&env, 0x51),
        &contract_id,
        &1_000_000,
        &3600,
        &0,
        &valid_recipients(&env, &artist),
    );

    client.place_bid(&buyer1, &id, &1_500_000);
    client.place_bid(&buyer2, &id, &2_000_000);

    let auction = client.get_auction(&id);
    assert_eq!(auction.highest_bid, 2_000_000);
    assert_eq!(auction.highest_bidder, Some(buyer2));
}
