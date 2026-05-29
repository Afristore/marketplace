use soroban_sdk::{Address, Env, Symbol};

use crate::types::CollectionKind;

/// Emit a collection-deploy event the indexer can parse (#76).
///
/// The topic is a single symbol (`dep_n721`, `dep_n1155`, `dep_l721`,
/// `dep_l1155`) matching the indexer's `TOPIC_MAP`, and the value is the
/// tuple `(creator, collection_address, kind)` so the parser/poller can
/// record the deployment without an extra chain query.
pub fn publish_deploy(
    env: &Env,
    tag: Symbol,
    creator: &Address,
    address: &Address,
    kind: CollectionKind,
) {
    env.events()
        .publish((tag,), (creator.clone(), address.clone(), kind));
}
