# Soroban NFT Launchpad

A production-ready NFT launchpad on Stellar Soroban that mirrors the Ethereum
factory pattern. One factory contract deploys four collection types on demand.

---

## Architecture

```
Launchpad (factory — deployed once)
├── deploy_normal_721()   → NormalNFT721  contract (own address, shared WASM)
├── deploy_normal_1155()  → NormalNFT1155 contract
├── deploy_lazy_721()     → LazyMint721   contract
└── deploy_lazy_1155()    → LazyMint1155  contract
```

### Why this IS the Solidity clone pattern

In Ethereum you use EIP-1167 clones to avoid re-deploying bytecode.
In Soroban the WASM is stored once by its content hash.  Every `deploy()` call
shares that same WASM blob — zero bytecode duplication. Each deployed instance
gets completely isolated persistent storage.  This is structurally identical to
clones, but cleaner.

---

## Collection Types

| Type | Soroban Contract | Ethereum analogy | Who mints |
|---|---|---|---|
| `Normal721` | `normal_721` | ERC-721 | Creator calls `mint` upfront |
| `Normal1155` | `normal_1155` | ERC-1155 | Creator calls `mint_new` / `mint_batch` |
| `LazyMint721` | `lazy_721` | ERC-721 + lazy | Buyer redeems signed voucher |
| `LazyMint1155` | `lazy_1155` | ERC-1155 + lazy | Buyer redeems signed voucher (edition) |

---

## Build

```bash
# Install Soroban CLI
cargo install --locked stellar-cli --features opt

# Build all contracts
cd soroban-nft-launchpad
stellar contract build
# Outputs to: target/wasm32-unknown-unknown/release/*.wasm
```

---

## Deploy (Testnet)

### Step 1 — Upload the four collection WASMs (done once)

```bash
NETWORK="--network testnet --source my-account"

HASH_N721=$(stellar contract upload --wasm \
  target/wasm32-unknown-unknown/release/normal_721.wasm $NETWORK)

HASH_N1155=$(stellar contract upload --wasm \
  target/wasm32-unknown-unknown/release/normal_1155.wasm $NETWORK)

HASH_L721=$(stellar contract upload --wasm \
  target/wasm32-unknown-unknown/release/lazy_721.wasm $NETWORK)

HASH_L1155=$(stellar contract upload --wasm \
  target/wasm32-unknown-unknown/release/lazy_1155.wasm $NETWORK)

echo "Normal721  hash: $HASH_N721"
echo "Normal1155 hash: $HASH_N1155"
echo "Lazy721    hash: $HASH_L721"
echo "Lazy1155   hash: $HASH_L1155"
```

### Step 2 — Deploy and initialise the Launchpad factory

```bash
LAUNCHPAD=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/launchpad.wasm $NETWORK)

stellar contract invoke --id $LAUNCHPAD $NETWORK \
  --fn initialize -- \
  --admin GADMIN_ADDRESS \
  --platform_fee_receiver GADMIN_ADDRESS \
  --platform_fee_bps 0
```

### Step 3 — Register the four WASM hashes

```bash
stellar contract invoke --id $LAUNCHPAD $NETWORK \
  --fn set_wasm_hashes -- \
  --wasm_normal_721  $HASH_N721  \
  --wasm_normal_1155 $HASH_N1155 \
  --wasm_lazy_721    $HASH_L721  \
  --wasm_lazy_1155   $HASH_L1155
```

---

## Creating a collection (user flow)

### Normal 721

```bash
stellar contract invoke --id $LAUNCHPAD $NETWORK \
  --fn deploy_normal_721 -- \
  --creator GCREATOR \
  --name "My Collection" \
  --symbol "MYC" \
  --max_supply 10000 \
  --royalty_bps 500 \
  --royalty_receiver GCREATOR \
  --salt $(openssl rand -hex 32)
# Returns: collection contract address
```

### Lazy Mint 721

```bash
# creator_pubkey = raw 32-byte ed25519 public key (hex)
# Derive from stellar keypair: stellar keys show my-account --as-secret → decode
stellar contract invoke --id $LAUNCHPAD $NETWORK \
  --fn deploy_lazy_721 -- \
  --creator GCREATOR \
  --creator_pubkey <32-byte-hex> \
  --name "Lazy Drops" \
  --symbol "LZY" \
  --max_supply 5000 \
  --royalty_bps 750 \
  --royalty_receiver GCREATOR \
  --salt $(openssl rand -hex 32)
```

---

## Lazy Mint — Off-chain voucher signing (JavaScript/TypeScript)

```typescript
import { Keypair, hash } from "@stellar/stellar-sdk";
import * as crypto from "crypto";

// ── Build the voucher digest (must match _voucher_digest in lazy_721/src/lib.rs)

function buildDigest721(
  tokenId: bigint,
  price: bigint,         // i128 as BigInt
  validUntil: bigint,
  uriHash: Buffer,       // sha256(uri)
  currencyXdr: Buffer    // XDR serialisation of the SAC Address
): Buffer {
  const buf = Buffer.alloc(8 + 16 + 8 + 32 + currencyXdr.length);
  let offset = 0;

  buf.writeBigUInt64BE(tokenId, offset);   offset += 8;

  // i128 big-endian  (sign extend to 16 bytes)
  const priceAbs = price < 0n ? -price : price;
  const lo = priceAbs & 0xffff_ffff_ffff_ffffn;
  const hi = priceAbs >> 64n;
  buf.writeBigUInt64BE(hi, offset);        offset += 8;
  buf.writeBigUInt64BE(lo, offset);        offset += 8;

  buf.writeBigUInt64BE(validUntil, offset); offset += 8;
  uriHash.copy(buf, offset);               offset += 32;
  currencyXdr.copy(buf, offset);

  return crypto.createHash("sha256").update(buf).digest();
}

// ── Sign the digest with the creator's Stellar keypair

function signVoucher(keypair: Keypair, digest: Buffer): Buffer {
  return Buffer.from(keypair.sign(digest));
}

// ── Usage example

const creatorKeypair = Keypair.fromSecret("S...");
const uri   = "ipfs://bafybeig...";
const uriHash = crypto.createHash("sha256").update(uri).digest();

// currencyXdr: XDR-encode the SAC address for the payment token
// e.g. for native XLM use the SAC: stellar contract id asset --asset native --network testnet
const currencyXdr = Buffer.from("...");  // Address.toXdr() bytes

const digest = buildDigest721(
  1n,              // token_id
  10_000_000n,     // price in stroops (1 XLM = 10_000_000)
  99_999_999n,     // valid_until ledger sequence
  uriHash,
  currencyXdr
);

const signature = signVoucher(creatorKeypair, digest);
// signature is BytesN<64> — pass to the contract's redeem() function

console.log("signature (hex):", signature.toString("hex"));
```

> For **LazyMint1155**, include `max_amount` and `price_per_unit` in the
> digest (see `_voucher_digest` in `lazy_1155/src/lib.rs`).

---

## Storage layout cheat sheet

| Layer | TTL strategy | Used for |
|---|---|---|
| `instance` | Extended on every call | Config (creator, name, counters) |
| `persistent` | Extended on access (`extend_ttl`) | Per-token data, balances, approvals |
| `temporary` | Not used — voucher state is persistent | — |

---

## Royalty interface (marketplace integration)

Every collection exposes:

```bash
stellar contract invoke --id $COLLECTION_ADDR --fn royalty_info
# Returns: (receiver_address, bps)
# e.g. ("GCREATOR...", 500) means 5% royalty to GCREATOR
```

Litemint and other Stellar marketplaces can read this before listing.

---

## Supported Soroban SDK version

```toml
soroban-sdk = "21.7.6"
```