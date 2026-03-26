#![no_std]

mod contract;
pub mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use contract::Launchpad;
pub use types::{CollectionKind, CollectionRecord, DataKey, Error};

#[cfg(any(test, feature = "testutils"))]
pub use contract::LaunchpadClient;
