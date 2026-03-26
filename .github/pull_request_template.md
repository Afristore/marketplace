## Description
**Resolves Issue:** ### Soroban Safety Checklist
- [ ] **TTL Extensions:** If I modified `Persistent` storage, I explicitly called `extend_ttl` for those exact keys immediately after setting them.
- [ ] **Instance TTL:** I ensured `extend_instance_ttl` is called if this is a public, state-modifying entry point.
- [ ] **Authorization:** I verified that `require_auth` is used correctly and doesn't accidentally block approved operators or token owners.
- [ ] **Gas Efficiency:** I have avoided putting storage reads/writes or `.get(i).unwrap()` host calls inside loops.
- [ ] **State Bloat:** I have not used unbounded `Vec` arrays for global state tracking.
- [ ] **Signature Security:** If I implemented off-chain signatures, the digest explicitly includes the contract address to prevent replays.
- [ ] **Front-Running Protection:** If I used `deploy_v2`, I hashed the caller's address into the deployment salt.
- [ ] **Error Handling:** I avoided using `.unwrap_or()` combined with `.saturating_sub()` to silently hide balance underflows.

## Testing
- [ ] I have added unit tests to cover my changes and tested edge cases.
- [ ] All tests pass locally (`cargo test`).

## Additional Context