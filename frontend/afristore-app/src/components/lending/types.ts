// ─────────────────────────────────────────────────────────────
// components/lending/types.ts — Shared lending UI types
// ─────────────────────────────────────────────────────────────
// `LendingOffer` extends the on-chain `LendingListing` with the
// optional off-chain NFT display metadata that the lending UI
// renders (name + image). Images may be raw IPFS URIs
// ("ipfs://CID") or HTTPS URLs and are resolved by the components
// through the configured IPFS gateway.
//──────────────────────────────────────────────────────────────

import type { LendingListing } from "@/lib/lending";

export interface LendingOffer extends LendingListing {
  /** Human-readable NFT display name (falls back to the token id). */
  nftName?: string;
  /** NFT image URI — raw IPFS ("ipfs://CID") or HTTPS URL. */
  nftImage?: string;
}