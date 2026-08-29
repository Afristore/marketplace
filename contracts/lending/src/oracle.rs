use soroban_sdk::{contracttype, Address, Env, IntoVal, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OracleConfig {
    pub oracle_address: Address,
    pub max_price_staleness_secs: u64,
}

pub fn get_price(env: Env, config: OracleConfig, asset_symbol: Symbol) -> i128 {
    let price_data: Option<PriceData> = env.invoke_contract(
        &config.oracle_address,
        &Symbol::new(&env, "lastprice"),
        soroban_sdk::vec![&env, asset_symbol.into_val(&env)],
    );

    let price_data = price_data.expect("Reflector oracle price missing for asset");

    let now = env.ledger().timestamp();
    let age = now.saturating_sub(price_data.timestamp);
    if age > config.max_price_staleness_secs {
        panic!("Stale oracle price for asset: price too old");
    }

    price_data.price
}

pub fn usd_to_token_amount(usd: i128, price: i128, decimals: u32) -> i128 {
    if usd == 0 || price == 0 {
        return 0;
    }

    let scale = scale_from_decimals(decimals);
    let sign = if (usd < 0) ^ (price < 0) { -1 } else { 1 };
    let numerator = usd.abs().checked_mul(scale).unwrap_or(i128::MAX);
    let denominator = price.abs();

    sign * (numerator / denominator)
}

pub fn token_to_usd(tokens: i128, price: i128, decimals: u32) -> i128 {
    if tokens == 0 || price == 0 {
        return 0;
    }

    let scale = scale_from_decimals(decimals);
    let sign = if (tokens < 0) ^ (price < 0) { -1 } else { 1 };
    let numerator = tokens.abs().checked_mul(price.abs()).unwrap_or(i128::MAX);

    sign * (numerator / scale)
}

fn scale_from_decimals(decimals: u32) -> i128 {
    match 10_i128.checked_pow(decimals) {
        Some(value) => value,
        None => i128::MAX,
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        contract, contractimpl,
        testutils::Ledger,
        Env, Symbol,
    };

    #[contract]
    struct MockOracle;

    #[contractimpl]
    impl MockOracle {
        pub fn lastprice(env: Env, _asset: Symbol) -> Option<PriceData> {
            Some(PriceData {
                price: 12_500_000i128,
                timestamp: env.ledger().timestamp(),
            })
        }
    }

    #[contract]
    struct StaleMockOracle;

    #[contractimpl]
    impl StaleMockOracle {
        pub fn lastprice(_env: Env, _asset: Symbol) -> Option<PriceData> {
            Some(PriceData {
                price: 12_500_000i128,
                timestamp: 0,
            })
        }
    }

    #[contract]
    struct MissingPriceOracle;

    #[contractimpl]
    impl MissingPriceOracle {
        pub fn lastprice(_env: Env, _asset: Symbol) -> Option<PriceData> {
            None
        }
    }

    #[test]
    fn get_price_reads_live_feed() {
        let env = Env::default();
        let oracle = env.register(MockOracle, ());
        let config = OracleConfig {
            oracle_address: oracle,
            max_price_staleness_secs: 60,
        };

        let price = get_price(env.clone(), config, Symbol::new(&env, "BTC"));
        assert_eq!(price, 12_500_000i128);
    }

    #[test]
    #[should_panic(expected = "Reflector oracle price missing")]
    fn get_price_panics_when_price_is_missing() {
        let env = Env::default();
        let oracle = env.register(MissingPriceOracle, ());
        let config = OracleConfig {
            oracle_address: oracle,
            max_price_staleness_secs: 60,
        };

        get_price(env.clone(), config, Symbol::new(&env, "BTC"));
    }

    #[test]
    #[should_panic(expected = "Stale oracle price")]
    fn get_price_rejects_stale_prices() {
        let env = Env::default();
        env.ledger().set_timestamp(1_000);
        let oracle = env.register(StaleMockOracle, ());
        let config = OracleConfig {
            oracle_address: oracle,
            max_price_staleness_secs: 60,
        };

        get_price(env.clone(), config, Symbol::new(&env, "BTC"));
    }

    #[test]
    fn usd_to_token_amount_handles_zero_and_max_values() {
        assert_eq!(usd_to_token_amount(0, 12_500_000i128, 7), 0);
        assert_eq!(usd_to_token_amount(1_000_000_000i128, 1, 0), 1_000_000_000i128);
        assert_eq!(usd_to_token_amount(i128::MAX, 1, 0), i128::MAX);
    }

    #[test]
    fn token_to_usd_handles_zero_and_max_values() {
        assert_eq!(token_to_usd(0, 12_500_000i128, 7), 0);
        assert_eq!(token_to_usd(1_000_000_000i128, 1, 0), 1_000_000_000i128);
        assert_eq!(token_to_usd(i128::MAX, 1, 0), i128::MAX);
    }

    #[test]
    fn conversion_helpers_respect_decimals() {
        assert_eq!(
            usd_to_token_amount(1_000_000_000i128, 2_000_000_000i128, 9),
            500_000_000i128
        );
        assert_eq!(
            token_to_usd(1_000_000_000i128, 2_000_000_000i128, 9),
            2_000_000_000i128
        );
        assert_eq!(
            usd_to_token_amount(10_000_000i128, 2_500_000i128, 7),
            40_000_000i128
        );
        assert_eq!(
            token_to_usd(4_000_000i128, 2_500_000i128, 7),
            1_000_000i128
        );

        assert_eq!(
            usd_to_token_amount(2_500_000i128, 10_000_000i128, 9),
            250_000_000i128
        );
        assert_eq!(
            token_to_usd(250_000i128, 10_000_000i128, 9),
            2_500i128
        );
    }
}
