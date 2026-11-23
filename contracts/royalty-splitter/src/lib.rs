#![no_std]

mod contract;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use contract::RoyaltySplitter;
pub use types::SplitterError;

#[cfg(any(test, feature = "testutils"))]
pub use contract::RoyaltySplitterClient;
