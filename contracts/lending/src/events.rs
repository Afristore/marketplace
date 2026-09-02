use soroban_sdk::{contractevent, Address};

#[contractevent]
#[derive(Clone, Debug)]
pub struct BorrowEvent {
    #[topic]
    pub borrower: Address,
    pub collateral_amount: i128,
    pub borrow_amount: i128,
    pub timestamp: u64,
}
