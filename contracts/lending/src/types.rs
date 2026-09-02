use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum LendingError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidCollateral = 4,
    InvalidAmount = 5,
    InsufficientLiquidity = 6,
    PositionNotFound = 7,
    ContractPaused = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BorrowPosition {
    pub borrower: Address,
    pub collateral_amount: i128,
    pub borrow_amount: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    CollateralToken,
    BorrowToken,
    IsInitialized,
    IsPaused,
    BorrowPosition(Address),
}
