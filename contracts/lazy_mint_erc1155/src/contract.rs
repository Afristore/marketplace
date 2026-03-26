use soroban_sdk::{contract, contractimpl, Env, String};

#[contract]
pub struct LazyMintErc1155Contract;

#[contractimpl]
impl LazyMintErc1155Contract {
    pub fn contract_type(env: Env) -> String {
        String::from_str(&env, "lazy_mint_erc1155")
    }
}
