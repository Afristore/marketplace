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
        increment_listing_count, increment_offer_count, load_auction, load_listing,
        load_listing_offers, load_offer, load_offerer_offers, save_auction, save_listing,
        save_listing_offers, save_offer, save_offerer_offers,
    },
    types::{
        Auction, AuctionStatus, Listing, ListingStatus, MarketplaceError, Offer, OfferStatus,
        Recipient,
    },
};

// ────────────────────────────────────────────────────────────

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    /// Admin-only: Set the treasury address
    pub fn set_treasury(env: Env, admin: Address, treasury: Address) {
        admin.require_auth();
        let stored_admin = Self::get_admin(&env).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        crate::storage::set_treasury_storage(&env, &treasury);
    }

    /// Anyone can view the treasury address
    pub fn get_treasury(env: Env) -> Option<Address> {
        crate::storage::get_treasury_storage(&env)
    }

    /// Admin-only: Set the protocol fee (in basis points)
    pub fn set_protocol_fee(env: Env, admin: Address, bps: u32) {
        admin.require_auth();
        let stored_admin = Self::get_admin(&env).expect("admin not set");
        if admin != stored_admin {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if bps > 1000 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice); // Reuse error for now
        }
        crate::storage::set_protocol_fee_bps_storage(&env, bps);
    }

    /// Anyone can view the protocol fee (in basis points)
    pub fn get_protocol_fee(env: Env) -> Option<u32> {
        crate::storage::get_protocol_fee_bps_storage(&env)
    }
    // ── Admin/Whitelist Management ─────────────────────────

    /// Set the admin address (can only be set once)
    pub fn set_admin(env: Env, admin: Address) {
        let key = crate::storage::DataKey::Admin;
        if env.storage().persistent().get::<_, Address>(&key).is_some() {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        admin.require_auth();
        env.storage().persistent().set(&key, &admin);
    }

    /// Add a token to the whitelist (admin only)
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

    /// Remove a token from the whitelist (admin only)
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
                new_whitelist.push_back(t);
            }
        }
        env.storage().persistent().set(&key, &new_whitelist);
    }

    /// Revoke an artist's ability to create new listings (admin only)
    pub fn revoke_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        crate::storage::set_artist_revocation(&env, &artist, true);
        ArtistRevokedEvent { artist }.publish(&env);
    }

    /// Reinstate a revoked artist (admin only)
    pub fn reinstate_artist(env: Env, artist: Address) {
        Self::require_admin(&env);
        crate::storage::set_artist_revocation(&env, &artist, false);
        ArtistReinstatedEvent { artist }.publish(&env);
    }

    /// Internal: require that the caller is the admin
    fn require_admin(env: &Env) {
        let key = crate::storage::DataKey::Admin;
        let admin = env
            .storage()
            .persistent()
            .get::<_, Address>(&key)
            .expect("admin not set");
        admin.require_auth();
    }

    /// Internal: get admin address
    fn get_admin(env: &Env) -> Option<Address> {
        let key = crate::storage::DataKey::Admin;
        env.storage().persistent().get::<_, Address>(&key)
    }

    /// Check if a token is whitelisted (returns true if whitelist is empty)
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
    // ── create_listing ───────────────────────────────────────
    /// Artist creates a new listing.
    ///
    /// * `metadata_cid` — raw bytes of the IPFS CID string
    /// * `price`        — price in stroops (i128, must be > 0)
    /// * `currency`     — must be `Symbol::short("XLM")` for MVP
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
        if crate::storage::is_artist_revoked(&env, &artist) {
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
            let recipient = recipients.get(i).unwrap();
            total_percentage += recipient.percentage;
        }

        if total_percentage != 100 {
            panic_with_error!(&env, MarketplaceError::InvalidSplit);
        }

        if royalty_bps > 10000 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice); // Reuse error for now
        }
        // Whitelist check
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
        log!(
            &env,
            "Listing created: id={}, artist={}",
            listing_id,
            artist
        );

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

    // ── update_listing ───────────────────────────────────────
    /// Update an active listing (artist only).
    /// Now updated to support changing recipients and check for pending offers.
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

        let mut listing = load_listing(&env, listing_id).expect("Listing not found");
        if listing.artist != artist {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        if listing.status != ListingStatus::Active {
            panic_with_error!(&env, MarketplaceError::ListingNotActive);
        }

        // Check for pending offers
        let offers = load_listing_offers(&env, listing_id);
        for offer_id in offers.iter() {
            let offer = load_offer(&env, offer_id).unwrap();
            if offer.status == OfferStatus::Pending {
                panic_with_error!(&env, MarketplaceError::Unauthorized); // Should add more specific error maybe, but using Unauthorized for now
            }
        }

        if new_price <= 0 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }

        if new_metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }

        if !Self::is_token_whitelisted(&env, &new_token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        // Validate recipients
        let recipients_len = new_recipients.len();
        if recipients_len == 0 || recipients_len > 4 {
            panic_with_error!(&env, MarketplaceError::TooManyRecipients);
        }
        let mut total_percentage = 0;
        for i in 0..recipients_len {
            total_percentage += new_recipients.get(i).unwrap().percentage;
        }
        if total_percentage != 100 {
            panic_with_error!(&env, MarketplaceError::InvalidSplit);
        }

        listing.metadata_cid = new_metadata_cid;
        listing.price = new_price;
        listing.token = new_token;
        listing.recipients = new_recipients;

        save_listing(&env, &listing);

        ListingUpdatedEvent {
            listing_id,
            artist,
            new_price,
            metadata_cid: listing.metadata_cid.clone(),
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);

        true
    }

    // ── buy_artwork ──────────────────────────────────────────
    /// Buyer purchases an active listing by paying the listed price in XLM.
    ///
    /// The contract:
    /// 1. Validates the listing is Active.
    /// 2. Transfers `price` stroops from `buyer` → contract.
    /// 3. Transfers `price` stroops from contract → `artist`.
    /// 4. Marks the listing Sold and records the buyer as owner.
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

        // Transfer payment: buyer → this contract → royalty/original_creator, protocol fee/treasury, seller.
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
                true, // transfer from buyer
            );
        }

        // Update listing state.
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

        true
    }

    // ── cancel_listing ───────────────────────────────────────
    /// Artist cancels their own active listing.
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

        ListingCancelledEvent {
            listing_id,
            artist: artist.clone(),
            ledger_sequence: env.ledger().sequence(),
        }
        .publish(&env);
        true
    }

    // ── Auction methods ──────────────────────────────────────

    /// Artist creates a new auction for an artwork.
    ///
    /// * `metadata_cid` — raw bytes of the IPFS CID string
    /// * `reserve_price` — minimum bid required
    /// * `duration` — auction duration in seconds
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
        if crate::storage::is_artist_revoked(&env, &creator) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }
        if metadata_cid.is_empty() {
            panic_with_error!(&env, MarketplaceError::InvalidCid);
        }
        if reserve_price < 0 {
            panic_with_error!(&env, MarketplaceError::InvalidPrice);
        }
        if !Self::is_token_whitelisted(&env, &token) {
            panic_with_error!(&env, MarketplaceError::Unauthorized);
        }

        let recipients_len = recipients.len();
        if recipients_len == 0 || recipients_len > 4 {
            panic_with_error!(&env, MarketplaceError::TooManyRecipients);
        }

        let mut total_percentage = 0;
        for i in 0..recipients_len {
            let recipient = recipients.get(i).unwrap();
            total_percentage += recipient.percentage;
        }

        if total_percentage != 100 {
            panic_with_error!(&env, MarketplaceError::InvalidSplit);
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
            creator,
            reserve_price,
            token: auction.token.clone(),
            end_time,
        }
        .publish(&env);

        auction_id
    }

    /// Place a bid on an active auction.
    ///
    /// * `bidder` — address of the person placing the bid
    /// * `amount` — bid amount in stroops (must be higher than current highest bid)
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

            // Refund previous highest bidder
            if let Some(prev_bidder) = auction.highest_bidder.clone() {
                token_client.transfer(
                    &env.current_contract_address(),
                    &prev_bidder,
                    &auction.highest_bid,
                );
            }

            // Lock new bid funds
            token_client.transfer(&bidder, &env.current_contract_address(), &amount);
        }

        auction.highest_bid = amount;
        auction.highest_bidder = Some(bidder.clone());
        save_auction(&env, &auction);

        BidPlacedEvent {
            auction_id,
            bidder,
            bid_amount: amount,
        }
        .publish(&env);
    }

    /// Finalize or cancel an auction.
    ///
    /// If there are bids, the highest bidder wins and funds are distributed.
    /// If no bids, the auction is cancelled.
    pub fn finalize_auction(env: Env, auction_id: u64) {
        let mut auction = load_auction(&env, auction_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::AuctionNotFound));

        if auction.status != AuctionStatus::Active {
            panic_with_error!(&env, MarketplaceError::AuctionAlreadyFinalized);
        }

        let is_expired = env.ledger().timestamp() >= auction.end_time;

        if !is_expired {
            auction.creator.require_auth();
        }

        if let Some(winner) = auction.highest_bidder.clone() {
            #[allow(unused_variables)]
            let winner_ref = &winner;
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
                    false, // funds already locked in contract
                );
            }
            auction.status = AuctionStatus::Finalized;
        } else {
            auction.status = AuctionStatus::Cancelled;
        }

        save_auction(&env, &auction);

        AuctionFinalizedEvent {
            auction_id,
            winner: auction.highest_bidder,
            amount: auction.highest_bid,
        }
        .publish(&env);
    }

    pub fn get_auction(env: Env, auction_id: u64) -> Auction {
        load_auction(&env, auction_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::AuctionNotFound))
    }

    pub fn get_artist_auctions(env: Env, artist: Address) -> Vec<u64> {
        get_artist_auction_ids(&env, &artist)
    }

    // ── Internal Payout Logic ────────────────────────────────

    #[allow(clippy::too_many_arguments, dead_code)]
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

        // 1. Royalty
        if royalty_bps > 0 && original_creator != seller {
            let royalty = amount * royalty_bps as i128 / 10_000;
            if royalty > 0 {
                token.transfer(&env.current_contract_address(), original_creator, &royalty);
                payout -= royalty;
            }
        }

        // 2. Protocol fee
        let protocol_fee_bps = crate::storage::get_protocol_fee_bps_storage(env).unwrap_or(0);
        let treasury = crate::storage::get_treasury_storage(env);
        if protocol_fee_bps > 0 {
            let fee = payout * protocol_fee_bps as i128 / 10_000;
            if let Some(treasury_addr) = treasury {
                if fee > 0 {
                    token.transfer(&env.current_contract_address(), &treasury_addr, &fee);
                    payout -= fee;
                }
            }
        }

        // 3. Recipients
        let recipients_len = recipients.len();
        let mut distributed_so_far: i128 = 0;

        for i in 0..recipients_len {
            let recipient = recipients.get(i).unwrap();
            let amount_to_transfer = if i == recipients_len - 1 {
                payout - distributed_so_far
            } else {
                (payout * recipient.percentage as i128) / 100
            };

            token.transfer(
                &env.current_contract_address(),
                &recipient.address,
                &amount_to_transfer,
            );
            distributed_so_far += amount_to_transfer;
        }
    }

    // ── get_listing ──────────────────────────────────────────
    /// Returns the full Listing struct for a given ID.
    /// Panics with `ListingNotFound` if the ID does not exist.
    pub fn get_listing(env: Env, listing_id: u64) -> Listing {
        load_listing(&env, listing_id)
            .unwrap_or_else(|| panic_with_error!(&env, MarketplaceError::ListingNotFound))
    }

    // ── get_total_listings ───────────────────────────────────
    /// Returns the total number of listings ever created (counter, not active count).
    pub fn get_total_listings(env: Env) -> u64 {
        get_listing_count(&env)
    }

    // ── get_artist_listings ──────────────────────────────────
    /// Returns the Vec of listing IDs created by a given artist address.
    pub fn get_artist_listings(env: Env, artist: Address) -> Vec<u64> {
        get_artist_listing_ids(&env, &artist)
    }

    // ── Internal helpers ─────────────────────────────────────

    /// Returns the Stellar native asset (XLM) Soroban contract address.
    ///
    /// `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` is the
    /// well-known, deterministic contract ID for the native XLM asset on
    /// every Stellar network (both testnet and mainnet).
    #[cfg(not(test))]
    fn xlm_token_address(env: &Env) -> Address {
        Address::from_string_bytes(&soroban_sdk::Bytes::from_slice(
            env,
            b"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        ))
    }

    // ── Offer methods ───────────────────────────────────────────

    /// Make an offer on an active listing. Any token is accepted (bypasses whitelist).
    /// Tokens are locked in the contract until the offer is resolved.
    pub fn make_offer(
        env: Env,
        offerer: Address,
        listing_id: u64,
        amount: i128,
        token: Address,
    ) -> Result<u64, MarketplaceError> {
        offerer.require_auth();

        let listing = load_listing(&env, listing_id).ok_or(MarketplaceError::ListingNotFound)?;

        if listing.status != ListingStatus::Active {
            return Err(MarketplaceError::ListingNotActive);
        }
        if listing.artist == offerer {
            return Err(MarketplaceError::CannotOfferOwnListing);
        }
        if amount <= 0 {
            return Err(MarketplaceError::InsufficientOfferAmount);
        }

        // Lock tokens: transfer from offerer to contract
        #[cfg(not(test))]
        {
            let token_client = TokenClient::new(&env, &token);
            token_client.transfer(&offerer, &env.current_contract_address(), &amount);
        }

        let offer_id = increment_offer_count(&env);

        let offer = Offer {
            offer_id,
            listing_id,
            offerer: offerer.clone(),
            amount,
            token: token.clone(),
            status: OfferStatus::Pending,
            created_at: env.ledger().sequence(),
        };
        save_offer(&env, &offer);

        // Add to listing offers index
        let mut listing_offers = load_listing_offers(&env, listing_id);
        listing_offers.push_back(offer_id);
        save_listing_offers(&env, listing_id, &listing_offers);

        // Add to offerer offers index
        let mut offerer_offers = load_offerer_offers(&env, &offerer);
        offerer_offers.push_back(offer_id);
        save_offerer_offers(&env, &offerer, &offerer_offers);

        OfferMadeEvent {
            offer_id,
            listing_id,
            offerer,
            amount,
            token,
        }
        .publish(&env);

        Ok(offer_id)
    }

    /// Withdraw a pending offer. Only the offerer can withdraw. Refunds locked tokens.
    pub fn withdraw_offer(
        env: Env,
        offerer: Address,
        offer_id: u64,
    ) -> Result<(), MarketplaceError> {
        offerer.require_auth();

        let mut offer = load_offer(&env, offer_id).ok_or(MarketplaceError::OfferNotFound)?;

        if offer.offerer != offerer {
            return Err(MarketplaceError::Unauthorized);
        }
        if offer.status != OfferStatus::Pending {
            return Err(MarketplaceError::OfferNotPending);
        }

        // Refund tokens
        #[cfg(not(test))]
        {
            let token_client = TokenClient::new(&env, &offer.token);
            token_client.transfer(&env.current_contract_address(), &offerer, &offer.amount);
        }

        offer.status = OfferStatus::Withdrawn;
        save_offer(&env, &offer);

        OfferWithdrawnEvent {
            offer_id,
            listing_id: offer.listing_id,
            offerer,
        }
        .publish(&env);

        Ok(())
    }

    /// Accept a pending offer. Only the listing owner/artist can accept.
    /// Executes the trade: distributes payout, marks listing as Sold,
    /// and rejects all other pending offers on the same listing (refunding them).
    pub fn accept_offer(env: Env, owner: Address, offer_id: u64) -> Result<(), MarketplaceError> {
        owner.require_auth();

        let mut offer = load_offer(&env, offer_id).ok_or(MarketplaceError::OfferNotFound)?;

        if offer.status != OfferStatus::Pending {
            return Err(MarketplaceError::OfferNotPending);
        }

        let mut listing =
            load_listing(&env, offer.listing_id).ok_or(MarketplaceError::ListingNotFound)?;

        if listing.artist != owner {
            return Err(MarketplaceError::Unauthorized);
        }

        // Execute trade: distribute payout (funds already locked in contract)
        #[cfg(not(test))]
        {
            Self::distribute_payout(
                &env,
                &offer.token,
                offer.amount,
                &listing.original_creator,
                listing.royalty_bps,
                &listing.artist,
                &listing.recipients,
                &offer.offerer,
                false, // funds already locked in contract
            );
        }

        // Mark offer as accepted
        offer.status = OfferStatus::Accepted;
        save_offer(&env, &offer);

        // Mark listing as sold
        listing.status = ListingStatus::Sold;
        listing.owner = Some(offer.offerer.clone());
        save_listing(&env, &listing);

        OfferAcceptedEvent {
            offer_id,
            listing_id: offer.listing_id,
            offerer: offer.offerer.clone(),
            amount: offer.amount,
        }
        .publish(&env);

        // Reject all other pending offers on the same listing
        let listing_offers = load_listing_offers(&env, offer.listing_id);
        for i in 0..listing_offers.len() {
            let other_offer_id = listing_offers.get(i).unwrap();
            if other_offer_id == offer_id {
                continue;
            }
            if let Some(mut other_offer) = load_offer(&env, other_offer_id) {
                if other_offer.status == OfferStatus::Pending {
                    // Refund tokens
                    #[cfg(not(test))]
                    {
                        let token_client = TokenClient::new(&env, &other_offer.token);
                        token_client.transfer(
                            &env.current_contract_address(),
                            &other_offer.offerer,
                            &other_offer.amount,
                        );
                    }

                    other_offer.status = OfferStatus::Rejected;
                    save_offer(&env, &other_offer);

                    OfferRejectedEvent {
                        offer_id: other_offer_id,
                        listing_id: other_offer.listing_id,
                        offerer: other_offer.offerer,
                    }
                    .publish(&env);
                }
            }
        }

        Ok(())
    }

    /// Reject a pending offer. Only the listing owner/artist can reject. Refunds locked tokens.
    pub fn reject_offer(env: Env, owner: Address, offer_id: u64) -> Result<(), MarketplaceError> {
        owner.require_auth();

        let mut offer = load_offer(&env, offer_id).ok_or(MarketplaceError::OfferNotFound)?;

        if offer.status != OfferStatus::Pending {
            return Err(MarketplaceError::OfferNotPending);
        }

        let listing =
            load_listing(&env, offer.listing_id).ok_or(MarketplaceError::ListingNotFound)?;

        if listing.artist != owner {
            return Err(MarketplaceError::Unauthorized);
        }

        // Refund tokens
        #[cfg(not(test))]
        {
            let token_client = TokenClient::new(&env, &offer.token);
            token_client.transfer(
                &env.current_contract_address(),
                &offer.offerer,
                &offer.amount,
            );
        }

        offer.status = OfferStatus::Rejected;
        save_offer(&env, &offer);

        OfferRejectedEvent {
            offer_id,
            listing_id: offer.listing_id,
            offerer: offer.offerer,
        }
        .publish(&env);

        Ok(())
    }

    /// Get an offer by ID.
    pub fn get_offer(env: Env, offer_id: u64) -> Result<Offer, MarketplaceError> {
        load_offer(&env, offer_id).ok_or(MarketplaceError::OfferNotFound)
    }

    /// Get all offer IDs for a listing.
    pub fn get_listing_offers(env: Env, listing_id: u64) -> Vec<u64> {
        load_listing_offers(&env, listing_id)
    }

    /// Get all offer IDs made by an offerer.
    pub fn get_offerer_offers(env: Env, offerer: Address) -> Vec<u64> {
        load_offerer_offers(&env, &offerer)
    }
}
