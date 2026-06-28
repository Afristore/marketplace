// ─────────────────────────────────────────────────────────────
// lib/config.ts — centralised runtime configuration
// ─────────────────────────────────────────────────────────────

export const config = {
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
  launchpadContractId: process.env.NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ID ?? "",
  stakingContractId: process.env.NEXT_PUBLIC_STAKING_CONTRACT_ID ?? "",
  splitterWasmHash:
    process.env.NEXT_PUBLIC_SPLITTER_WASM_HASH ?? "",
  /** Base URL for the Afristore indexer HTTP API (no trailing slash). */
  indexerUrl: (
    process.env.NEXT_PUBLIC_INDEXER_URL ??
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")
  ).replace(/\/$/, ""),
  /** Base URL for the application (no trailing slash). */
  baseUrl: (
    process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, ""),
  network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet",
  rpcUrl:
    process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
    "https://soroban-testnet.stellar.org",
  horizonUrl:
    process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
    "https://horizon-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    "Test SDF Network ; September 2015",
  pinataGateway:
    process.env.NEXT_PUBLIC_PINATA_GATEWAY ?? "",
  isDevelopment: process.env.NODE_ENV === "development",
} as const;

export function assertConfig() {
  const missing: string[] = [];
  if (!config.contractId) missing.push("NEXT_PUBLIC_CONTRACT_ID");
  if (!config.launchpadContractId)
    missing.push("NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ID");
  if (!config.pinataGateway) missing.push("NEXT_PUBLIC_PINATA_GATEWAY");
  if (missing.length > 0) {
    console.warn(
      `[Afristore] Missing environment variables: ${missing.join(", ")}`,
    );
  }
}
