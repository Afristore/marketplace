use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum StakingError {
    AlreadyStaked = 1,
    NotStaked = 2,
    Unauthorized = 3,
    NoRewardsToClaim = 4,
    TransferFailed = 5,
    InvalidDuration = 6,
    ContractPaused = 7,
    AlreadyInitialized = 8,
    NotInitialized = 9,
    InvalidToken = 10,
    InsufficientRewardBalance = 11,
    RewardRateTooHigh = 12,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StakedPosition {
    pub owner: Address,
    pub token_address: Address,
    pub token_id: u64,
    pub staked_at: u64,
    pub rewards_earned: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RewardConfig {
    pub rewards_per_second: i128,
}
