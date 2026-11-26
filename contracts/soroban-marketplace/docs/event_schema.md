# Afristore Marketplace Contract Event Schema

This document describes the event schema for all persistent, structured events emitted by the Afristore Marketplace Soroban contract. All events are versioned and emitted using `env.events().publish()` for reliable indexing and frontend consumption.

## General Event Fields
- `listing_id` (u64): The unique identifier for the listing.
- `actor` (Address): The address of the actor performing the action (e.g., artist, buyer).
- `ledger_sequence` (u32): The ledger sequence at which the event was emitted.
- Action-specific fields (see below).

## Event Types

### listing_created_v1
**Emitted when a new listing is created.**

- `listing_id` (u64)
- `artist` (Address)
- `price` (i128)
- `currency` (Symbol)
- `metadata_cid` (Bytes)
- `ledger_sequence` (u32)

### artwork_sold_v1
**Emitted when an artwork is sold.**

- `listing_id` (u64)
- `artist` (Address)
- `buyer` (Address)
- `price` (i128)
- `currency` (Symbol)
- `ledger_sequence` (u32)

### listing_cancelled_v1
**Emitted when a listing is cancelled by the artist.**

- `listing_id` (u64)
- `artist` (Address)
- `ledger_sequence` (u32)

### auction_cancelled_v1
**Emitted when the creator cancels an active auction before its end time and before any bid is placed.**

- `auction_id` (u64)
- `creator` (Address)

### listing_updated_v1
*Reserved for future use.*

### bid_placed_v1, auction_resolved_v1, offer_made_v1, offer_accepted_v1, offer_rejected_v1, offer_withdrawn_v1, royalty_paid_v1, artist_revoked_v1, artist_reinstated_v1
*Reserved for future use. Fields will follow the same pattern: always include `listing_id`, `actor`, `ledger_sequence`, and action-specific fields.*

## Notes
- All event topics are versioned (e.g., `listing_created_v1`) to allow for future schema evolution.
- Only successful contract actions emit events. Failed transactions do not emit events.
- Cancelled listings do not emit `artwork_sold` events.

---

For questions or to extend the schema, update this document and the corresponding `events.rs` module.
