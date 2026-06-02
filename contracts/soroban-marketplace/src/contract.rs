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
        acquire_auction_lock, acquire_listing_lock, add_artist_auction_id, add_artist_listing_id,
        clear_pending_admin_storage, get_artist_auction_ids, get_artist_listing_ids,
        get_listing_count, get_pending_admin_storage, increment_auction_count,
        increment_listing_count, increment_offer_count, is_artist_revoked_storage, load_auction,
        load_listing, load_listing_offers, load_offer, load_offerer_offers, release_auction_lock,
        release_listing_lock, remove_artist_revocation_storage, save_auction, save_listing,
        save_listing_offers, save_offer, save_offerer_offers, set_artist_revocation_storage,
        set_pending_admin_storage, get_auction_count,
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

    /// Step 1 of a 2-step admin transfer: the current admin proposes a successor.
    /// The successor must call `accept_admin` to complete the handover.
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) {
        current_admin.require_auth();
        let stored_admin = Self::get_admin(env.clone())
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::Unauthorized));
        if current_admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        set_pending_admin_storage(&env, &new_admin);
        crate::events::AdminTransferProposedEvent {
            current_admin,
            proposed_admin: new_admin,
        }
        .publish(&env);
    }

    /// Step 2 of a 2-step admin transfer: the proposed new admin accepts the role.
    pub fn accept_admin(env: Env, new_admin: Address) {
        new_admin.require_auth();
        let pending = get_pending_admin_storage(&env)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::Unauthorized));
        if new_admin != pending {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        let old_admin = Self::get_admin(env.clone())
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::Unauthorized));
        let key = crate::storage::DataKey::Admin;
        env.storage().persistent().set(&key, &new_admin);
        env.storage().persistent().extend_ttl(
            &key,
            crate::storage::LEDGER_TTL_THRESHOLD,
            crate::storage::LEDGER_TTL_BUMP,
        );
        clear_pending_admin_storage(&env);
        crate::events::AdminTransferredEvent {
            old_admin,
            new_admin,
        }
        .publish(&env);
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

    // ── Pause/Unpause Mechanism ────────────────────────────

    pub fn admin_pause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(env.clone()).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        crate::storage::set_paused(&env, true);
        #[allow(deprecated)]
        env.events().publish((crate::events::CONTRACT_PAUSED,), ());
    }

    pub fn admin_unpause(env: Env, admin: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(env.clone()).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        crate::storage::set_paused(&env, false);
        #[allow(deprecated)]
        env.events()
            .publish((crate::events::CONTRACT_UNPAUSED,), ());
    }

    pub fn is_paused(env: Env) -> bool {
        crate::storage::is_paused(&env)
    }

    // ── Artist Moderation ───────────────────────────────────

    pub fn revoke_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        set_artist_revocation_storage(&env, &artist);
        #[allow(deprecated)]
        env.events()
            .publish((crate::events::ARTIST_REVOKED,), artist);
    }

    pub fn reinstate_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        remove_artist_revocation_storage(&env, &artist);
        #[allow(deprecated)]
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

    pub fn get_token_whitelist(env: Env) -> Vec<Address> {
        let key = crate::storage::DataKey::TokenWhitelist;
        env.storage()
            .persistent()
            .get::<_, Vec<Address>>(&key)
            .unwrap_or(Vec::new(&env))
    }

    // ── Listing methods ──────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
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
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        artist.require_auth();
        if Self::is_artist_revoked(env.clone(), artist.clone()) {
            panic_with_error!(&env, MarketplaceError::ArtistRevoked);
        }
        if metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if price <= 0 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }

                // Validate royalty bps — must not exceed 10000 (100%). Reject explicitly.
                if royalty_bps > 10_000 {
                    panic_with_error!(&env, MarketplaceError::InvalidRoyalty);
        }

                let recipients_len = recipients.len();
                // Empty recipient arrays are an invalid split configuration; reject with InvalidSplit.
                if recipients_len == 0 {
                    panic_with_error!(&env, MarketplaceError::InvalidSplit);
                }
                if recipients_len > 4 {
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
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
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

        if new_metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if new_price <= 0 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }
        if !Self::is_token_whitelisted(&env, &new_token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        let new_recipients_len = new_recipients.len();
                if new_recipients_len == 0 {
                    panic_with_error!(&env, MarketplaceError::InvalidSplit);
        }
                if new_recipients_len > 4 {
                    panic_with_error!(&env, MarketplaceError::TooManyRecipients);
                }
                let mut total_pct = 0u32;
        for i in 0..new_recipients_len {
            total_pct += new_recipients.get(i).unwrap().percentage;
        }
        if total_pct != 100 {
            panic_with_error!(&env, MarketplaceError::InvalidSplit);
        }

        listing.metadata_cid = new_metadata_cid.clone();
        listing.price = new_price;
        listing.token = new_token;
        listing.recipients = new_recipients;

        save_listing(&env, &listing);

        ListingUpdatedEvent {
            listing_id,
            artist: artist.clone(),
            new_price,
            metadata_cid: new_metadata_cid,
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);

        true
    }

    pub fn buy_artwork(env: Env, buyer: Address, listing_id: u64) -> bool {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        buyer.require_auth();

        // Reentrancy guard
        if !acquire_listing_lock(&env, listing_id) {
            panic_with_error!(&env, MarketplaceError::ReentrancyGuard);
        }

        let mut listing = match load_listing(&env, listing_id) {
            Some(l) => l,
            None => {
                release_listing_lock(&env, listing_id);
                panic_with_error!(&env, MarketplaceError::ListingNotFound);
            }
        };

        // Status checks
        if listing.status == ListingStatus::Sold {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::ListingSold);
        }
        if listing.status == ListingStatus::Cancelled {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::ListingCancelled);
        }
        if listing.status != ListingStatus::Active {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }
        if listing.artist == buyer {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::CannotBuyOwnListing);
        }

        // Ensure token is still whitelisted at purchase time. If it was removed after listing creation, block the purchase.
                if !Self::is_token_whitelisted(&env, &listing.token) {
                    release_listing_lock(&env, listing_id);
                    panic_with_error!(&env, MarketplaceError::TokenNotWhitelisted);
                }

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

        listing.status = ListingStatus::Sold;
        listing.owner = Some(buyer.clone());
        save_listing(&env, &listing);

        ArtworkSoldEvent {
            listing_id,
            artist: listing.artist.clone(),
            buyer: buyer.clone(),
            price: listing.price,
            currency: listing.currency.clone(),
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);

        // Reject all pending offers
        let offers = load_listing_offers(&env, listing_id);
        for offer_id in offers.iter() {
            if let Some(mut offer) = load_offer(&env, offer_id) {
                if offer.status == OfferStatus::Pending {
                    TokenClient::new(&env, &offer.token).transfer(
                        &env.current_contract_address(),
                        &offer.offerer,
                        &offer.amount,
                    );
                    offer.status = OfferStatus::Rejected;
                    save_offer(&env, &offer);
                }
            }
        }

        release_listing_lock(&env, listing_id);
        true
    }

    pub fn cancel_listing(env: Env, artist: Address, listing_id: u64) -> bool {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
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
            if let Some(mut offer) = load_offer(&env, offer_id) {
                if offer.status == OfferStatus::Pending {
                    TokenClient::new(&env, &offer.token).transfer(
                        &env.current_contract_address(),
                        &offer.offerer,
                        &offer.amount,
                    );
                    offer.status = OfferStatus::Rejected;
                    save_offer(&env, &offer);
                }
            }
        }

        listing.status = ListingStatus::Cancelled;
        save_listing(&env, &listing);

        ListingCancelledEvent {
            listing_id,
            artist: artist.clone(),
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);

        true
    }

    #[allow(clippy::too_many_arguments)]
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
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        creator.require_auth();
        if Self::is_artist_revoked(env.clone(), creator.clone()) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if metadata_cid.is_empty() || reserve_price <= 0 {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if !Self::is_token_whitelisted(&env, &token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
                // Validate royalty bps — must not exceed 10000 (100%). Reject explicitly.
                if royalty_bps > 10_000 {
                    panic_with_error!(&env, MarketplaceError::InvalidRoyalty);
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

        AuctionCreatedEvent {
            auction_id,
            creator: creator.clone(),
            reserve_price,
            token: token.clone(),
            end_time,
        }
        .publish(&env);

        auction_id
    }

    pub fn place_bid(env: Env, bidder: Address, auction_id: u64, amount: i128) {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
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

        let token_client = TokenClient::new(&env, &auction.token);
        if let Some(prev) = auction.highest_bidder.clone() {
            token_client.transfer(&env.current_contract_address(), &prev, &auction.highest_bid);
        }
        token_client.transfer(&bidder, &env.current_contract_address(), &amount);
        auction.highest_bid = amount;
        auction.highest_bidder = Some(bidder.clone());
        save_auction(&env, &auction);

        BidPlacedEvent {
            auction_id,
            bidder: bidder.clone(),
            bid_amount: amount,
        }
        .publish(&env);
    }

    pub fn finalize_auction(env: Env, caller: Address, auction_id: u64) {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        caller.require_auth();

        // Reentrancy guard
        if !acquire_auction_lock(&env, auction_id) {
            panic_with_error!(&env, MarketplaceError::ReentrancyGuard);
        }

        let mut auction = match load_auction(&env, auction_id) {
            Some(a) => a,
            None => {
                release_auction_lock(&env, auction_id);
                panic_with_error!(&env, MarketplaceError::AuctionNotFound);
            }
        };

        // Status check
        if auction.status != AuctionStatus::Active {
            release_auction_lock(&env, auction_id);
            panic_with_error!(&env, MarketplaceError::AuctionAlreadyFinalized);
        }

        // Time check
        if env.ledger().timestamp() < auction.end_time {
            if caller != auction.creator {
                release_auction_lock(&env, auction_id);
                panic_with_error!(&env, MarketplaceError::Unauthorized);
            }
        }

        let (finalized_winner, finalized_amount) =
            if let Some(ref winner) = auction.highest_bidder.clone() {
                Self::distribute_payout(
                    &env,
                    &auction.token,
                    auction.highest_bid,
                    &auction.original_creator,
                    auction.royalty_bps,
                    &auction.creator,
                    &auction.recipients,
                    winner,
                    false,
                );
                auction.status = AuctionStatus::Finalized;
                (Some(winner.clone()), auction.highest_bid)
            } else {
                auction.status = AuctionStatus::Cancelled;
                (None, 0)
            };

        save_auction(&env, &auction);
        release_auction_lock(&env, auction_id);

        AuctionFinalizedEvent {
            auction_id,
            winner: finalized_winner,
            amount: finalized_amount,
        }
        .publish(&env);
    }

    pub fn make_offer(
        env: Env,
        offerer: Address,
        listing_id: u64,
        amount: i128,
        token: Address,
    ) -> u64 {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
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
        TokenClient::new(&env, &token).transfer(&offerer, &env.current_contract_address(), &amount);
        let offer_id = increment_offer_count(&env);
        save_offer(
            &env,
            &Offer {
                offer_id,
                listing_id,
                offerer: offerer.clone(),
                amount,
                token: token.clone(),
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

        OfferMadeEvent {
            offer_id,
            listing_id,
            offerer: offerer.clone(),
            amount,
            token,
        }
        .publish(&env);

        offer_id
    }

    pub fn withdraw_offer(env: Env, offerer: Address, offer_id: u64) {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        offerer.require_auth();
        let mut offer = load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound));
        if offer.offerer != offerer {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending {
            panic_with_error!(&env, MarketplaceError::OfferNotPending);
        }
        TokenClient::new(&env, &offer.token).transfer(
            &env.current_contract_address(),
            &offerer,
            &offer.amount,
        );
        offer.status = OfferStatus::Withdrawn;
        save_offer(&env, &offer);

        OfferWithdrawnEvent {
            offer_id,
            listing_id: offer.listing_id,
            offerer: offerer.clone(),
        }
        .publish(&env);
    }

    pub fn reject_offer(env: Env, artist: Address, offer_id: u64) {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
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
        TokenClient::new(&env, &offer.token).transfer(
            &env.current_contract_address(),
            &offer.offerer,
            &offer.amount,
        );
        offer.status = OfferStatus::Rejected;
        save_offer(&env, &offer);

        OfferRejectedEvent {
            offer_id,
            listing_id: offer.listing_id,
            offerer: offer.offerer.clone(),
        }
        .publish(&env);
    }

    pub fn accept_offer(env: Env, artist: Address, offer_id: u64) {
        if crate::storage::is_paused(&env) {
            panic_with_error!(&env, MarketplaceError::ContractPaused);
        }
        artist.require_auth();
        let mut offer = load_offer(&env, offer_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::OfferNotFound));
        let listing_id = offer.listing_id;

        // Reentrancy guard (same listing lock as buy_artwork)
        if !acquire_listing_lock(&env, listing_id) {
            panic_with_error!(&env, MarketplaceError::ReentrancyGuard);
        }

        let mut listing = match load_listing(&env, listing_id) {
            Some(l) => l,
            None => {
                release_listing_lock(&env, listing_id);
                panic_with_error!(&env, MarketplaceError::ListingNotFound);
            }
        };
        if listing.artist != artist {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending || listing.status != ListingStatus::Active {
            release_listing_lock(&env, listing_id);
            panic_with_error!(&env, MarketplaceError::OfferNotPending);
        }
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
        let accepted_offerer = offer.offerer.clone();
        let accepted_amount = offer.amount;
        let accepted_listing_id = offer.listing_id;
        offer.status = OfferStatus::Accepted;
        save_offer(&env, &offer);
        listing.status = ListingStatus::Sold;
        listing.owner = Some(accepted_offerer.clone());
        save_listing(&env, &listing);

        OfferAcceptedEvent {
            offer_id,
            listing_id: accepted_listing_id,
            offerer: accepted_offerer.clone(),
            amount: accepted_amount,
        }
        .publish(&env);

        let offers = load_listing_offers(&env, listing.listing_id);
        for oid in offers.iter() {
            if oid != offer_id {
                if let Some(mut other) = load_offer(&env, oid) {
                    if other.status == OfferStatus::Pending {
                        TokenClient::new(&env, &other.token).transfer(
                            &env.current_contract_address(),
                            &other.offerer,
                            &other.amount,
                        );
                        other.status = OfferStatus::Rejected;
                        save_offer(&env, &other);
                    }
                }
            }
        }

        release_listing_lock(&env, listing_id);
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

    pub fn get_total_auctions(env: Env) -> u64 {
        get_auction_count(&env)
    }

    pub fn get_artist_auctions(env: Env, artist: Address) -> Vec<u64> {
        get_artist_auction_ids(&env, &artist)
    }

    pub fn get_active_listings(env: Env, limit: u32, offset: u32) -> Vec<u64> {
        let total = get_listing_count(&env);
        let mut active_ids = Vec::new(&env);
        let start = offset as u64;
        let end = (offset as u64 + limit as u64).min(total);

        for i in start..end {
            if let Some(listing) = load_listing(&env, i + 1) {
                if listing.status == ListingStatus::Active {
                    active_ids.push_back(i + 1);
                }
            }
        }
        active_ids
    }

    pub fn get_offers_by_listing(env: Env, listing_id: u64) -> Vec<Offer> {
        let offer_ids = load_listing_offers(&env, listing_id);
        let mut offers = Vec::new(&env);

        for offer_id in offer_ids.iter() {
            if let Some(offer) = load_offer(&env, offer_id) {
                offers.push_back(offer);
            }
        }
        offers
    }

    pub fn get_listing_status(env: Env, listing_id: u64) -> ListingStatus {
        let listing = load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound));
        listing.status
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
            token.transfer(buyer, env.current_contract_address(), &amount);
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
