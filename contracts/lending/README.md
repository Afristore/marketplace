# Afristore-Lending

NFT-collateralized lending protocol for the [Afristore Marketplace](https://github.com/Afristore/marketplace).
Companion to `contracts/soroban-marketplace` and the launchpad, following the same Soroban/Rust structure.

---

##  Product Summary

A **lender** escrows an NFT into the contract with a declared value and interest terms.
A **borrower** posts over-collateralized fungible assets (whitelisted stablecoins / wBTC / wETH)
and receives **real on-chain ownership** of the NFT for the loan term — so it's immediately usable
for gating, whitelist claims, etc.

Settlement paths:
- **Voluntary return** (before term, position healthy): borrower returns the NFT, pays accrued interest + platform fee out of collateral, keeps the rest.
- **Health-factor breach**: collateral USD value falls too close to declared NFT price → permissionless `liquidate()` — lender is paid in collateral, liquidator takes a bounty, platform takes its fee, remainder goes to borrower. **Borrower keeps the NFT.**
- **Term expiry without return**: identical to health-factor liquidation — economically equivalent to forfeiting collateral.

No Dutch auction, no NFT resale at liquidation — settlement is a pure collateral payout.
Oracle (Reflector) is only ever used to price **collateral currencies** (USDC/USD, wETH/USD, wBTC/USD) — never an NFT floor price.

---

##  Module Layout

```
contracts/soroban-lending/
├── src/
│   ├── lib.rs           # Entrypoints
│   ├── types.rs         # Listing, Position, PlatformConfig, statuses
│   ├── storage.rs       # DataKey helpers
│   ├── oracle.rs        # Reflector client + staleness checks
│   ├── interest.rs      # Per-month accrual schedule math
│   ├── settlement.rs    # Shared _settle() waterfall (return + liquidate)
│   └── contract.rs      # Ties it together
├── Cargo.toml
└── Makefile
```

---

##  Data Types

```rust
#[contracttype]
pub enum ListingStatus { Open, Filled, Cancelled }

#[contracttype]
pub enum PositionStatus { Active, Returned, Liquidated, Expired }

#[contracttype]
pub struct Listing {
    pub id: u64,
    pub lender: Address,
    pub nft_contract: Address,
    pub token_id: u128,
    pub declared_price_usd: i128,         // fixed-point, e.g. 7 decimals
    pub interest_schedule_bps: Vec<u32>,  // per-month rate; last value repeats if loan exceeds length
    pub max_duration_days: u32,
    pub min_collateral_buffer_bps: u32,   // within platform bounds
    pub liquidation_threshold_bps: u32,   // within platform bounds
    pub status: ListingStatus,
    pub created_at: u64,
}

#[contracttype]
pub struct Position {
    pub id: u64,
    pub listing_id: u64,
    pub lender: Address,
    pub borrower: Address,
    pub nft_contract: Address,
    pub token_id: u128,
    pub declared_price_usd: i128,
    pub collateral_currency: Address,
    pub collateral_amount: i128,
    pub interest_schedule_bps: Vec<u32>,
    pub liquidation_threshold_bps: u32,
    pub start_time: u64,
    pub max_duration_secs: u64,
    pub status: PositionStatus,
}

#[contracttype]
pub struct PlatformConfig {
    pub admin: Address,
    pub fee_receiver: Address,
    pub platform_fee_bps: u32,
    pub liquidator_fee_bps: u32,
    pub min_buffer_bps: u32,           // e.g. 12000 = minimum 120% collateral
    pub max_buffer_bps: u32,           // cap to prevent absurd listings
    pub min_liq_threshold_bps: u32,    // e.g. 10500 = tightest allowed trigger (105%)
    pub max_liq_threshold_bps: u32,    // e.g. 12000 = loosest allowed trigger (120%)
    pub oracle_address: Address,       // Reflector contract
    pub max_price_staleness_secs: u64,
}
```

---

##  Storage Keys

```rust
DataKey::Config
DataKey::Listing(u64)
DataKey::Position(u64)
DataKey::NextListingId
DataKey::NextPositionId
DataKey::WhitelistedCurrency(Address)  // -> Reflector asset symbol/identifier
```

---

##  Entrypoints

| Function | Auth | Description |
|---|---|---|
| `initialize(...)` | Admin | Set platform config: admin, fee receiver, oracle, bounds |
| `whitelist_currency(currency, reflector_asset)` | Admin | Approve a token as valid collateral |
| `create_listing(...)` | Lender | Escrow NFT, declare price, set interest schedule & terms |
| `cancel_listing(listing_id)` | Lender | Cancel open listing, return NFT to lender |
| `borrow(listing_id, borrower, currency, amount)` | Borrower | Post collateral, receive NFT (real ownership transfer) |
| `add_collateral(position_id, amount)` | Borrower | Top up collateral to avoid liquidation |
| `health_factor(position_id)` | View | Returns current health in bps |
| `return_nft(position_id)` | Borrower | Return NFT, pay interest+fee, reclaim remaining collateral |
| `liquidate(position_id)` | Permissionless | Settle under-collateralized or expired positions |
| `admin_update_bounds(...)` | Admin | Adjust platform-wide min/max buffer & threshold |
| `admin_set_fees(...)` | Admin | Update platform and liquidator fee bps |

---

##  Interest Accrual (Per-Month Schedule)

```
accrued_usd(position, now):
  elapsed_days = (now - start_time) / 86400
  full_months  = elapsed_days / 30
  partial_days = elapsed_days % 30

  total = 0
  for m in 0..full_months:
      rate = interest_schedule_bps[min(m, len-1)]
      total += declared_price_usd * rate / 10000

  partial_rate = interest_schedule_bps[min(full_months, len-1)]
  total += declared_price_usd * partial_rate / 10000 * partial_days / 30

  return total
```

---

##  Health Factor

```
health_factor_bps = collateral_usd_value * 10000 / (declared_price_usd + accrued_interest_usd)
```

- Lender sets starting buffer (e.g. 15000 = 150%) — must be within platform `[min_buffer_bps, max_buffer_bps]`.
- Lender sets liquidation threshold (e.g. 11000 = 110%) — must be within platform bounds **and** below the starting buffer.
- `borrow()` rejects if deposited collateral doesn't clear the starting buffer.
- `liquidate()` is open to anyone once health factor ≤ threshold, or term expires.

---

##  Settlement Waterfall (shared by `return_nft` + `liquidate`)

```
owed_usd          = declared_price_usd + accrued_interest_usd
platform_fee_usd  = owed_usd * platform_fee_bps / 10000
liquidator_fee_usd= owed_usd * liquidator_fee_bps / 10000   // 0 on voluntary return

total_debit_usd   = owed_usd + platform_fee_usd + liquidator_fee_usd
debit_tokens      = usd_to_token_amount(total_debit_usd, collateral_currency, current_price)

lender_payout      = usd_to_token_amount(owed_usd, ...)
platform_payout    = usd_to_token_amount(platform_fee_usd, ...)
liquidator_payout  = usd_to_token_amount(liquidator_fee_usd, ...)
borrower_remainder = collateral_amount - debit_tokens  // floor at 0
```

---

##  Known Risks (be explicit)

1. **NFT out of contract control once borrowed.** If a borrower resells or moves the NFT mid-term, there is no on-chain reclaim path. Lender's protection is collateral sizing — enforced platform bounds on buffer/threshold exist precisely to prevent thin buffers that can't absorb price moves.
2. **Oracle staleness/manipulation on collateral.** `max_price_staleness_secs` must hard-reject stale Reflector reads. Prefer Reflector's TWAP feed over latest-trade. Direct lesson from the Blend exploit.
3. **Keeper liveness.** `liquidate()` is permissionless, but requires someone to call it. Budget for running or subsidizing a keeper bot early before sufficient third-party volume exists.
4. **No partial principal repayment in v1.** Borrowers can only top up collateral via `add_collateral`, not reduce principal. Confirm this scope is acceptable for v1.

---

##  Getting Started (once code is populated)

```bash
cargo build --target wasm32-unknown-unknown --release
cargo test --features testutils
cargo fmt --check
cargo clippy -- -D warnings
stellar contract optimize --wasm target/wasm32-unknown-unknown/release/soroban_lending.wasm
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/soroban_lending.optimized.wasm --network testnet
```

---

##  Prerequisites

- Rust (stable)
- `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- Stellar CLI: `cargo install --locked stellar-cli`

---

##  Contributing

1. Fork this repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Ensure all CI checks pass:
   - `cargo fmt --check` — must exit 0
   - `cargo clippy -- -D warnings` — zero warnings
   - `cargo test --features testutils` — all tests must pass
   - `cargo build --target wasm32-unknown-unknown --release` — valid WASM produced
4. Open a PR — **all CI must pass before a PR is eligible for review and merge**

---

##  License

MIT — see [LICENSE](./LICENSE)
