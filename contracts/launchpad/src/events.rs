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
