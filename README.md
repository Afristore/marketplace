# Afristore

> Decentralized marketplace for African art, built on Stellar + Soroban smart contracts.

## Architecture

```
Freighter/Magic Wallet ──► Next.js Frontend ──► Soroban Contracts (Stellar)
                              │       │
                              │       ▼
                              │  Pinata IPFS
                              │  (Images + Metadata)
                              │
                              ▼
                         Indexer (Node.js)
                              │
                              ▼
                         PostgreSQL (events, listings, offers, auctions)
                              │
                              ▼
                         Redis Cache + Prometheus Metrics
```

## Monorepo Structure

```
afristore/
├── contracts/
│   ├── soroban-marketplace/      # Main marketplace contract (Rust/Soroban)
│   │   ├── src/
│   │   │   ├── lib.rs            # Contract entry point
│   │   │   ├── types.rs          # Listing, Auction, Offer, Status, Error types
│   │   │   ├── storage.rs        # Persistent/temporary storage key helpers
│   │   │   ├── contract.rs       # Core marketplace logic
│   │   │   ├── events.rs         # Event structs and publish helpers
│   │   │   └── test.rs           # Comprehensive tests
│   │   └── docs/
│   │       ├── PAUSE_MECHANISM.md
│   │       └── event_schema.md
│   ├── launchpad/                # Collection factory contract
│   ├── collection_nft_erc721/    # Standard ERC-721 NFT contract
│   ├── collection_nft_erc1155/   # Standard ERC-1155 NFT contract
│   ├── lazy_mint_erc721/         # Gas-efficient lazy-mint ERC-721
│   ├── lazy_mint_erc1155/        # Gas-efficient lazy-mint ERC-1155
│   └── CONTRIBUTING.md
├── frontend/
│   └── afristore-app/            # Next.js 14 App Router frontend
│       ├── src/
│       │   ├── app/              # App Router pages (listings, auctions, offers, launchpad, profile, admin, settings)
│       │   ├── components/       # Reusable UI components
│       │   ├── lib/              # Stellar SDK, IPFS, contract helpers, indexer client
│       │   ├── hooks/            # React hooks (wallet, marketplace, auctions, offers, admin)
│       │   ├── context/          # WalletContext (unified Freighter + Magic)
│       │   ├── providers/        # PostHog analytics provider
│       │   └── config/           # Token config
│       ├── e2e/                  # Playwright E2E tests
│       ├── __tests__/            # Unit tests (28 test files)
│       └── docs/
│           └── MAGIC_WALLET_INTEGRATION.md
├── indexer/                      # PostgreSQL event indexer
│   ├── src/
│   │   ├── poller.ts             # Stellar RPC event poller + reorg detection
│   │   ├── parser.ts             # XDR event decoder
│   │   ├── db.ts                 # Prisma client
│   │   ├── redis.ts              # Lazy Redis cache client
│   │   ├── metrics.ts            # Prometheus metrics (sync latency, request duration)
│   │   ├── index.ts              # Express API server
│   │   ├── api/
│   │   │   ├── routes.ts         # REST endpoints (listings, auctions, offers, collections, wallets)
│   │   │   ├── cache-middleware.ts
│   │   │   └── rate-limit-middleware.ts
│   │   └── __tests__/            # 7 test files
│   ├── prisma/
│   │   └── schema.prisma         # DB models: SyncState, Listing, Auction, Offer, MarketplaceEvent, Collection
│   └── docker-compose.yml
├── scripts/
│   └── deploy/                   # Deployment scripts for Soroban contracts
└── .github/
    └── workflows/ci.yml          # CI pipeline (Rust/cargo + frontend + indexer tests)
```

## Quick Start

### 1. Deploy Soroban contracts (Testnet)

```bash
cd scripts/deploy
./fund_account.sh          # fund a new keypair on testnet
./deploy_contract.sh       # build + deploy marketplace contract
# See contracts/launchpad/README.md for collection factory deployment
```

### 2. Start the Local Environment

Instead of starting the indexer and frontend in separate terminals, we use a unified startup script at the root:

> **Important:** Run `npm install` at the **repository root** before `npm run dev`. This installs the root-level `concurrently` dev dependency and automatically generates the Prisma Client. If you skip this step, `npm run dev` will fail with `sh: concurrently: command not found` or Prisma initialization errors.

```bash
# 1. Ensure you have copied the environment files:
cd indexer && cp .env.example .env
cd ../frontend/afristore-app && cp .env.example .env.local
cd ../..

# 2. Install root dependencies (generates Prisma Client automatically):
npm install

# 3. Run the database migrations for the indexer:
cd indexer && npx prisma migrate deploy && cd ..

# 4. Start all services concurrently:
npm run dev
```

The `postinstall` script automatically runs `npx prisma generate` in the indexer workspace, ensuring the Prisma Client is available before the indexer API and crank bot start.

This will concurrently start the frontend (Next.js), the indexer backend, and a Keep-Alive bot (`crank`) to ensure testnet contracts are not archived.

Open [http://localhost:3000](http://localhost:3000)

## Features

### Marketplace
- Create, update, and cancel listings with IPFS metadata
- Buy artwork with XLM or whitelisted tokens
- Make, accept, reject, and withdraw offers
- Create auctions with reserve price, place bids, finalize expired auctions
- Royalty distribution (original creator receives royalty on resales)
- Protocol fee configured by admin
- Artist revocation/reinstatement

### Admin
- Set admin (1-step) and transfer admin (2-step propose/accept)
- Configure treasury address and protocol fee BPS
- Admin pause/unpause (circuit breaker) blocking all marketplace operations
- Add/remove tokens from payment whitelist
- Revoke/reinstate artists
- Dashboard with fee management, collection registry, listing oversight, event log, creator profiles

### Launchpad
- Deploy NFT collections (normal 721/1155, lazy-mint 721/1155)
- Deploy standalone Royalty Splitter contracts for multi-party secondary sale royalties
- Salt-based front-running protection
- Platform fee configuration per-collection
- Collection creation wizard in frontend

### Indexer
- Real-time event polling from Stellar RPC with configurable interval
- Ledger hash continuity verification + automatic reorg rollback
- Prometheus metrics (sync latency, request duration, processed ledger gauge)
- Redis caching with configurable TTL
- Rate limiting via express-rate-limit
- REST API: listings, auctions, offers, collections, wallet activity, royalty stats
- Stores all events, listings, auctions, offers, and collections in PostgreSQL
- Includes a background **Keep-Alive Bot (`crank.ts`)** that periodically simulates reads on active contracts to bump their Time-To-Live (TTL) and prevent state archival on testnet.

### Royalty Splitter

The `royalty-splitter` contract (`contracts/royalty-splitter/`) is a standalone Soroban contract that splits token royalty flows between multiple beneficiaries according to immutable BPS (basis-point) shares.

**How it works:**

1. **Deploy** — An artist or the Launchpad factory deploys a fresh `RoyaltySplitter` instance per collection.
2. **Initialize** — Call `initialize(token, beneficiaries, shares)` once to permanently lock in the payment token, beneficiary addresses, and their BPS shares. Shares must sum to exactly 10 000. This call is irreversible.
3. **Distribute** — Anyone may call `distribute()` at any time. The contract reads its full token balance and transfers each beneficiary's proportional share. The final beneficiary absorbs any integer rounding remainder so no dust is ever trapped.

**Deploying a splitter via the Launchpad (artist flow):**

```bash
# 1. Build and upload the royalty-splitter WASM
cd contracts/royalty-splitter
cargo build --target wasm32-unknown-unknown --release
SPLITTER_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/royalty_splitter.wasm \
  --network testnet --source deployer)

# 2. Deploy a splitter instance for the collection
SPLITTER=$(stellar contract deploy \
  --wasm-hash $SPLITTER_HASH --network testnet --source creator)

# 3. Initialize with up to 10 beneficiaries (shares must sum to 10 000)
stellar contract invoke --id $SPLITTER --network testnet --source creator \
  --fn initialize -- \
  --token USDC_CONTRACT_ADDRESS \
  --beneficiaries '["GCREATOR_ADDRESS", "GCOLLABORATOR_ADDRESS"]' \
  --shares '[7500, 2500]'

# 4. Anyone can trigger a payout at any time
stellar contract invoke --id $SPLITTER --network testnet --source anyone \
  --fn distribute
```

**Key constraints:**
- Maximum 10 beneficiaries per splitter.
- Beneficiaries and shares are immutable after `initialize` — deploy a new splitter instance to change splits.
- `distribute()` requires no authentication, making it safe to automate or call from a keeper bot.

## Crank (Keep-Alive Bot)

Soroban contracts on testnet are subject to state archival: if a contract's ledger entries are not accessed within a certain number of ledgers, they are evicted and the contract stops responding. The **Crank bot** (`indexer/src/crank.ts`) prevents this by periodically simulating cheap read operations against each active contract, refreshing their Time-To-Live (TTL) without any fees or on-chain signatures.

### What it does

On each tick the crank:
1. Calls `get_protocol_fee` on the main marketplace contract (a read-only function that loads contract state).
2. Queries the 20 most recently deployed collections from the indexer database and calls `name` on each, keeping the freshest NFT contracts alive.

A failed simulation is logged but never halts the bot — a temporarily unavailable contract does not interrupt the keep-alive cycle for others.

### Configuration

All options are controlled via environment variables in `indexer/.env`:

| Variable | Default | Description |
|---|---|---|
| `CRANK_INTERVAL_MS` | `300000` (5 min) | Milliseconds between keep-alive ticks |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint used for simulations |
| `STELLAR_NETWORK_PASSPHRASE` | Test SDF passphrase | Network passphrase for transaction building |
| `MARKETPLACE_CONTRACT_ID` | _(required)_ | Contract ID of the marketplace to keep alive |

The bot starts automatically as part of `npm run dev` via the root `concurrently` script. It can also be run standalone:

```bash
cd indexer
npm run crank
```

### Graceful shutdown

The crank registers `SIGINT` / `SIGTERM` handlers. On receiving either signal it stops the keep-alive loop and cleanly disconnects the Prisma database client before exiting.

## Indexer API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/listings` | List listings with filters (artist, status, minPrice, maxPrice, search) |
| GET | `/listings/:id` | Single listing with IPFS metadata |
| GET | `/listings/:id/history` | Event history for a listing |
| GET | `/auctions` | List auctions with filters |
| GET | `/auctions/:id` | Single auction details |
| GET | `/offers?listing_id=` | Offers for a listing |
| GET | `/collections` | All collections with optional kind/creator filters |
| GET | `/creators/:address/collections` | Collections by creator |
| GET | `/wallets/:address/activity` | Wallet transaction history |
| GET | `/wallets/:address/royalty-stats` | Royalty earnings for an artist |
| GET | `/health` | Health check (DB, Redis, poller status) |
| GET | `/metrics` | Prometheus metrics |

## Current Testnet Deployment (2026-06-20)

| Item | Address / ID | Notes |
|---|---|---|
| Deployer / Admin Wallet | `GBFUNHEQOVN35LFEKP7SZXFYJPMJ3WLXLX4PQZGBK737NTLRHOKVES3F` | Testnet account |
| Marketplace (active) | `CCE43HCMI53ANOL3BSSQYXAVBSSKW6CXXGSTNTUEIPHQDTWYILTKFAR5` | Frontend default |
| Launchpad Factory | `CDVWRCQLULIFF635VU77DJRXRWREASG7OENHUTRPY553BMPQJT7GLM7H` | Initialised with WASM hashes |
| Normal 721 Collection | `CA6DGVWNLKKJOKTXKCEHVWD57RSRIAAMPAQKTAKY3SKCP5QN4UNP4ACT` | Deployed via launchpad |
| Normal 1155 Collection | `CB5SXUJF5BEYJHAFLZV655COZBNETEGDHOQB3EO2XDT2GY3Z3MDZCZOF` | Deployed via launchpad |
| Lazy 721 Collection | `CCRQ5WQNR7IC52ZR6A2KOIGU7VTXJXGTH3CFLXTWK246FKM3X3IFOFEU` | Deployed via launchpad |
| Lazy 1155 Collection | `CB5A7IEUI3V7YFYTC3OS2JZJXTSQ5OJWACWJ35K5ELYE2OOE7TKYGWKH` | Deployed via launchpad |
| WASM Normal 721 | `f30ec91a14455d1df413aeeeb50b45006635f1d07c428451c9e48d8491defd4d` | Installed hash |
| WASM Normal 1155 | `4f75324c7833a76f78600fa1852872fc75a16889e99a386e1f33efd3b8f95c6c` | Installed hash |
| WASM Lazy 721 | `ca1fc3ce988235f088c332c52550b49e4dc427ea2a48827440d334a042ddec2e` | Installed hash |
| WASM Lazy 1155 | `f71b7c5c82243f4b5176c554615b08e2d228043b51cdb9023813a94ae2db9f4f` | Installed hash |

## Environment Variables

### Frontend (`frontend/afristore-app/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Soroban marketplace contract address |
| `NEXT_PUBLIC_STELLAR_NETWORK` | `testnet` or `mainnet` |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC endpoint |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | Horizon API endpoint |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network passphrase |
| `NEXT_PUBLIC_PINATA_GATEWAY` | Pinata IPFS gateway URL |
| `NEXT_PUBLIC_INDEXER_URL` | Indexer API base URL |
| `PINATA_JWT` | Pinata JWT for server-side uploads (private) |

### Indexer (`indexer/.env`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `MARKETPLACE_CONTRACT_ID` | Soroban marketplace contract ID |
| `LAUNCHPAD_CONTRACT_ID` | Launchpad factory contract ID |
| `REDIS_URL` | Redis connection string (optional) |
| `STELLAR_RPC_URL` | Stellar RPC endpoint |
| `PORT` | API server port |
| `CORS_ORIGIN` | Allowed CORS origins (comma-separated) |
| `POLL_INTERVAL_MS` | Event poll interval in ms |

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Blockchain | Stellar / Soroban |
| Smart Contracts | Rust (soroban-sdk) |
| Wallet | Freighter + Magic.link (email/passkey) |
| Storage | IPFS via Pinata |
| Indexer | Node.js, Express, Prisma, PostgreSQL |
| Cache | Redis |
| Monitoring | Prometheus, Sentry |
| Analytics | PostHog |
| Testing | Rust `#[test]`, Jest, Playwright, Vitest |
| CI/CD | GitHub Actions (cargo + frontend + indexer) |

## Future Plan

### 1) Split into dedicated repositories
- `afristore-frontend` — Next.js app, wallet UX, discovery, creator dashboard
- `afristore-backend` — Indexer, API, search, analytics, admin services
- `afristore-contracts` — Soroban marketplace, auction, royalty, protocol contracts

### 2) Marketplace evolution
- Enable clean primary and secondary sales flow
- Preserve `original_creator` + royalty rules across all resales
- Keep protocol fee and payout splitting fully on-chain

### 3) Launchpad growth
- Configurable drop mechanics (fixed price, timed drop, allowlist)
- Primary mint + instant listing pipeline
- Launch metrics dashboard (mints, volume, conversion)

## Deploy Workflow

### 1 — Deploy Launchpad factory and collection WASMs

```bash
cd scripts/deploy
./fund_account.sh
./deploy_contract.sh

# Upload WASMs and deploy launchpad
HASH_N721=$(stellar contract upload --wasm target/.../normal_721.wasm --network testnet --source deployer)
HASH_N1155=$(stellar contract upload --wasm target/.../normal_1155.wasm --network testnet --source deployer)
HASH_L721=$(stellar contract upload --wasm target/.../lazy_721.wasm --network testnet --source deployer)
HASH_L1155=$(stellar contract upload --wasm target/.../lazy_1155.wasm --network testnet --source deployer)

LAUNCHPAD=$(stellar contract deploy --wasm target/.../launchpad.wasm --network testnet --source deployer)

stellar contract invoke --id $LAUNCHPAD --network testnet --source deployer \
  --fn initialize -- --admin $ADMIN_ADDRESS \
  --platform_fee_receiver $ADMIN_ADDRESS --platform_fee_bps 0

stellar contract invoke --id $LAUNCHPAD --network testnet --source deployer \
  --fn set_wasm_hashes -- \
  --wasm_normal_721 $HASH_N721 --wasm_normal_1155 $HASH_N1155 \
  --wasm_lazy_721 $HASH_L721 --wasm_lazy_1155 $HASH_L1155
```

### 2 — Create a collection (user flow)

```bash
stellar contract invoke --id $LAUNCHPAD --network testnet --source creator \
  --fn deploy_normal_721 -- \
  --creator $CREATOR_ADDRESS --name "My Collection" --symbol "MYC" \
  --max_supply 10000 --royalty_bps 500 --royalty_receiver $CREATOR_ADDRESS \
  --salt $(openssl rand -hex 32)
```

### 3 — Marketplace deployment

```bash
cd indexer
cp .env.example .env
# Set MARKETPLACE_CONTRACT_ID, LAUNCHPAD_CONTRACT_ID, DATABASE_URL
npx prisma migrate deploy
npm install && npm run build && npm start
```

## Admin Dashboard

The admin dashboard (`/admin`) provides platform operators with:

| Feature | Description |
|---|---|
| Fee management | View and update platform fee BPS and receiver address |
| Collection registry | Browse all deployed collections with creator and kind |
| Listing oversight | View all active, sold, and cancelled listings |
| Event log | Full on-chain event timeline per listing |
| Creator profiles | Collections and activity per creator address |

Access at `http://localhost:3000/admin` — wallet must match the admin address set during launchpad initialization.
