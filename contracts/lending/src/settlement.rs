use crate::interest::accrued_interest_usd;
use crate::oracle::{get_price, usd_to_token_amount};
use crate::types::{PlatformConfig, Position};
use soroban_sdk::{contracttype, symbol_short, token, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettleResult {
    pub lender_payout: i128,
    pub platform_payout: i128,
    pub liquidator_payout: i128,
    pub borrower_refund: i128,
    pub interest_paid_usd: i128,
    pub total_debit_tokens: i128,
}

/// Executes the shared settlement waterfall for `return_nft()` and `liquidate()`.
///
/// Waterfall calculation:
/// 1. `owed_usd = declared_price_usd + accrued_interest_usd`
/// 2. `platform_fee_usd = owed_usd * platform_fee_bps / 10_000`
/// 3. `liquidator_fee_usd = owed_usd * liquidator_fee_bps / 10_000` (0 on voluntary return)
/// 4. Converts USD amounts to token amounts using oracle price
/// 5. Clamps `borrower_refund` to 0 (floor at 0, never underflows or becomes negative)
/// 6. Executes token transfers from contract to lender, fee_receiver, liquidator, and borrower
pub fn settle(
    env: &Env,
    position: &Position,
    liquidator: Option<Address>,
    config: &PlatformConfig,
) -> SettleResult {
    let now = env.ledger().timestamp();
    let interest_usd = accrued_interest_usd(position, now);
    let owed_usd = position.declared_price_usd + interest_usd;

    let platform_fee_usd = (owed_usd * config.platform_fee_bps as i128) / 10_000;
    let liquidator_fee_usd = if liquidator.is_some() {
        (owed_usd * config.liquidator_fee_bps as i128) / 10_000
    } else {
        0
    };

    let asset_symbol = symbol_short!("XLM");
    let price = get_price(env, config, asset_symbol);
    let decimals: u32 = 7;

    let lender_payout = usd_to_token_amount(owed_usd, price, decimals);
    let platform_payout = usd_to_token_amount(platform_fee_usd, price, decimals);
    let liquidator_payout = usd_to_token_amount(liquidator_fee_usd, price, decimals);

    let total_debit_tokens = lender_payout + platform_payout + liquidator_payout;

    // Clamped to 0: If collateral is insufficient to cover all debits (bad debt scenario),
    // the borrower receives 0 refund rather than causing an arithmetic underflow.
    let borrower_refund = if position.collateral_amount > total_debit_tokens {
        position.collateral_amount - total_debit_tokens
    } else {
        0
    };

    let token_client = token::Client::new(env, &position.collateral_currency);
    let contract_address = env.current_contract_address();

    if lender_payout > 0 {
        token_client.transfer(&contract_address, &position.lender, &lender_payout);
    }
    if platform_payout > 0 {
        token_client.transfer(&contract_address, &config.fee_receiver, &platform_payout);
    }
    if let Some(liq_addr) = liquidator {
        if liquidator_payout > 0 {
            token_client.transfer(&contract_address, &liq_addr, &liquidator_payout);
        }
    }
    if borrower_refund > 0 {
        token_client.transfer(&contract_address, &position.borrower, &borrower_refund);
    }

    SettleResult {
        lender_payout,
        platform_payout,
        liquidator_payout,
        borrower_refund,
        interest_paid_usd: interest_usd,
        total_debit_tokens,
    }
}
