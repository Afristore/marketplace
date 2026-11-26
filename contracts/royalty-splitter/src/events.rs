use soroban_sdk::{Address, Env, Symbol};

#[allow(deprecated)]
pub fn publish_distributed(
    env: &Env,
    token: Address,
    total_balance: i128,
    distributed: i128,
    caller: Address,
) {
    env.events().publish(
        (Symbol::new(env, "splitter_distributed"),),
        (token, total_balance, distributed, caller),
    );
}

#[allow(deprecated)]
pub fn publish_token_rescued(
    env: &Env,
    token: Address,
    recipient: Address,
    amount: i128,
) {
    env.events().publish(
        (Symbol::new(env, "token_rescued"),),
        (token, recipient, amount),
    );
}
