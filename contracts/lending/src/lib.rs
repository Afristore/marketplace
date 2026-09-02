#![no_std]

mod oracle;

pub use oracle::{
    get_price, token_to_usd, usd_to_token_amount, OracleConfig, PriceData,
};

#[contract]
pub struct Contract;
pub mod contract;
pub mod events;
pub mod interest;
pub mod oracle;
pub mod settlement;
pub mod storage;
pub mod types;

pub use contract::*;

#[cfg(test)]
mod test;
