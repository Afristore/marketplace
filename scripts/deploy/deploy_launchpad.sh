#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.deploy"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Afristore — Deploy Launchpad to Testnet"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
  exit 1
fi
source "$ENV_FILE"

# 1. Build everything
echo "Step 1/6  Building contracts..."
cd "$REPO_ROOT"
cargo build --target wasm32v1-none --release -p soroban-launchpad -p collection-nft-erc721 -p collection-nft-erc1155 -p lazy-mint-erc721 -p lazy-mint-erc1155 -p nft-staking

# 2. Optimize
echo "Step 2/6  Optimizing WASM..."
TARGET_DIR="$REPO_ROOT/target/wasm32v1-none/release"
for WASM in soroban_launchpad collection_nft_erc721 collection_nft_erc1155 lazy_mint_erc721 lazy_mint_erc1155 nft_staking; do
  stellar contract optimize --wasm "$TARGET_DIR/$WASM.wasm" --wasm-out "$TARGET_DIR/$WASM.wasm" || true
done

# 3. Upload NFT WASMs
echo "Step 3/6  Uploading NFT WASMs..."
upload_wasm() {
  local output
  output=$(stellar contract upload \
    --wasm "$TARGET_DIR/$1.wasm" \
    --source "$STELLAR_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "Test SDF Network ; September 2015" \
    --ignore-checks 2>&1) || { echo "$output" >&2; exit 1; }
  echo "$output" | tail -1
}

HASH_N721=$(upload_wasm collection_nft_erc721)
echo "  Normal 721 Hash:   $HASH_N721"
HASH_N1155=$(upload_wasm collection_nft_erc1155)
echo "  Normal 1155 Hash:  $HASH_N1155"
HASH_L721=$(upload_wasm lazy_mint_erc721)
echo "  Lazy 721 Hash:     $HASH_L721"
HASH_L1155=$(upload_wasm lazy_mint_erc1155)
echo "  Lazy 1155 Hash:    $HASH_L1155"
HASH_STAKING=$(upload_wasm nft_staking)
echo "  Staking Hash:      $HASH_STAKING"

# 4. Deploy Launchpad
echo "Step 4/6  Deploying Launchpad..."
  LAUNCHPAD_WASM_HASH=$(upload_wasm soroban_launchpad)
  output=$(stellar contract deploy \
  --wasm-hash "$LAUNCHPAD_WASM_HASH" \
  --source "$STELLAR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  --ignore-checks 2>&1) || { echo "$output" >&2; exit 1; }
LAUNCHPAD_ID=$(echo "$output" | tail -1)
echo "  Launchpad ID: $LAUNCHPAD_ID"

# 5. Initialize Launchpad
echo "Step 5/6  Initializing Launchpad..."
# Native XLM token address on Soroban testnet (override via PLATFORM_FEE_TOKEN env var)
PLATFORM_FEE_TOKEN="${PLATFORM_FEE_TOKEN:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2BNROLN}"
stellar contract invoke \
  --id "$LAUNCHPAD_ID" \
  --source "$STELLAR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- initialize \
  --admin "$STELLAR_PUBLIC" \
  --platform_fee_receiver "$STELLAR_PUBLIC" \
  --platform_fee_bps 0 \
  --platform_fee_token "$PLATFORM_FEE_TOKEN"

stellar contract invoke \
  --id "$LAUNCHPAD_ID" \
  --source "$STELLAR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- set_wasm_hashes \
  --wasm_normal_721 "$HASH_N721" \
  --wasm_normal_1155 "$HASH_N1155" \
  --wasm_lazy_721 "$HASH_L721" \
  --wasm_lazy_1155 "$HASH_L1155"

stellar contract invoke \
  --id "$LAUNCHPAD_ID" \
  --source "$STELLAR_SECRET" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- set_staking_wasm_hash \
  --wasm_staking "$HASH_STAKING"

# 6. Update frontend .env.local
echo "Step 6/6  Updating frontend .env.local..."
FRONTEND_ENV="$REPO_ROOT/frontend/afristore-app/.env.local"

update_env() {
  local key=$1
  local val=$2
  if grep -q "^${key}=" "$FRONTEND_ENV"; then
    sed "s|^${key}=.*|${key}=${val}|" "$FRONTEND_ENV" > "$FRONTEND_ENV.tmp"
    mv "$FRONTEND_ENV.tmp" "$FRONTEND_ENV"
  else
    echo "${key}=${val}" >> "$FRONTEND_ENV"
  fi
}

mkdir -p "$(dirname "$FRONTEND_ENV")"
if [ ! -f "$FRONTEND_ENV" ]; then
  echo "NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ID=$LAUNCHPAD_ID" > "$FRONTEND_ENV"
else
  update_env "NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ID" "$LAUNCHPAD_ID"
fi
echo "  Added NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ID=$LAUNCHPAD_ID"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✓ Launchpad deployment complete!"
echo "  Launchpad ID: $LAUNCHPAD_ID"
