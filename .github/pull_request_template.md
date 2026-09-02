## Description
Briefly describe the changes introduced by this PR. What problem does it solve?

**Closes Issue:** #

---

## 🛠️ Stack Checklists
*Please fill out the checklist(s) relevant to your changes. You can delete the sections that do not apply.*

### 🖥️ Frontend (Next.js / React)
- [ ] **Responsive Design:** Checked UI on mobile, tablet, and desktop views.
- [ ] **State Management:** Verified that local state or context updates don't cause infinite re-renders.
- [ ] **Error Handling:** Form inputs and API calls have proper validation, loading states, and user-facing error messages.
- [ ] **Accessibility:** Interactive elements have proper aria labels, roles, and keyboard navigation.

### ⚙️ Backend Indexer (Node.js / Prisma)
- [ ] **Database Migrations:** If Prisma schema changed, I generated and committed the migration file.
- [ ] **Reorg Safety:** If adding a new event listener, I ensured `revertLedgers` properly rolls back the state on ledger reorgs.
- [ ] **Performance:** Avoided N+1 query problems in API routes; used proper indexes for new Prisma models.

### ⛓️ Smart Contracts (Soroban / Rust)
- [ ] **TTL Extensions:** If I modified `Persistent` storage, I explicitly called `extend_ttl` immediately after setting.
- [ ] **Instance TTL:** I ensured `extend_instance_ttl` is called if this is a public, state-modifying entry point.
- [ ] **Authorization:** Verified that `require_auth()` is used correctly and doesn't block approved operators.
- [ ] **Gas Efficiency:** Avoided storage reads/writes or `.get(i).unwrap()` host calls inside loops.
- [ ] **State Bloat:** Avoided unbounded `Vec` arrays for global state tracking.

---

## 🧪 Testing & CI
- [ ] I have added unit or E2E tests to cover my changes and edge cases.
- [ ] All tests pass locally (`cargo test`, `npm run test`, or `npx playwright test`).
- [ ] I have run the linter and code formatter locally before pushing.

## 📸 Screenshots / Screen Recording
*If your PR introduces visual changes, please attach screenshots.*

## Additional Context
*Any other context or special instructions for reviewers.*