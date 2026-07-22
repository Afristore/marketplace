# Soroban Contracts — Architecture

This directory contains eight Soroban smart contracts that form a complete NFT marketplace ecosystem on Stellar. All contracts are members of the Cargo workspace defined at the project root and compile to WASM via `cargo build --target wasm32v1-none --release`.

## Quick Reference

| Contract | Package | Entry | Purpose |
|---|---|---|---|
| `soroban-marketplace/` | `soroban-marketplace` | `src/contract.rs` | Listings, auctions, offers, buy/sell |
| `launchpad/` | `soroban-launchpad` | `src/contract.rs` | Factory — deterministic clone deployment |
| `collection_nft_erc721/` | `collection-nft-erc721` | `src/lib.rs` | Standard ERC-721 NFT collection |
| `collection_nft_erc1155/` | `collection-nft-erc1155` | `src/lib.rs` | Standard ERC-1155 NFT collection |
| `lazy_mint_erc721/` | `lazy-mint-erc721` | `src/lib.rs` | Lazy-mint ERC-721 (off-chain vouchers) |
| `lazy_mint_erc1155/` | `lazy-mint-erc1155` | `src/lib.rs` | Lazy-mint ERC-1155 (off-chain vouchers) |
| `nft-staking/` | `nft-staking` | `src/contract.rs` | Time-based NFT staking with rewards |
| `royalty-splitter/` | `royalty-splitter` | `src/contract.rs` | Distribute token balance among beneficiaries |

---

## Clone Factory Pattern (Launchpad)

The **launchpad** implements Soroban's equivalent of EIP-1167 minimal proxies. Instead of deploying the same contract bytecode multiple times by re-uploading WASM, a single WASM per collection type is uploaded once and its hash is registered on the launchpad. New collection instances are created via `env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, ())`, which produces a deterministic address from `sha256(factory_address ++ salt)`.

```
                        Launchpad (stored WASM hashes)
                     n721 │ n1155 │ l721 │ l1155 │ staking
                ┌─────────┴──┬─────┴──┬────┴──┬────┴───────┐
                ▼            ▼        ▼      ▼            ▼
         Normal721(1)  Normal1155(1)  ...  Lazy1155(N)  Staking(N)
         Normal721(2)  Normal1155(2)       (deterministic  (per-collection)
         (deterministic addresses)          addresses)
```

### Salt hardening

User-supplied salts are never passed directly to the deployer. The launchpad computes `make_secure_salt(creator, salt) = sha256(creator.to_xdr() ++ salt)` to create a creator-scoped namespace, preventing mempool front-running and address collisions.

### Atomic initialization

After deploying a clone, the launchpad immediately calls `initialize()` on the fresh instance via a cross-contract client interface (e.g., `INormal721Client::new(&env, &addr).initialize(...)`). Every collection is fully initialized in the same transaction — no second call required.

---

## Cross-Contract Interaction Graph

```
                          ┌───────────────────────┐
                          │     Launchpad          │
                          │  (WASM hashes, deploy) │
                          └──┬────┬────┬────┬──────┘
            deploy_normal_721 │    │    │    │ deploy_staking_pool
     deploy_normal_1155       │    │    │    │
          deploy_lazy_721 ────┘    │    │    │
         deploy_lazy_1155 ─────────┘    │    │
                                        │    │
                                        ▼    ▼
         ┌──────────────────────────┐  ┌──────────────┐
         │  Collection Contracts    │  │  NftStaking   │
         │  (4 types, N instances)  │  │(per-collection│
         │                          │  │   pool)       │
         │  royalty_info() ──────── │──│───►           │
         │  transfer_from() ─────── │──│───►           │
         └──────────┬───────────────┘  └───────────────┘
                    │                        ▲
                    │ transfer_from()         │ invoke_contract
                    │ royalty_info()          │ (stake/unstake)
                    ▼                        │
         ┌────────────────────────────────────┴───┐
         │          Soroban Marketplace            │
         │  create_listing / buy_artwork           │
         │  create_auction / place_bid             │
         │  make_offer / accept_offer              │
         │  distribute_payout (seller + royalty +  │
         │    protocol fee + recipient split)      │
         └─────────────────────────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │   RoyaltySplitter    │
         │ distribute()         │
         │ (anyone can trigger) │
         └──────────────────────┘
```

### Marketplace → Collection

When a listing is bought (or auction finalized, or offer accepted), the marketplace:
1. Transfers the NFT from seller to buyer via `env.invoke_contract(&collection, "transfer_from", ...)`
2. Queries `royalty_info()` on the collection to get the royalty receiver and BPS for payout splitting

### Marketplace → Token (Payment)

All payments use `soroban_sdk::token::TokenClient` to transfer the currency token (XLM as SAC, USDC, etc.) between buyer, seller, royalty receiver, treasury, and recipients.

### Launchpad → Token (Deployment Fee)

Each `deploy_*` call collects a platform fee from the creator using a whitelisted currency.

### NftStaking → Collection

Staking and unstaking call `transfer_from` on the NFT collection to move the token into and out of the staking contract.

---

## Event-Driven Architecture

All state changes that need off-chain indexing are emitted as Soroban events. Key events:

| Contract | Topics | Data |
|---|---|---|
| Launchpad | `deploy` + kind tag | `(creator, addr, kind)` |
| Marketplace | `lst_crtd`, `art_sold`, `lst_cncl`, `bid_plcd`, `auc_rslv`, `ofr_made`, `ofr_accp`, etc. | Listing/auction/offer data |
| Collections (721) | `mint`, `transfer`, `approve`, `burn` | Token ID, address |
| Collections (1155) | `TransferSingle`, `TransferBatch`, `appr_all` | Token ID, amount |
| Lazy Mint | `redeem`, `register` | Token ID |
| NftStaking | `staked`, `unstkd`, `reward` | User, token, amount |
| RoyaltySplitter | (none — state queried directly) | |

---

## Security Patterns

- **Reentrancy guards** — The marketplace uses temporary `ListingLock` / `AuctionLock` storage keys (100-ledger TTL) to prevent reentrancy during payout distribution.
- **Two-step admin transfer** — Marketplace admin handover uses a propose/accept pattern to prevent accidental transfer to an unrecoverable address.
- **Creator-bound salts** — `sha256(creator ++ raw_salt)` prevents front-running of deterministic deployments.
- **Voucher replay protection** — Lazy mint digests include the contract address and `uri_hash` so vouchers cannot be replayed across chains or collections.
- **TTL management** — Every public mutating call extends instance TTL; every `set()` on persistent storage is immediately followed by `extend_ttl()`.
- **Indexed storage** — The launchpad uses individual `DataKey::CollectionByIndex(u64)` keys instead of unbounded `Vec` blobs (see CONTRIBUTING.md rule #4).

---

## Build & Test

```bash
# Build all contracts
cargo build --target wasm32v1-none --release

# Run all contract tests
cargo test

# Run tests for a specific contract
cargo test -p soroban-marketplace

# Optimise a WASM for deployment
stellar contract optimize --wasm target/wasm32v1-none/release/soroban_marketplace.wasm
```

---

## Deployment Flow

1. **Upload WASMs** — Upload each contract's WASM via `stellar contract upload` and record the 32-byte hashes
2. **Deploy launchpad** — `stellar contract deploy` with the launchpad WASM
3. **Register hashes** — `set_wasm_hashes(4 x collection)`, `set_staking_wasm_hash`
4. **Create collections** — Users call `deploy_normal_721(...)` / `deploy_lazy_721(...)` etc.
5. **Create staking pools** — Users call `deploy_staking_pool(...)`
6. **Marketplace operations** — List, buy, auction, offer, stake, distribute royalties

See `scripts/deploy/DEPLOYMENT_GUIDE.md` for a step-by-step walkthrough.
