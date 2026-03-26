export interface TokenConfig {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export const SUPPORTED_TOKENS: TokenConfig[] = [
  {
    symbol: "XLM",
    name: "Stellar Lumen",
    address: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // Native XLM (Placeholder address often used for native in some Soroban contexts or similar)
    decimals: 7,
  },
  {
    symbol: "USDC",
    name: "USDC (Testnet)",
    address: "CCW67Z72VRYZUM3BWHXYG6PVDZ4NMLN73Y7U7E4S3W4M7I5VBDQXWIXI", // Example USDC Testnet
    decimals: 7,
  },
  {
    symbol: "AFRI",
    name: "Afristore Token",
    address: "CAS3J7GYLGXGR6AK3VTQBDG2YZQOEFV2TKEBKH6A76EABR76W3G6AB7C", // Example AFRI token
    decimals: 7,
  },
];

export const DEFAULT_TOKEN = SUPPORTED_TOKENS[0];
