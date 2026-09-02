use soroban_sdk::{panic_with_error, Env};

use crate::types::{BorrowPosition, LendingError};

/// Calculate elapsed settlement time strictly validating ledger clock progression.
/// Reverts with `LendingError::InvalidLedgerTime` if `now < start_time`.
pub fn calculate_elapsed_time(now: u64, start_time: u64) -> Result<u64, LendingError> {
    if now < start_time {
        return Err(LendingError::InvalidLedgerTime);
    }
    Ok(now - start_time)
}

/// Calculate total settlement amount including principal and accrued interest.
/// Fails with `LendingError::InvalidLedgerTime` if current timestamp precedes position start time.
pub fn calculate_settlement(
    _env: &Env,
    now: u64,
    position: &BorrowPosition,
    interest_rate_bps: u32,
) -> Result<i128, LendingError> {
    let elapsed = calculate_elapsed_time(now, position.timestamp)?;

    // Calculate accrued interest based on elapsed seconds:
    // interest = borrow_amount * interest_rate_bps * elapsed / (10_000 * 31_536_000)
    let interest = position
        .borrow_amount
        .saturating_mul(interest_rate_bps as i128)
        .saturating_mul(elapsed as i128)
        / (10_000 * 31_536_000);

    Ok(position.borrow_amount + interest)
}

/// Process settlement position calculation in contract context, enforcing strict clock validation.
pub fn settle_position(
    env: &Env,
    now: u64,
    position: &BorrowPosition,
    interest_rate_bps: u32,
) -> i128 {
    match calculate_settlement(env, now, position, interest_rate_bps) {
        Ok(amount) => amount,
        Err(err) => panic_with_error!(env, err),
    }
}
