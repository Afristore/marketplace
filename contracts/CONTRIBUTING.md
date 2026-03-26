# Contributing to Our Soroban NFT Contracts

First off, thank you for considering contributing to this project! Building robust, gas-efficient smart contracts on Soroban is a team effort. 

## 🛠 How to Contribute
1. **Find an Issue:** Check our GitHub Issues. If you want to work on something that isn't listed, please open an issue first to discuss it.
2. **Fork & Branch:** Fork the repository and create a branch for your feature or bug fix (e.g., `fix/erc1155-batch-transfer` or `feat/burn-logic`).
3. **Draft a PR:** Open a Pull Request early with `[WIP]` in the title if you want feedback on your approach.

## ⚠️ Soroban-Specific Developer Guidelines

If you are coming from Solidity/EVM, Soroban handles state and execution differently. Please adhere to these critical security rules:

### 1. Storage and TTL (Time-To-Live)
Soroban storage expires. If data archives, the contract can brick or users can lose assets.
* **Instance Storage:** Must be extended on *every* public, state-modifying call. Use our `extend_instance_ttl(&env)` helper.
* **Persistent Storage:** Whenever you `set()` a persistent value (like balances, owners, or total supply), you **MUST** call `extend_ttl()` immediately after for that exact key. 

### 2. Authorization & Operators
When implementing standard features (ERC-721/1155), remember that operators must be able to act on behalf of owners.
* Do not just use `from.require_auth()` if the caller might be an approved operator.
* Always check `_is_approved_for_all` or single-token approvals when routing standard marketplace functions like `burn` or `batch_transfer`.

### 3. Gas Optimization & Loops
Crossing the WASM-to-Host boundary in Soroban is expensive.
* **Avoid Storage in Loops:** Do not put `env.storage().instance().get/set` inside a loop. Read once before the loop, increment in memory, and write once after.
* **Efficient Arrays:** When iterating over multiple arrays (like in batch mints), avoid `vec.get(i).unwrap()` in a loop. Use native Rust iterators (e.g., `.iter().zip()`) where possible to reduce host calls.

### 4. State Bloat (No Unbounded Arrays)
* **Never use `Vec` to store global registries** (like a list of all deployed collections or all users) in persistent state. This will bloat the state and permanently brick the contract when it hits Soroban's storage limits. 
* Use indexed mappings (`DataKey::CollectionByIndex(u64)`) or rely entirely on emitted events for off-chain indexing.

### 5. Cryptographic Digest Security
* Whenever generating a hash for an off-chain signature (like a lazy mint voucher), you **must** append the `current_contract_address` to the raw payload before hashing. This prevents cross-contract and cross-chain replay attacks.

### 6. Secure Factory Deployments
* When using `env.deployer().with_current_contract(salt)`, never pass a user-provided salt directly. Always hash the creator's address with the salt (`sha256(creator ‖ salt)`) to create an isolated namespace and prevent front-running in the mempool.

### 7. Error Handling & State Accounting
* **Fail Loud:** Do not use defensive programming that hides bugs, such as using `.unwrap_or(1)` combined with `.saturating_sub(1)` for token balances. 
* Explicitly check for underflows and return distinct errors (e.g., `Error::InsufficientBalance`) so the transaction reverts safely and cleanly.

## 🧪 Testing
* Every bug fix must include a test that would have caught the bug.
* Every new feature must be fully covered by unit tests.
* Run tests locally using `cargo test` before submitting your PR.