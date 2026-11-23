use soroban_sdk::{contractclient, contracttype, Address, Env};

/// Default maximum allowed staleness for an oracle price quote (5 minutes).
pub const DEFAULT_MAX_STALENESS_SECS: u64 = 300;

/// Standard Stellar asset and USD fixed-point decimal places.
pub const DECIMALS: u32 = 7;

/// Scaling factor for 7-decimal fixed-point math (10^7).
pub const DECIMAL_SCALE: i128 = 10_000_000;

/// Price quote returned by the Reflector Oracle smart contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    /// Asset price in USD with 7-decimal fixed-point precision.
    pub price: i128,
    /// Ledger timestamp (in seconds) when the quote was recorded.
    pub timestamp: u64,
}

/// Cross-contract client interface for the Reflector Oracle contract.
#[contractclient(name = "ReflectorOracleClient")]
pub trait ReflectorOracle {
    /// Fetch the latest USD price and timestamp for `asset`.
    fn price(env: Env, asset: Address) -> Option<PriceData>;
}

/// Fetch the validated USD price (7 decimals) for `currency` from the Reflector
/// Oracle using the default 5-minute (`DEFAULT_MAX_STALENESS_SECS`) staleness window.
pub fn get_price(env: &Env, oracle_address: &Address, currency: &Address) -> i128 {
    get_price_with_staleness(env, oracle_address, currency, DEFAULT_MAX_STALENESS_SECS)
}

/// Fetch the validated USD price (7 decimals) for `currency` from the Reflector
/// Oracle, enforcing that the quote is positive and no older than `max_staleness_secs`.
pub fn get_price_with_staleness(
    env: &Env,
    oracle_address: &Address,
    currency: &Address,
    max_staleness_secs: u64,
) -> i128 {
    let client = ReflectorOracleClient::new(env, oracle_address);
    let data = client
        .price(currency)
        .unwrap_or_else(|| panic!("Oracle price not found"));

    if data.price <= 0 {
        panic!("Invalid oracle price: price must be greater than zero");
    }

    let now = env.ledger().timestamp();
    if now.saturating_sub(data.timestamp) > max_staleness_secs {
        panic!("Stale oracle price");
    }

    data.price
}

/// Convert a 7-decimal Stellar asset amount into a 7-decimal USD value using a
/// 7-decimal oracle price.
///
/// Formula: `(collateral_amount * oracle_price) / 10^7`
pub fn collateral_to_usd(collateral_amount: i128, oracle_price: i128) -> i128 {
    if collateral_amount < 0 {
        panic!("Invalid collateral amount: must be non-negative");
    }
    if oracle_price <= 0 {
        panic!("Invalid oracle price: price must be greater than zero");
    }

    collateral_amount
        .checked_mul(oracle_price)
        .unwrap_or_else(|| panic!("USD conversion overflow"))
        / DECIMAL_SCALE
}

/// Convert a 7-decimal USD amount into 7-decimal Stellar asset units using a
/// 7-decimal oracle price.
///
/// Formula: `(usd_amount * 10^7) / oracle_price`
pub fn usd_to_collateral(usd_amount: i128, oracle_price: i128) -> i128 {
    if usd_amount < 0 {
        panic!("Invalid USD amount: must be non-negative");
    }
    if oracle_price <= 0 {
        panic!("Invalid oracle price: price must be greater than zero");
    }

    usd_amount
        .checked_mul(DECIMAL_SCALE)
        .unwrap_or_else(|| panic!("Collateral conversion overflow"))
        / oracle_price
}
