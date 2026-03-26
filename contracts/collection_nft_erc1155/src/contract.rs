use soroban_sdk::{contract, contractimpl, Env, String};

#[contract]
pub struct CollectionNftErc1155Contract;

#[contractimpl]
impl CollectionNftErc1155Contract {
    pub fn contract_type(env: Env) -> String {
        String::from_str(&env, "collection_nft_erc1155")
    }
}
