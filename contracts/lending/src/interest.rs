use crate::types::Position;

/// Calculates accrued interest in USD given a position and current timestamp.
///
/// Uses a per-month schedule with partial-month linear proration.
/// If elapsed time exceeds the length of the schedule, the last schedule rate repeats.
pub fn accrued_interest_usd(position: &Position, now: u64) -> i128 {
    if now <= position.start_time {
        return 0;
    }

    if position.interest_schedule_bps.is_empty() {
        panic!("Empty interest schedule");
    }

    let elapsed_seconds = now - position.start_time;
    let elapsed_days = elapsed_seconds / 86400;
    let full_months = (elapsed_days / 30) as u32;
    let partial_days = (elapsed_days % 30) as i128;

    let sched_len = position.interest_schedule_bps.len();
    let mut total: i128 = 0;

    for m in 0..full_months {
        let idx = if m < sched_len { m } else { sched_len - 1 };
        let rate = position.interest_schedule_bps.get(idx).unwrap() as i128;
        total += (position.declared_price_usd * rate) / 10_000;
    }

    let partial_idx = if full_months < sched_len { full_months } else { sched_len - 1 };
    let partial_rate = position.interest_schedule_bps.get(partial_idx).unwrap() as i128;
    total += (((position.declared_price_usd * partial_rate) / 10_000) * partial_days) / 30;

    total
}

#[cfg(test)]
mod test_interest {
    use super::*;
    use soroban_sdk::{vec, Address, Env, PositionStatus};

    #[test]
    fn test_accrued_interest_zero_or_before_start() {
        let env = Env::default();
        let pos = Position {
            id: 1,
            listing_id: 1,
            lender: Address::generate(&env),
            borrower: Address::generate(&env),
            nft_contract: Address::generate(&env),
            token_id: 1,
            declared_price_usd: 10_000,
            collateral_currency: Address::generate(&env),
            collateral_amount: 10_000,
            interest_schedule_bps: vec![&env, 200, 300], // 2%, 3%
            liquidation_threshold_bps: 11000,
            start_time: 1000,
            max_duration_secs: 86400 * 60,
            status: PositionStatus::Active,
        };

        assert_eq!(accrued_interest_usd(&pos, 500), 0);
        assert_eq!(accrued_interest_usd(&pos, 1000), 0);
    }

    #[test]
    fn test_accrued_interest_partial_first_month() {
        let env = Env::default();
        let pos = Position {
            id: 1,
            listing_id: 1,
            lender: Address::generate(&env),
            borrower: Address::generate(&env),
            nft_contract: Address::generate(&env),
            token_id: 1,
            declared_price_usd: 10_000,
            collateral_currency: Address::generate(&env),
            collateral_amount: 10_000,
            interest_schedule_bps: vec![&env, 200], // 2% per month = 200 USD for 30 days
            liquidation_threshold_bps: 11000,
            start_time: 1000,
            max_duration_secs: 86400 * 60,
            status: PositionStatus::Active,
        };

        // 15 days elapsed -> half month = 100 USD
        let now = 1000 + 15 * 86400;
        assert_eq!(accrued_interest_usd(&pos, now), 100);
    }

    #[test]
    fn test_accrued_interest_full_month_and_schedule_progression() {
        let env = Env::default();
        let pos = Position {
            id: 1,
            listing_id: 1,
            lender: Address::generate(&env),
            borrower: Address::generate(&env),
            nft_contract: Address::generate(&env),
            token_id: 1,
            declared_price_usd: 10_000,
            collateral_currency: Address::generate(&env),
            collateral_amount: 10_000,
            interest_schedule_bps: vec![&env, 200, 300], // month 1: 200, month 2+: 300
            liquidation_threshold_bps: 11000,
            start_time: 1000,
            max_duration_secs: 86400 * 90,
            status: PositionStatus::Active,
        };

        // Exactly 1 month (30 days) -> 200
        assert_eq!(accrued_interest_usd(&pos, 1000 + 30 * 86400), 200);

        // 2 months (60 days) -> 200 + 300 = 500
        assert_eq!(accrued_interest_usd(&pos, 1000 + 60 * 86400), 500);

        // 3 months (90 days, last rate 300 repeats) -> 200 + 300 + 300 = 800
        assert_eq!(accrued_interest_usd(&pos, 1000 + 90 * 86400), 800);
    }
}
