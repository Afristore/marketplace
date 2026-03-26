use soroban_sdk::{contract, contractimpl, Env, String};

#[contract]
pub struct LazyMintErc721Contract;

#[contractimpl]
impl LazyMintErc721Contract {
    pub fn contract_type(env: Env) -> String {
        String::from_str(&env, "lazy_mint_erc721")
    }
}
