use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SplitterError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    LengthMismatch = 3,
    NoBeneficiaries = 4,
    /// Shares must sum to exactly 10 000 BPS.
    InvalidShares = 5,
    TooManyBeneficiaries = 6,
    BeneficiaryNotFound = 7,
}
