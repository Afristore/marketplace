use soroban_sdk::{token, Address, Env};

use crate::oracle;
use crate::types::{PlatformConfig, Position, SettleResult};

// All USD amounts use 7-decimal fixed-point (e.g. 1 USD = 10_000_000).
// Token amounts also use 7-decimal fixed-point to match oracle prices.
const DECIMALS: i128 = 10_000_000; // 1e7

/// Convert a USD amount (7 decimals) to token units (7 decimals) given an
/// oracle price (USD per 1 token, 7 decimals).
///
/// formula: token_units = usd_amount * DECIMALS / oracle_price
fn usd_to_token_amount(usd_amount: i128, oracle_price: i128) -> i128 {
    // oracle_price: how many USD (7 dec) per 1 token (7 dec)
    // => token_units = usd_amount / oracle_price * DECIMALS
    //                = usd_amount * DECIMALS / oracle_price
    usd_amount * DECIMALS / oracle_price
}

/// Compute accrued interest in USD given the position's interest schedule and
/// elapsed time.  The schedule is a Vec of periodic rates in bps; we treat each
/// entry as one full period's worth of interest applied proportionally.
///
/// For simplicity we use a single-period model: the first entry in
/// `interest_schedule_bps` is the rate for `max_duration_secs`.  Interest
/// accrues linearly over elapsed time up to the full period.
fn compute_accrued_interest(
    declared_price_usd: i128,
    interest_schedule_bps: &soroban_sdk::Vec<u32>,
    elapsed_secs: u64,
    max_duration_secs: u64,
) -> i128 {
    if interest_schedule_bps.is_empty() || max_duration_secs == 0 {
        return 0;
    }

    // Use the first schedule entry as the full-period rate.
    let rate_bps = interest_schedule_bps.get(0).unwrap_or(0) as i128;

    // full_period_interest = principal * rate_bps / 10_000
    let full_interest = declared_price_usd * rate_bps / 10_000;

    // pro-rate: accrued = full_interest * elapsed / max_duration
    // Cap elapsed at max_duration to avoid over-charging.
    let capped_elapsed = elapsed_secs.min(max_duration_secs) as i128;
    full_interest * capped_elapsed / (max_duration_secs as i128)
}

/// Single shared settlement function used by both `return_nft()` and
/// `liquidate()`.
///
/// Waterfall:
///   owed_usd           = declared_price_usd + accrued_interest_usd
///   platform_fee_usd   = owed_usd * platform_fee_bps / 10_000
///   liquidator_fee_usd = owed_usd * liquidator_fee_bps / 10_000  (0 on voluntary return)
///   debit_tokens       = usd_to_token(owed_usd + platform_fee_usd + liquidator_fee_usd, price)
///   lender_payout      = usd_to_token(owed_usd, price)
///   platform_payout    = usd_to_token(platform_fee_usd, price)
///   liquidator_payout  = usd_to_token(liquidator_fee_usd, price)
///   borrower_rem       = collateral_amount - debit_tokens   // clamped to 0
///
/// Does NOT transfer the NFT — by design the NFT stays with the borrower
/// (or was already returned before this call).
pub fn settle(
    env: &Env,
    position: &Position,
    liquidator: Option<Address>,
    config: &PlatformConfig,
) -> SettleResult {
    let now = env.ledger().timestamp();
    let elapsed = now.saturating_sub(position.start_time);

    // ── Oracle price ──────────────────────────────────────────────────────────
    let oracle_price =
        oracle::get_price(env, &config.oracle_address, &position.collateral_currency);

    // ── Waterfall math ────────────────────────────────────────────────────────
    let accrued_interest_usd = compute_accrued_interest(
        position.declared_price_usd,
        &position.interest_schedule_bps,
        elapsed,
        position.max_duration_secs,
    );

    let owed_usd = position.declared_price_usd + accrued_interest_usd;

    let platform_fee_usd = owed_usd * (config.platform_fee_bps as i128) / 10_000;

    // liquidator_fee is 0 on voluntary return (liquidator == None)
    let liquidator_fee_usd = match &liquidator {
        Some(_) => owed_usd * (config.liquidator_fee_bps as i128) / 10_000,
        None => 0,
    };

    let total_owed_usd = owed_usd + platform_fee_usd + liquidator_fee_usd;

    let debit_tokens = usd_to_token_amount(total_owed_usd, oracle_price);
    let lender_payout = usd_to_token_amount(owed_usd, oracle_price);
    let platform_payout = usd_to_token_amount(platform_fee_usd, oracle_price);
    let liquidator_payout = usd_to_token_amount(liquidator_fee_usd, oracle_price);

    // borrower_rem: collateral remaining after all debits are taken.
    // Clamped to 0 — the borrower never receives a negative amount even if
    // collateral was eroded by price movement before liquidation.
    let borrower_rem = if position.collateral_amount > debit_tokens {
        position.collateral_amount - debit_tokens
    } else {
        // Collateral fully consumed; borrower gets nothing back.
        0
    };

    // ── Token transfers ───────────────────────────────────────────────────────
    let col_client = token::Client::new(env, &position.collateral_currency);

    // Pay lender their principal + accrued interest
    if lender_payout > 0 {
        col_client.transfer(
            &env.current_contract_address(),
            &position.lender,
            &lender_payout,
        );
    }

    // Pay platform fee
    if platform_payout > 0 {
        col_client.transfer(
            &env.current_contract_address(),
            &config.fee_receiver,
            &platform_payout,
        );
    }

    // Pay liquidator fee (only on liquidation path)
    if let Some(ref liq_addr) = liquidator {
        if liquidator_payout > 0 {
            col_client.transfer(
                &env.current_contract_address(),
                liq_addr,
                &liquidator_payout,
            );
        }
    }

    // Return any leftover collateral to the borrower
    if borrower_rem > 0 {
        col_client.transfer(
            &env.current_contract_address(),
            &position.borrower,
            &borrower_rem,
        );
    }

    SettleResult {
        owed_usd,
        accrued_interest_usd,
        platform_fee_usd,
        liquidator_fee_usd,
        debit_tokens,
        lender_payout,
        platform_payout,
        liquidator_payout,
        borrower_rem,
    }
}
