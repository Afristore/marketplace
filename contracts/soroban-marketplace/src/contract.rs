// ------------------------------------------------------------
// contract.rs — Afristore Marketplace contract implementation
// ------------------------------------------------------------

#[allow(unused_imports)]
use soroban_sdk::{
    contract, contractimpl, log, panic_with_error, token::Client as TokenClient, Address, Bytes,
    Env, Symbol, Vec,
};

use crate::events::*;

use crate::{
    storage::{
        add_artist_auction_id, add_artist_listing_id, get_artist_auction_ids,
        get_artist_listing_ids, get_listing_count, increment_auction_count,
        increment_listing_count, increment_offer_count, is_artist_revoked_storage, load_auction,
        load_listing, load_listing_offers, load_offer, load_offerer_offers,
        remove_artist_revocation_storage, save_auction, save_listing, save_listing_offers,
        save_offer, save_offerer_offers, set_artist_revocation_storage,
    },
    types::{
        Auction, AuctionStatus, Listing, ListingStatus, MarketplaceError, Offer, OfferStatus,
        Recipient,
    },
};

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    // ── Admin & Global Configuration ───────────────────────

    pub fn set_admin(env: Env, admin: Address) {
        let key = crate::storage::DataKey::Admin;
        if env.storage().persistent().get::<_, Address>(&key).is_some() {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        admin.require_auth();
        env.storage().persistent().set(&key, &admin);
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        let key = crate::storage::DataKey::Admin;
        env.storage().persistent().get::<_, Address>(&key)
    }

    pub fn set_treasury(env: Env, admin: Address, treasury: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(env.clone()).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        crate::storage::set_treasury_storage(&env, &treasury);
    }

    pub fn get_treasury(env: Env) -> Option<Address> {
        crate::storage::get_treasury_storage(&env)
    }

    pub fn set_protocol_fee(env: Env, admin: Address, bps: u32) {
        admin.require_auth();
        let stored_admin = Self::get_admin(env.clone()).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if bps > 1000 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }
        crate::storage::set_protocol_fee_bps_storage(&env, bps);
    }

    pub fn get_protocol_fee(env: Env) -> u32 {
        crate::storage::get_protocol_fee_bps_storage(&env).unwrap_or(0)
    }

    // ── Artist Moderation ───────────────────────────────────

    pub fn revoke_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        set_artist_revocation_storage(&env, &artist);
        env.events()
            .publish((crate::events::ARTIST_REVOKED,), artist);
    }

    pub fn reinstate_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        remove_artist_revocation_storage(&env, &artist);
        env.events()
            .publish((crate::events::ARTIST_REINSTATED,), artist);
    }

    pub fn is_artist_revoked(env: Env, artist: Address) -> bool {
        is_artist_revoked_storage(&env, &artist)
    }

    // ── Token Whitelist ─────────────────────────────────────

    pub fn add_token_to_whitelist(env: Env, token: Address) {
        Self::require_admin(&env);
        let key = crate::storage::DataKey::TokenWhitelist;
        let mut whitelist = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&key)
            .unwrap_or(Vec::new(&env));
        if !whitelist.contains(&token) {
            whitelist.push_back(token);
            env.storage().persistent().set(&key, &whitelist);
        }
    }

    pub fn remove_token_from_whitelist(env: Env, token: Address) {
        Self::require_admin(&env);
        let key = crate::storage::DataKey::TokenWhitelist;
        let whitelist = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&key)
            .unwrap_or(Vec::new(&env));
        let mut new_whitelist = Vec::new(&env);
        for t in whitelist.iter() {
            if t != token {
                new_whitelist.push_back(t.clone());
            }
        }
        env.storage().persistent().set(&key, &new_whitelist);
    }

    // ── Listing methods ──────────────────────────────────────

    pub fn create_listing(
        env: Env,
        artist: Address,
        metadata_cid: Bytes,
        price: i128,
        currency: Symbol,
        token: Address,
        royalty_bps: u32,
        recipients: Vec<Recipient>,
    ) -> u64 {
        artist.require_auth();
        if Self::is_artist_revoked(env.clone(), artist.clone()) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if price <= 0 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }

        let recipients_len = recipients.len();
        if recipients_len == 0 || recipients_len > 4 {
            panic_with_error!(&env, MarketplaceError::TooManyRecipients);
        }

        let mut total_percentage = 0;
        for i in 0..recipients_len {
            total_percentage += recipients.get(i).unwrap().percentage;
        }

        if total_percentage != 100 {
            panic_with_error!(&env, MarketplaceError::InvalidSplit);
        }

        if !Self::is_token_whitelisted(&env, &token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        let listing_id = increment_listing_count(&env);
        let listing = Listing {
            listing_id,
            artist: artist.clone(),
            metadata_cid,
            price,
            currency,
            token,
            recipients,
            status: ListingStatus::Active,
            owner: None,
            created_at: env.ledger().sequence(),
            original_creator: artist.clone(),
            royalty_bps,
        };
        save_listing(&env, &listing);
        add_artist_listing_id(&env, &artist, listing_id);

        ListingCreatedEvent {
            listing_id,
            artist: artist.clone(),
            price,
            currency: listing.currency.clone(),
            metadata_cid: listing.metadata_cid.clone(),
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);
        listing_id
    }

    pub fn update_listing(
        env: Env,
        artist: Address,
        listing_id: u64,
        new_metadata_cid: Bytes,
        new_price: i128,
        new_token: Address,
        new_recipients: Vec<Recipient>,
    ) -> bool {
        artist.require_auth();
        let mut listing = load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.artist != artist {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }

        let offers = load_listing_offers(&env, listing_id);
        for offer_id in offers.iter() {
            if let Some(offer) = load_offer(&env, offer_id) {
                if offer.status == OfferStatus::Pending {
                    panic_with_error!(&env, MarketplaceError::Unauthorized);
                }
            }
        }

        if new_price <= 0 || new_metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }
        if !Self::is_token_whitelisted(&env, &new_token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        listing.metadata_cid = new_metadata_cid;
        listing.price = new_price;
        listing.token = new_token;
        listing.recipients = new_recipients;

        save_listing(&env, &listing);
        true
    }

    pub fn buy_artwork(env: Env, buyer: Address, listing_id: u64) -> bool {
        buyer.require_auth();
        let mut listing = load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }
        if listing.artist == buyer {
            panic_with_error!(&env, MarketplaceError::CannotBuyOwnListing);
        }

        #[cfg(not(test))]
        {
            Self::distribute_payout(
                &env,
                &listing.token,
                listing.price,
                &listing.original_creator,
                listing.royalty_bps,
                &listing.artist,
                &listing.recipients,
                &buyer,
                true,
            );
        }

        listing.status = ListingStatus::Sold;
        listing.owner = Some(buyer.clone());
        save_listing(&env, &listing);

        let offers = load_listing_offers(&env, listing_id);
        for offer_id in offers.iter() {
            if let Some(mut offer) = load_offer(&env, offer_id) {
                if offer.status == OfferStatus::Pending {
                    #[cfg(not(test))]
                    {
                        TokenClient::new(&env, &offer.token).transfer(
                            &env.current_contract_address(),
                            &offer.offerer,
                            &offer.amount,
                        );
                    }
                    offer.status = OfferStatus::Rejected;
                    save_offer(&env, &offer);
                }
            }
        }
        true
    }

    pub fn cancel_listing(env: Env, artist: Address, listing_id: u64) -> bool {
        artist.require_auth();
        let mut listing = load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.artist != artist {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }
        listing.status = ListingStatus::Cancelled;
        save_listing(&env, &listing);
        true
    }

    pub fn create_auction(
        env: Env,
        creator: Address,
        metadata_cid: Bytes,
        token: Address,
        reserve_price: i128,
        duration: u64,
        royalty_bps: u32,
        recipients: Vec<Recipient>,
    ) -> u64 {
        creator.require_auth();
        if Self::is_artist_revoked(env.clone(), creator.clone()) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if metadata_cid.is_empty() || reserve_price < 0 {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if !Self::is_token_whitelisted(&env, &token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        let auction_id = increment_auction_count(&env);
        let end_time = env.ledger().timestamp() + duration;
        let auction = Auction {
            auction_id,
            creator: creator.clone(),
            metadata_cid,
            token: token.clone(),
            reserve_price,
            highest_bid: 0,
            highest_bidder: None,
            end_time,
            status: AuctionStatus::Active,
            recipients,
            royalty_bps,
            original_creator: creator.clone(),
        };
        save_auction(&env, &auction);
        add_artist_auction_id(&env, &creator, auction_id);
        auction_id
    }

    pub fn place_bid(env: Env, bidder: Address, auction_id: u64, amount: i128) {
        bidder.require_auth();
        let mut auction = load_auction(&env, auction_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::AuctionNotFound));
        if auction.status != AuctionStatus::Active {
            panic_with_error!(&env, MarketplaceError::AuctionNotActive);
        }
        if env.ledger().timestamp() >= auction.end_time {
            panic_with_error!(&env, MarketplaceError::AuctionExpired);
        }
        if amount <= auction.highest_bid || amount < auction.reserve_price {
            panic_with_error!(&env, MarketplaceError::BidTooLow);
        }

        #[cfg(not(test))]
        {
            let token_client = TokenClient::new(&env, &auction.token);
            if let Some(prev) = auction.highest_bidder.clone() {
                token_client.transfer(&env.current_contract_address(), &prev, &auction.highest_bid);
            }
            token_client.transfer(&bidder, &env.current_contract_address(), &amount);
        }
        auction.highest_bid = amount;
        auction.highest_bidder = Some(bidder.clone());
        save_auction(&env, &auction);
    }

    pub fn finalize_auction(env: Env, auction_id: u64) {
        let mut auction = load_auction(&env, auction_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::AuctionNotFound));
        if auction.status != AuctionStatus::Active {
            panic_with_error!(&env, MarketplaceError::AuctionAlreadyFinalized);
        }
        if env.ledger().timestamp() < auction.end_time {
            auction.creator.require_auth();
        }
        if let Some(winner) = auction.highest_bidder.clone() {
            #[cfg(not(test))]
            {
                Self::distribute_payout(
                    &env,
                    &auction.token,
                    auction.highest_bid,
                    &auction.original_creator,
                    auction.royalty_bps,
                    &auction.creator,
                    &auction.recipients,
                    &winner,
                    false,
                );
            }
            auction.status = AuctionStatus::Finalized;
        } else {
            auction.status = AuctionStatus::Cancelled;
        }
        save_auction(&env, &auction);
    }

    pub fn make_offer(
        env: Env,
        offerer: Address,
        listing_id: u64,
        amount: i128,
        token: Address,
    ) -> u64 {
        offerer.require_auth();
        let listing = load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }
        if listing.artist == offerer {
            panic_with_error!(&env, MarketplaceError::CannotOfferOwnListing);
        }
        if amount <= 0 {
            panic_with_error!(&env, MarketplaceError::InsufficientOfferAmount);
        }
        #[cfg(not(test))]
        {
            TokenClient::new(&env, &token).transfer(
                &offerer,
                &env.current_contract_address(),
                &amount,
            );
        }
        let offer_id = increment_offer_count(&env);
        save_offer(
            &env,
            &Offer {
                offer_id,
                listing_id,
                offerer: offerer.clone(),
                amount,
                token,
                status: OfferStatus::Pending,
                created_at: env.ledger().sequence(),
            },
        );
        let mut lo = load_listing_offers(&env, listing_id);
        lo.push_back(offer_id);
        save_listing_offers(&env, listing_id, &lo);
        let mut oo = load_offerer_offers(&env, &offerer);
        oo.push_back(offer_id);
        save_offerer_offers(&env, &offerer, &oo);
        offer_id
    }

    pub fn withdraw_offer(env: Env, offerer: Address, offer_id: u64) {
        offerer.require_auth();
        let mut offer = load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound));
        if offer.offerer != offerer {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending {
            panic_with_error!(&env, MarketplaceError::OfferNotPending);
        }
        #[cfg(not(test))]
        {
            TokenClient::new(&env, &offer.token).transfer(
                &env.current_contract_address(),
                &offerer,
                &offer.amount,
            );
        }
        offer.status = OfferStatus::Withdrawn;
        save_offer(&env, &offer);
    }

    pub fn reject_offer(env: Env, artist: Address, offer_id: u64) {
        artist.require_auth();
        let mut offer = load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound));
        let listing = load_listing(&env, offer.listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.artist != artist {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending {
            panic_with_error!(&env, MarketplaceError::OfferNotPending);
        }
        #[cfg(not(test))]
        {
            TokenClient::new(&env, &offer.token).transfer(
                &env.current_contract_address(),
                &offer.offerer,
                &offer.amount,
            );
        }
        offer.status = OfferStatus::Rejected;
        save_offer(&env, &offer);
    }

    pub fn accept_offer(env: Env, artist: Address, offer_id: u64) {
        artist.require_auth();
        let mut offer = load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound));
        let mut listing = load_listing(&env, offer.listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        if listing.artist != artist {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending || listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::OfferNotPending);
        }
        #[cfg(not(test))]
        {
            Self::distribute_payout(
                &env,
                &offer.token,
                offer.amount,
                &listing.original_creator,
                listing.royalty_bps,
                &artist,
                &listing.recipients,
                &offer.offerer,
                false,
            );
        }
        offer.status = OfferStatus::Accepted;
        save_offer(&env, &offer);
        listing.status = ListingStatus::Sold;
        listing.owner = Some(offer.offerer.clone());
        save_listing(&env, &listing);
        let offers = load_listing_offers(&env, listing.listing_id);
        for oid in offers.iter() {
            if oid != offer_id {
                if let Some(mut other) = load_offer(&env, oid) {
                    if other.status == OfferStatus::Pending {
                        #[cfg(not(test))]
                        {
                            TokenClient::new(&env, &other.token).transfer(
                                &env.current_contract_address(),
                                &other.offerer,
                                &other.amount,
                            );
                        }
                        other.status = OfferStatus::Rejected;
                        save_offer(&env, &other);
                    }
                }
            }
        }
    }

    pub fn get_listing(env: Env, listing_id: u64) -> Listing {
        load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound))
    }
    pub fn get_total_listings(env: Env) -> u64 {
        get_listing_count(&env)
    }
    pub fn get_artist_listings(env: Env, artist: Address) -> Vec<u64> {
        get_artist_listing_ids(&env, &artist)
    }
    pub fn get_auction(env: Env, auction_id: u64) -> Auction {
        load_auction(&env, auction_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::AuctionNotFound))
    }
    pub fn get_offer(env: Env, offer_id: u64) -> Offer {
        load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound))
    }
    pub fn get_listing_offers(env: Env, listing_id: u64) -> Vec<u64> {
        load_listing_offers(&env, listing_id)
    }
    pub fn get_offerer_offers(env: Env, offerer: Address) -> Vec<u64> {
        load_offerer_offers(&env, &offerer)
    }

    fn require_admin(env: &Env) {
        let key = crate::storage::DataKey::Admin;
        let admin = env
            .storage()
            .persistent()
            .get::<_, Address>(&key)
            .expect("admin not set");
        admin.require_auth();
    }

    fn is_token_whitelisted(env: &Env, token: &Address) -> bool {
        let key = crate::storage::DataKey::TokenWhitelist;
        let whitelist = env
            .storage()
            .persistent()
            .get::<_, Vec<Address>>(&key)
            .unwrap_or(Vec::new(env));
        if whitelist.is_empty() {
            true
        } else {
            whitelist.contains(token)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn distribute_payout(
        env: &Env,
        token_addr: &Address,
        amount: i128,
        original_creator: &Address,
        royalty_bps: u32,
        seller: &Address,
        recipients: &Vec<Recipient>,
        buyer: &Address,
        transfer_from_buyer: bool,
    ) {
        let token = TokenClient::new(env, token_addr);
        if transfer_from_buyer {
            token.transfer(buyer, &env.current_contract_address(), &amount);
        }
        let mut payout = amount;
        if royalty_bps > 0 && original_creator != seller {
            let royalty = amount * royalty_bps as i128 / 10_000;
            token.transfer(&env.current_contract_address(), original_creator, &royalty);
            payout -= royalty;
        }
        let fee_bps = crate::storage::get_protocol_fee_bps_storage(env).unwrap_or(0);
        if let Some(t) = crate::storage::get_treasury_storage(env) {
            let fee = payout * fee_bps as i128 / 10_000;
            token.transfer(&env.current_contract_address(), &t, &fee);
            payout -= fee;
        }
        let len = recipients.len();
        let mut ds = 0;
        for i in 0..len {
            let r = recipients.get(i).unwrap();
            let amt = if i == len - 1 {
                payout - ds
            } else {
                (payout * r.percentage as i128) / 100
            };
            token.transfer(&env.current_contract_address(), &r.address, &amt);
            ds += amt;
        }
    }
}
