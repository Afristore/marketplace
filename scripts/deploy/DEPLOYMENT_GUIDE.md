# Afristore — Deployment Guide (Stellar Testnet)

## Prerequisites

Install the required tools:

```bash
# 1. Rust + wasm32 target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# 2. Stellar CLI (≥ 0.22)
cargo install --locked stellar-cli --features opt

# 3. Verify
stellar --version
cargo --version
```

---

## Step 1 — Fund a Testnet Account

```bash
cd scripts/deploy
./fund_account.sh
```

This creates a fresh Stellar keypair, funds it via Friendbot, and writes
the credentials to `scripts/deploy/.env.deploy`.

> **Never commit `.env.deploy` to version control.**

---

## Step 2 — Build & Deploy the Contract

```bash
./deploy_contract.sh
```

The script:
1. Compiles the Rust contract to WASM (`cargo build --target wasm32v1-none --release`)
2. Optimises the WASM with `stellar contract optimize`
3. Uploads the WASM blob to the Stellar network (`stellar contract install`)
4. Deploys an instance of the contract (`stellar contract deploy`)
5. Writes `frontend/afristore-app/.env.local` with the contract ID automatically

Sample output:
```
Step 1/4  Building contract WASM...
Step 2/4  Optimising WASM...  WASM size: 14238 bytes
Step 3/4  Uploading WASM to testnet...  WASM hash: abc123...
Step 4/4  Deploying contract instance...  Contract ID: CXXX...
✓ Deployment complete!
```

---

## Step 3 — Configure IPFS (Pinata)

1. Sign up at [app.pinata.cloud](https://app.pinata.cloud)
2. Go to **API Keys → New Key** and generate a JWT
3. Copy the JWT into `frontend/afristore-app/.env.local`:

```env
PINATA_JWT=eyJhbGciOiJIUzI1NiIs...
NEXT_PUBLIC_PINATA_GATEWAY=https://gateway.pinata.cloud
```

---

## Step 4 — Run the Frontend

```bash
cd frontend/afristore-app
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Step 5 — Set Up Freighter Wallet

1. Install the Freighter browser extension: [freighter.app](https://www.freighter.app)
2. Create or import a wallet
3. Switch to **Testnet** in the Freighter settings
4. Visit [https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY](https://friendbot.stellar.org) to fund your test wallet with XLM

---

## Manual Contract Invocation (CLI)

Test the contract directly from the terminal:

```bash
# Source your deploy credentials
source scripts/deploy/.env.deploy

# ── create_listing ────────────────────────────────────────────
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET \
  --rpc-url $RPC_URL \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- create_listing \
  --artist $STELLAR_PUBLIC \
  --token $TOKEN_CONTRACT \
  --collection $COLLECTION_CONTRACT \
  --token_id 1 \
  --price 10000000 \
  --currency XLM \
  --recipients "[{\"address\":\"$STELLAR_PUBLIC\",\"percentage\":100}]"

# ── get_total_listings ────────────────────────────────────────
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET \
  --rpc-url $RPC_URL \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- get_total_listings

# ── get_listing ───────────────────────────────────────────────
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET \
  --rpc-url $RPC_URL \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- get_listing \
  --listing_id 1

# ── buy_artwork ───────────────────────────────────────────────
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET \
  --rpc-url $RPC_URL \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- buy_artwork \
  --buyer $STELLAR_PUBLIC \
  --listing_id 1

# ── cancel_listing ────────────────────────────────────────────
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $STELLAR_SECRET \
  --rpc-url $RPC_URL \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- cancel_listing \
  --artist $STELLAR_PUBLIC \
  --listing_id 1
```

---

## Contract Storage Layout

```
Persistent Storage Keys
─────────────────────────────────────────────────────────────
DataKey::ListingCount             → u64
  Global auto-increment counter. Incremented on every create_listing.

DataKey::Listing(listing_id: u64) → Listing { ... }
  Full listing struct. TTL extended on every read/write (~30 days).

DataKey::ArtistListings(Address)  → Vec<u64>
  Ordered list of listing IDs created by a given artist address.
  Appended to on every create_listing.
```

---

## Deploying to Mainnet

1. Change `NETWORK=mainnet` and update RPC/Horizon URLs in `.env.deploy`:
   ```
   RPC_URL=https://soroban-mainnet.stellar.org
   HORIZON_URL=https://horizon.stellar.org
   ```
2. Change the network passphrase in `deploy_contract.sh`:
   ```
   --network-passphrase "Public Global Stellar Network ; September 2015"
   ```
3. Fund your deployer account with real XLM (not Friendbot)
4. Re-run `./deploy_contract.sh`
5. Update `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` and the passphrases in `.env.local`

---

## Useful Links

| Resource | URL |
|---|---|
| Stellar Docs | https://developers.stellar.org |
| Soroban Docs | https://soroban.stellar.org |
| Stellar CLI | https://github.com/stellar/stellar-cli |
| Freighter | https://www.freighter.app |
| Pinata IPFS | https://pinata.cloud |
| Testnet Explorer | https://stellar.expert/explorer/testnet |
| Horizon Testnet | https://horizon-testnet.stellar.org |
| Friendbot | https://friendbot.stellar.org |

---

## Launchpad Deploy Workflow

### Environment Variables

| Variable | Description |
|---|---|
| `MARKETPLACE_CONTRACT_ID` | Deployed marketplace Soroban contract ID |
| `LAUNCHPAD_CONTRACT_ID` | Deployed launchpad factory contract ID |
| `DATABASE_URL` | PostgreSQL connection string for the indexer |
| `STELLAR_RPC_URL` | Soroban RPC endpoint (default: testnet) |
| `POLL_INTERVAL_MS` | Indexer polling interval in ms (default: 5000) |
| `PORT` | Indexer API port (default: 3001) |

### Contract Hash Verification & Version Lock

After uploading WASMs, record and verify hashes before invoking `set_wasm_hashes`:
```bash
# Verify a WASM hash matches your local build
stellar contract upload --wasm target/.../normal_721.wasm --network testnet --source deployer --check
# Compare output hash against your pinned value in .env.deploy:
# HASH_N721=abc123...   ← commit this to your deploy lockfile
```

Store all four hashes in `scripts/deploy/.env.deploy` and never overwrite without a new build + audit.

### Local Dev — Docker Compose

The indexer ships with a `docker-compose.yml` for local development:
```bash
cd indexer
cp .env.example .env          # fill in contract IDs
docker compose up -d          # starts PostgreSQL + indexer API
docker compose logs -f        # tail logs

# Run Prisma migrations inside the container
docker compose exec indexer npx prisma migrate deploy
```

Services started:

| Service | Port | Description |
|---|---|---|
| `postgres` | 5432 | PostgreSQL database |
| `indexer` | 3001 | Indexer + REST API |

To reset the database:
```bash
docker compose down -v && docker compose up -d
```
