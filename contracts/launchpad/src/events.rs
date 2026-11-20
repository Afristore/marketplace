use soroban_sdk::{symbol_short, Address, Env};

use crate::types::CollectionKind;

#[allow(deprecated)]
pub fn publish_deploy(
    env: &Env,
    tag: soroban_sdk::Symbol,
    creator: &Address,
    address: &Address,
    kind: &CollectionKind,
) {
    env.events().publish(
        (symbol_short!("deploy"), tag),
        (creator.clone(), address.clone(), kind.clone()),
    );
}

/// Emitted when a RoyaltySplitter is deployed. A splitter is not an NFT
/// collection, so the payload carries only `(creator, address)` and no
/// `CollectionKind`.
#[allow(deprecated)]
pub fn publish_deploy_splitter(env: &Env, creator: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("deploy"), symbol_short!("split")),
        (creator.clone(), address.clone()),
    );
}

#[allow(deprecated)]
pub fn publish_staking_deploy(
    env: &Env,
    creator: &Address,
    nft_address: &Address,
    pool_address: &Address,
) {
    env.events().publish(
        (symbol_short!("stake"), symbol_short!("pool")),
        (creator.clone(), nft_address.clone(), pool_address.clone()),
    );
}
