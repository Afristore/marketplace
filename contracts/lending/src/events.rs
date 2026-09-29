use soroban_sdk::{contracttype, symbol_short, Address, Env};

// ── Event data structs ────────────────────────────────────────────────────────

/// Data emitted when a lender creates a new listing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCreatedData {
    pub listing_id: u64,
    pub lender: Address,
    pub nft_contract: Address,
    pub token_id: u128,
    pub declared_price_usd: i128,
}

/// Data emitted when a lender cancels an open listing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCancelledData {
    pub listing_id: u64,
    pub lender: Address,
}

/// Data emitted when a borrower opens a position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionOpenedData {
    pub position_id: u64,
    pub listing_id: u64,
    pub borrower: Address,
    pub collateral_amount: i128,
}

/// Data emitted when a borrower adds more collateral to a position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralAddedData {
    pub position_id: u64,
    pub borrower: Address,
    pub amount: i128,
    pub new_total: i128,
}

/// Data emitted when a borrower voluntarily returns the NFT and closes the position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionReturnedData {
    pub position_id: u64,
    pub interest_paid: i128,
    pub platform_fee: i128,
    pub borrower_refund: i128,
}

/// Data emitted when a position is liquidated.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionLiquidatedData {
    pub position_id: u64,
    pub liquidator: Address,
    pub lender_payout: i128,
    pub liquidator_bounty: i128,
    pub borrower_refund: i128,
}

// ── Emit helpers ──────────────────────────────────────────────────────────────

/// Emitted by `create_listing` when a lender lists an NFT for lending.
pub fn emit_listing_created(
    env: &Env,
    listing_id: u64,
    lender: Address,
    nft_contract: Address,
    token_id: u128,
    declared_price_usd: i128,
) {
    let data = ListingCreatedData {
        listing_id,
        lender,
        nft_contract,
        token_id,
        declared_price_usd,
    };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("lst_crtd")), data);
}

/// Emitted by `cancel_listing` when a lender withdraws an open listing.
pub fn emit_listing_cancelled(env: &Env, listing_id: u64, lender: Address) {
    let data = ListingCancelledData { listing_id, lender };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("lst_cncl")), data);
}

/// Emitted by `borrow` when a borrower opens a new position.
pub fn emit_position_opened(
    env: &Env,
    position_id: u64,
    listing_id: u64,
    borrower: Address,
    collateral_amount: i128,
) {
    let data = PositionOpenedData {
        position_id,
        listing_id,
        borrower,
        collateral_amount,
    };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("pos_open")), data);
}

/// Emitted by `add_collateral` when a borrower tops up their collateral.
pub fn emit_collateral_added(
    env: &Env,
    position_id: u64,
    borrower: Address,
    amount: i128,
    new_total: i128,
) {
    let data = CollateralAddedData {
        position_id,
        borrower,
        amount,
        new_total,
    };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("col_add")), data);
}

/// Emitted by `return_nft` when a borrower voluntarily closes a position.
pub fn emit_position_returned(
    env: &Env,
    position_id: u64,
    interest_paid: i128,
    platform_fee: i128,
    borrower_refund: i128,
) {
    let data = PositionReturnedData {
        position_id,
        interest_paid,
        platform_fee,
        borrower_refund,
    };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("pos_ret")), data);
}

/// Emitted by `liquidate` when a position is liquidated.
pub fn emit_position_liquidated(
    env: &Env,
    position_id: u64,
    liquidator: Address,
    lender_payout: i128,
    liquidator_bounty: i128,
    borrower_refund: i128,
) {
    let data = PositionLiquidatedData {
        position_id,
        liquidator,
        lender_payout,
        liquidator_bounty,
        borrower_refund,
    };
    #[allow(deprecated)]
    env.events()
        .publish((symbol_short!("lending"), symbol_short!("pos_liq")), data);
}
