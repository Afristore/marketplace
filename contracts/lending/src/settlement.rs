use soroban_sdk::{token, Address, Env};

use crate::interest::accrued_interest_usd;
use crate::oracle;
use crate::types::{PlatformConfig, Position, SettleResult};

// All USD amounts use 7-decimal fixed-point (e.g. 1 USD = 10_000_000).
// Token amounts also use 7-decimal fixed-point to match oracle prices.
const DECIMALS: i128 = 10_000_000; // 1e7

/// Convert a USD amount (7 decimals) to token units (7 decimals) given an
/// oracle price (USD per 1 token, 7 decimals).
///
/// formula: token_units = usd_amount * DECIMALS / oracle_price
///
/// Panics with a clear message if `oracle_price <= 0` or if the arithmetic
/// overflows, instead of panicking with an opaque divide-by-zero or wrapping.
fn usd_to_token_amount(usd_amount: i128, oracle_price: i128) -> i128 {
    if usd_amount < 0 {
        panic!("InvalidAmount: usd_amount must be >= 0");
    }
    if oracle_price <= 0 {
        panic!("InvalidOraclePrice: oracle_price must be > 0");
    }
    // oracle_price: how many USD (7 dec) per 1 token (7 dec)
    // => token_units = usd_amount / oracle_price * DECIMALS
    //                = usd_amount * DECIMALS / oracle_price
    usd_amount
        .checked_mul(DECIMALS)
        .and_then(|v| v.checked_div(oracle_price))
        .expect("usd_to_token_amount: arithmetic overflow")
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

    // ── Oracle price ──────────────────────────────────────────────────────────
    // Use the platform's configured window, the same one borrow(), liquidate()
    // and health_factor() enforce, so a quote they accept is not rejected here.
    let oracle_price = oracle::get_price_with_staleness(
        env,
        &config.oracle_address,
        &position.collateral_currency,
        config.max_price_staleness_secs,
    );
    if oracle_price <= 0 {
        panic!("InvalidOraclePrice: oracle_price must be > 0");
    }

    // ── Waterfall math ────────────────────────────────────────────────────────
    let accrued_interest_usd = accrued_interest_usd(position, now);

    let owed_usd = position.declared_price_usd + accrued_interest_usd;

    let platform_fee_usd = owed_usd * (config.platform_fee_bps as i128) / 10_000;

    // liquidator_fee is 0 on voluntary return (liquidator == None)
    let liquidator_fee_usd = match &liquidator {
        Some(_) => owed_usd * (config.liquidator_fee_bps as i128) / 10_000,
        None => 0,
    };

    let total_owed_usd = owed_usd + platform_fee_usd + liquidator_fee_usd;

    let requested_lender_payout = usd_to_token_amount(owed_usd, oracle_price);
    let requested_platform_payout = usd_to_token_amount(platform_fee_usd, oracle_price);
    let requested_liquidator_payout = usd_to_token_amount(liquidator_fee_usd, oracle_price);
    let requested_debit_tokens = usd_to_token_amount(total_owed_usd, oracle_price);

    let available_collateral = position.collateral_amount;

    // Cap total payouts to position.collateral_amount.
    // If the loan is underwater (collateral < total debit), prorate lender,
    // platform, and liquidator payouts without exceeding the position's deposited collateral.
    let (lender_payout, liquidator_payout, platform_payout) = {
        let total_requested =
            requested_lender_payout + requested_liquidator_payout + requested_platform_payout;
        if total_requested <= available_collateral || total_requested == 0 {
            (
                requested_lender_payout,
                requested_liquidator_payout,
                requested_platform_payout,
            )
        } else {
            let actual_platform = requested_platform_payout
                .checked_mul(available_collateral)
                .and_then(|v| v.checked_div(total_requested))
                .unwrap_or(0);

            let actual_liquidator = requested_liquidator_payout
                .checked_mul(available_collateral)
                .and_then(|v| v.checked_div(total_requested))
                .unwrap_or(0);

            let rem = available_collateral.saturating_sub(actual_platform + actual_liquidator);
            let actual_lender = core::cmp::min(requested_lender_payout, rem);

            (actual_lender, actual_liquidator, actual_platform)
        }
    };

    let debit_tokens = if position.collateral_amount > requested_debit_tokens {
        requested_debit_tokens
    } else {
        lender_payout + liquidator_payout + platform_payout
    };

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
