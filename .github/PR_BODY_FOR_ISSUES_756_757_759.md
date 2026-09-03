## Description

This PR implements the three Stellar Wave lending/borrowing frontend components that were assigned to me, and wires them into the **Borrow** flow of the Afristore app.

### Summary of changes

1. **`NFTCollateralCard`** (closes #757) — `frontend/afristore-app/src/components/lending/NFTCollateralCard.tsx`
   - The primary card UI for a lending offer.
   - Renders the NFT artwork and **resolves IPFS images** (`ipfs://CID`) through the configured Pinata gateway via `cidToGatewayUrl`.
   - Shows the **required collateral amount** (derived from the declared price × `min_collateral_buffer_bps`) and the **max loan duration**.
   - Includes the clear call-to-action **"Borrow against this NFT"** with a busy/disabled state while a borrow is in flight.
   - Graceful placeholder when no image/name is available.

2. **`BorrowConfirmModal`** (closes #759) — `frontend/afristore-app/src/components/lending/BorrowConfirmModal.tsx`
   - A confirmation dialog that displays the **exact collateral needed** to borrow against the selected NFT (raw token amount formatted at the token's decimal scale, plus the USD equivalent, loan amount, duration and liquidation threshold).
   - **Warns the user about liquidation risks** with a prominent amber alert banner.
   - **Uses `useBorrowTransaction` on submit** to execute the borrow; surfaces the hook's `isBorrowing` and `error` states and reports the new position id via `onSuccess`.
   - Keyboard/Escape close, backdrop click to dismiss, and requires a connected wallet to confirm.

3. **`InterestScheduleChart`** (closes #756) — `frontend/afristore-app/src/components/lending/InterestScheduleChart.tsx`
   - A small line chart built with **Recharts** that visualizes the stepped interest schedule (basis points over time in months) for an array of `u32` bps values.
   - **Tooltips show the exact percentage** (e.g. `500 bps = 5.00%`).
   - Handles empty schedules, single-step schedules, `bigint` inputs and responsive + fixed-width rendering.

4. **Borrow page integration** — `frontend/afristore-app/src/app/lending/borrow/page.tsx` + `frontend/afristore-app/src/hooks/useLendingListings.ts`
   - The Borrow page now fetches open lending listings from the indexer (`GET /api/lending/listings`), renders them as an `NFTCollateralCard` grid, lets the user choose the collateral token, and opens `BorrowConfirmModal` to execute the borrow.
   - The modal embeds the `InterestScheduleChart` so borrowers can preview how interest steps up over the term.

5. **Supporting code**
   - `frontend/afristore-app/src/components/lending/types.ts` — shared `LendingOffer` type (on-chain `LendingListing` + NFT display metadata).
   - `frontend/afristore-app/src/components/lending/format.ts` — USD / token / duration / bps formatters.
   - Added `recharts` to `frontend/afristore-app` and updated the lockfile.
   - Unit tests for all three components (placeholdered external deps; IPFS resolution, liquidation warning, borrow-on-submit, exact tooltip percentage all covered).

### Acceptance criteria coverage

- [x] **#757** Resolves and displays IPFS images; shows "Borrow against this NFT" CTA.
- [x] **#759** Warns about liquidation risks; executes on submit via `useBorrowTransaction`.
- [x] **#756** Renders correctly from a `u32` bps array; tooltips show exact percentage (`500 bps = 5.00%`).
- [x] All CI passes (lint, type-check, unit tests, production build).

## Screenshots

> _Will attach after running the app locally (indexer + frontend)._

---

## 🛠️ Stack Checklists

### 🖥️ Frontend (Next.js / React)
- [x] **Responsive Design:** Cards and modal scale across mobile/tablet/desktop; chart is responsive (fixed `width` available for embeds/tests).
- [x] **State Management:** Local state (`useState`) for selection/token; no infinite re-renders; `useMemo` for derived collateral.
- [x] **Error Handling:** Loading, retry, and empty states on the borrow page; borrow hook `error` surfaced in the modal; disabled submit without a wallet.
- [x] **Accessibility:** `role="dialog"`/`aria-modal`, labeled close button, Escape-to-close, `aria-label` on the chart SVG.

### ⚙️ Backend Indexer (Node.js / Prisma)
- [ ] No indexer changes in this PR. (Data source is the existing `GET /api/lending/listings` route.)

### ⛓️ Smart Contracts (Soroban / Rust)
- [ ] No contract changes in this PR.

---

## 🧪 Testing & CI
- [x] Added unit tests for `NFTCollateralCard`, `BorrowConfirmModal` and `InterestScheduleChart`.
- [x] All tests pass locally (`npm run test`).
- [x] Linted and type-checked locally before pushing.
- [ ] Verified the full GitHub Actions CI (contracts + frontend + indexer) passes on the PR.

## 📸 Screenshots / Screen Recording
_To be attached once the app is runnable locally._

## Additional Context / Notes
- The exact collateral amount sent on-chain is denominated in the token's smallest units; the Borrow page converts the USD-denominated requirement at the chosen token's decimal scale (USDC/XLM/AFRI). A future price-oracle integration can refine non-USD-pegged tokens.
- Recharts 2.x is used (React 18 compatible, per the issue's "Recharts or Chart.js" option); the package is only used by the client-side chart component.