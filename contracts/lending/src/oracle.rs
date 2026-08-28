use crate::types::PlatformConfig;
use soroban_sdk::{contracttype, Env, IntoVal, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

/// Queries the Reflector oracle on `config.oracle_address` for the given asset symbol
/// and enforces that the retrieved price timestamp is within `config.max_price_staleness_secs`.
pub fn get_price(env: &Env, config: &PlatformConfig, asset_symbol: Symbol) -> i128 {
    let price_data: Option<PriceData> = env.invoke_contract(
        &config.oracle_address,
        &soroban_sdk::symbol_short!("lastprice"),
        (asset_symbol,).into_val(env),
    );

    let data = match price_data {
        Some(d) => d,
        None => panic!("Oracle price unavailable"),
    };

    let current_time = env.ledger().timestamp();
    if current_time > data.timestamp
        && current_time - data.timestamp > config.max_price_staleness_secs
    {
        panic!("Oracle price is stale");
    }

    data.price
}

/// Converts a USD amount (7-decimal fixed-point) into raw token amount given oracle price and token decimals.
pub fn usd_to_token_amount(usd: i128, price: i128, decimals: u32) -> i128 {
    if price <= 0 {
        panic!("Price must be positive");
    }
    if usd <= 0 {
        return 0;
    }

    let mut multiplier: i128 = 1;
    for _ in 0..decimals {
        multiplier *= 10;
    }

    (usd * multiplier) / price
}

/// Converts a raw token amount into USD (7-decimal fixed-point) given oracle price and token decimals.
pub fn token_to_usd(tokens: i128, price: i128, decimals: u32) -> i128 {
    if price <= 0 {
        panic!("Price must be positive");
    }
    if tokens <= 0 {
        return 0;
    }

    let mut divisor: i128 = 1;
    for _ in 0..decimals {
        divisor *= 10;
    }

    (tokens * price) / divisor
}

#[cfg(test)]
mod test_oracle {
    use super::*;

    #[test]
    fn test_usd_to_token_amount_and_reverse() {
        // Price of 1 token = 2.0000000 USD (price = 20_000_000, 7 decimals)
        let price = 20_000_000;
        let decimals = 7;

        // 10.0000000 USD (usd = 100_000_000) -> should equal 5 tokens (50_000_000)
        let usd = 100_000_000;
        let tokens = usd_to_token_amount(usd, price, decimals);
        assert_eq!(tokens, 50_000_000);

        // Converting 5 tokens back to USD at price 2 -> should equal 10 USD (100_000_000)
        let usd_back = token_to_usd(tokens, price, decimals);
        assert_eq!(usd_back, 100_000_000);
    }

    #[test]
    fn test_zero_and_edge_cases() {
        let price = 10_000_000;
        assert_eq!(usd_to_token_amount(0, price, 7), 0);
        assert_eq!(token_to_usd(0, price, 7), 0);
        assert_eq!(usd_to_token_amount(-100, price, 7), 0);
        assert_eq!(token_to_usd(-100, price, 7), 0);
    }

    #[test]
    #[should_panic(expected = "Price must be positive")]
    fn test_non_positive_price_panics() {
        usd_to_token_amount(100, 0, 7);
    }
}
