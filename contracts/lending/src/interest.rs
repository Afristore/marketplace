use crate::types::Position;

/// Compute accrued interest in USD (7-decimal fixed-point) for a position.
///
/// Algorithm (per-month schedule):
///   elapsed_days = (now - start_time) / 86400
///   full_months  = elapsed_days / 30
///   partial_days = elapsed_days % 30
///
///   for each full month m:
///       rate = schedule[min(m, len-1)]   // last entry repeats indefinitely
///       total += declared_price_usd * rate / 10_000
///
///   partial_rate = schedule[min(full_months, len-1)]
///   total += declared_price_usd * partial_rate / 10_000 * partial_days / 30
///
/// Edge cases:
///   now <= start_time  → returns 0 (no time has elapsed)
///   empty schedule     → panics ("interest schedule must not be empty")
pub fn accrued_interest_usd(position: &Position, now: u64) -> i128 {
    if position.interest_schedule_bps.is_empty() {
        panic!("interest schedule must not be empty");
    }

    if now <= position.start_time {
        return 0;
    }

    let schedule = &position.interest_schedule_bps;
    let len = schedule.len() as u64;
    let price = position.declared_price_usd;

    let elapsed_secs = now - position.start_time;
    let elapsed_days = elapsed_secs / 86400;
    let full_months = elapsed_days / 30;
    let partial_days = elapsed_days % 30;

    let mut total: i128 = 0;

    // Accumulate interest for each completed month.
    for m in 0..full_months {
        let idx = m.min(len - 1) as u32;
        let rate = schedule.get(idx).unwrap() as i128;
        total += price * rate / 10_000;
    }

    // Partial month pro-rated linearly.
    if partial_days > 0 {
        let idx = full_months.min(len - 1) as u32;
        let partial_rate = schedule.get(idx).unwrap() as i128;
        total += price * partial_rate / 10_000 * (partial_days as i128) / 30;
    }

    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PositionStatus;
    use soroban_sdk::{testutils::Address as _, vec, Address, Env};

    // 100 USD declared price with 7-decimal fixed-point
    const PRICE: i128 = 100_000_000;

    fn make_position(env: &Env, schedule: soroban_sdk::Vec<u32>, start: u64) -> Position {
        Position {
            id: 1,
            listing_id: 1,
            lender: Address::generate(env),
            borrower: Address::generate(env),
            nft_contract: Address::generate(env),
            token_id: 1,
            declared_price_usd: PRICE,
            collateral_currency: Address::generate(env),
            collateral_amount: 150_000_000,
            interest_schedule_bps: schedule,
            liquidation_threshold_bps: 11000,
            start_time: start,
            max_duration_secs: 86400 * 90,
            status: PositionStatus::Active,
        }
    }

    /// elapsed = 0 → 0 interest
    #[test]
    fn test_elapsed_zero() {
        let env = Env::default();
        let pos = make_position(&env, vec![&env, 500u32], 1000);
        assert_eq!(accrued_interest_usd(&pos, 1000), 0);
    }

    /// now < start_time → 0 interest (guards against clock oddities)
    #[test]
    fn test_now_before_start() {
        let env = Env::default();
        let pos = make_position(&env, vec![&env, 500u32], 2000);
        assert_eq!(accrued_interest_usd(&pos, 1000), 0);
    }

    /// 15 days elapsed (half of month 1) with 500 bps (5%) monthly rate.
    /// expected = 100 * 5% * 15/30 = 2.5 USD = 2_500_000
    #[test]
    fn test_month1_partial() {
        let env = Env::default();
        let start = 0u64;
        let now = 15 * 86400; // 15 days
        let pos = make_position(&env, vec![&env, 500u32], start);
        assert_eq!(accrued_interest_usd(&pos, now), 2_500_000);
    }

    /// Exactly 30 days elapsed — one full month, no partial.
    /// expected = 100 * 5% = 5 USD = 5_000_000
    #[test]
    fn test_exact_one_full_month() {
        let env = Env::default();
        let start = 0u64;
        let now = 30 * 86400;
        let pos = make_position(&env, vec![&env, 500u32], start);
        assert_eq!(accrued_interest_usd(&pos, now), 5_000_000);
    }

    /// 35 days elapsed — one full month at 500 bps + 5 partial days at 500 bps.
    /// full:    100 * 5% * 1       = 5_000_000
    /// partial: 100 * 5% * 5/30   =   833_333
    /// total = 5_833_333
    #[test]
    fn test_month1_full_plus_partial() {
        let env = Env::default();
        let now = 35 * 86400;
        let pos = make_position(&env, vec![&env, 500u32], 0);
        assert_eq!(accrued_interest_usd(&pos, now), 5_833_333);
    }

    /// Month-2 rate kicks in: schedule = [500, 800].
    /// 31 days = 1 full month (500 bps) + 1 partial day at month-2 rate (800 bps).
    /// full:    100 * 5%   * 1    = 5_000_000
    /// partial: 100 * 8%   * 1/30 =   266_666
    /// total = 5_266_666
    #[test]
    fn test_month2_rate_kicks_in() {
        let env = Env::default();
        let now = 31 * 86400;
        let pos = make_position(&env, vec![&env, 500u32, 800u32], 0);
        assert_eq!(accrued_interest_usd(&pos, now), 5_266_666);
    }

    /// Last-rate repeats: schedule = [500, 800], 3 full months elapsed.
    /// month 0: 500 bps → 5_000_000
    /// month 1: 800 bps → 8_000_000
    /// month 2: 800 bps (last repeats) → 8_000_000
    /// total = 21_000_000
    #[test]
    fn test_last_rate_repeats() {
        let env = Env::default();
        let now = 90 * 86400; // 3 full months
        let pos = make_position(&env, vec![&env, 500u32, 800u32], 0);
        assert_eq!(accrued_interest_usd(&pos, now), 21_000_000);
    }

    /// Empty schedule panics.
    #[test]
    #[should_panic(expected = "interest schedule must not be empty")]
    fn test_empty_schedule_panics() {
        let env = Env::default();
        let pos = make_position(&env, vec![&env], 0);
        accrued_interest_usd(&pos, 86400);
    }
}
