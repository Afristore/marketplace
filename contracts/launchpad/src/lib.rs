#![no_std]

pub mod events;
mod contract;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use contract::Launchpad;
pub use types::{CollectionKind, CollectionRecord, DataKey, Error};

#[cfg(any(test, feature = "testutils"))]
pub use contract::LaunchpadClient;
