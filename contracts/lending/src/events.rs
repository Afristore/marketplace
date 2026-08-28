use soroban_sdk::{contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCreatedEvent {
    pub listing_id: u64,
    pub lender: Address,
    pub nft_contract: Address,
    pub token_id: u64,
    pub declared_price_usd: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListingCancelledEvent {
    pub listing_id: u64,
    pub lender: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionOpenedEvent {
    pub position_id: u64,
    pub listing_id: u64,
    pub borrower: Address,
    pub collateral_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CollateralAddedEvent {
    pub position_id: u64,
    pub borrower: Address,
    pub amount: i128,
    pub new_total: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionReturnedEvent {
    pub position_id: u64,
    pub interest_paid: i128,
    pub platform_fee: i128,
    pub borrower_refund: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionLiquidatedEvent {
    pub position_id: u64,
    pub liquidator: Address,
    pub lender_payout: i128,
    pub liquidator_bounty: i128,
    pub borrower_refund: i128,
}

/// Emits `(Symbol("lending"), Symbol("create"))` event when a lending listing is created.
pub fn emit_listing_created(
    env: &Env,
    listing_id: u64,
    lender: Address,
    nft_contract: Address,
    token_id: u64,
    declared_price_usd: i128,
) {
    let topics = (symbol_short!("lending"), symbol_short!("create"));
    let data = ListingCreatedEvent {
        listing_id,
        lender,
        nft_contract,
        token_id,
        declared_price_usd,
    };
    env.events().publish(topics, data);
}

/// Emits `(Symbol("lending"), Symbol("cancel"))` event when a listing is cancelled.
pub fn emit_listing_cancelled(env: &Env, listing_id: u64, lender: Address) {
    let topics = (symbol_short!("lending"), symbol_short!("cancel"));
    let data = ListingCancelledEvent { listing_id, lender };
    env.events().publish(topics, data);
}

/// Emits `(Symbol("lending"), Symbol("open"))` event when a borrower opens a position.
pub fn emit_position_opened(
    env: &Env,
    position_id: u64,
    listing_id: u64,
    borrower: Address,
    collateral_amount: i128,
) {
    let topics = (symbol_short!("lending"), symbol_short!("open"));
    let data = PositionOpenedEvent {
        position_id,
        listing_id,
        borrower,
        collateral_amount,
    };
    env.events().publish(topics, data);
}

/// Emits `(Symbol("lending"), Symbol("add_col"))` event when collateral is topped up.
pub fn emit_collateral_added(
    env: &Env,
    position_id: u64,
    borrower: Address,
    amount: i128,
    new_total: i128,
) {
    let topics = (symbol_short!("lending"), symbol_short!("add_col"));
    let data = CollateralAddedEvent {
        position_id,
        borrower,
        amount,
        new_total,
    };
    env.events().publish(topics, data);
}

/// Emits `(Symbol("lending"), Symbol("return"))` event when an NFT is voluntarily returned.
pub fn emit_position_returned(
    env: &Env,
    position_id: u64,
    interest_paid: i128,
    platform_fee: i128,
    borrower_refund: i128,
) {
    let topics = (symbol_short!("lending"), symbol_short!("return"));
    let data = PositionReturnedEvent {
        position_id,
        interest_paid,
        platform_fee,
        borrower_refund,
    };
    env.events().publish(topics, data);
}

/// Emits `(Symbol("lending"), Symbol("liq"))` event when a position is liquidated.
pub fn emit_position_liquidated(
    env: &Env,
    position_id: u64,
    liquidator: Address,
    lender_payout: i128,
    liquidator_bounty: i128,
    borrower_refund: i128,
) {
    let topics = (symbol_short!("lending"), symbol_short!("liq"));
    let data = PositionLiquidatedEvent {
        position_id,
        liquidator,
        lender_payout,
        liquidator_bounty,
        borrower_refund,
    };
    env.events().publish(topics, data);
}
