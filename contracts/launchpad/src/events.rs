use soroban_sdk::{symbol_short, Address, Env};

#[allow(deprecated)]
pub fn publish_deploy(env: &Env, tag: soroban_sdk::Symbol, creator: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("deploy"), tag),
        (creator.clone(), address.clone()),
    );
}
