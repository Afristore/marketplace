use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    WasmHashNotSet = 4,
}

/// Which of the four collection types was deployed.
#[contracttype]
#[derive(Clone)]
pub enum CollectionKind {
    Normal721,
    Normal1155,
    LazyMint721,
    LazyMint1155,
}

/// A record stored for every deployed collection.
#[contracttype]
#[derive(Clone)]
pub struct CollectionRecord {
    pub address: Address,
    pub kind: CollectionKind,
    pub creator: Address,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Initialized,
    Admin,
    PlatformFeeReceiver,
    PlatformFeeBps,
    WasmNormal721,
    WasmNormal1155,
    WasmLazy721,
    WasmLazy1155,
    CollectionCount,
    ByCreator(Address),            // Address → Vec<CollectionRecord> (legacy, will be removed)
    AllCollections,                // Vec<CollectionRecord> (legacy, will be removed)
    /// Indexed collection by global index (#51)
    CollectionByIndex(u64),
    /// Per-creator collection count (#51)
    CreatorCollectionCount(Address),
    /// Per-creator indexed collection (#51)
    CreatorCollectionByIndex(Address, u64),
}
