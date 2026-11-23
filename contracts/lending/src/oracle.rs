use soroban_sdk::{contractclient, contracttype, Address, Env};

/// Default maximum allowed staleness for an oracle price quote (5 minutes).
pub const DEFAULT_MAX_STALENESS_SECS: u64 = 300;

/// Largest staleness window the platform accepts (24 hours). A wider window
/// would let positions be opened or liquidated against prices that no longer
/// reflect the market.
pub const MAX_STALENESS_SECS: u64 = 86_400;

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
    // A quote stamped after the current ledger close cannot be trusted: with a
    // saturating subtraction it would otherwise look perfectly fresh.
    if data.timestamp > now {
        panic!("Oracle price timestamp is in the future");
    }
    if now - data.timestamp > max_staleness_secs {
        panic!("Stale oracle price");
    }

    data.price
}

/// Panics unless `max_staleness_secs` is a usable window: greater than zero
/// (a zero window rejects every quote but one from the current ledger) and no
/// larger than `MAX_STALENESS_SECS`.
pub fn validate_staleness_window(max_staleness_secs: u64) {
    if max_staleness_secs == 0 {
        panic!("Invalid staleness window: must be greater than zero");
    }
    if max_staleness_secs > MAX_STALENESS_SECS {
        panic!("Invalid staleness window: must not exceed 86400 seconds");
    }
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
