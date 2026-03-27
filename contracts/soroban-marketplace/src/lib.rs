#![no_std]
#![allow(clippy::too_many_arguments, deprecated)]
pub mod events;
// ------------------------------------------------------------
// lib.rs — Soroban Marketplace contract root
// ------------------------------------------------------------

mod contract;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use contract::MarketplaceContract;
pub use types::{Listing, ListingStatus, MarketplaceError, Offer, OfferStatus};

// Re-export the generated client so test.rs can use MarketplaceContractClient.
#[cfg(any(test, feature = "testutils"))]
pub use contract::MarketplaceContractClient;
