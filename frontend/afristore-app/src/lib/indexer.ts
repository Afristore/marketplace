// ─────────────────────────────────────────────────────────────
// lib/indexer.ts — Adapter for Soroban Indexer (Mercury / Zephyr)
// ─────────────────────────────────────────────────────────────

import axios from "axios";
import { config } from "./config";

// Default Mercury-like Indexer endpoint for Testnet
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "https://api.mercury-index.io/v1";

export interface ActivityEvent {
    id: string;
    type: "PURCHASE" | "LISTED" | "CANCELLED" | "SALE" | "ROYALTY";
    listing_id: number;
    title: string;
    price: string;
    timestamp: number;
    from: string;
    to: string;
    tx_hash: string;
}

/**
 * Fetches all marketplace-related events for a specific wallet 
 * from the indexer API.
 */
export async function getWalletActivity(publicKey: string): Promise<ActivityEvent[]> {
    // In a real implementation, we would query Mercury or another Indexer
    // Example query for Mercury:
    /*
    const response = await axios.post(`${INDEXER_URL}/query`, {
      action: "get_contract_events",
      contract_id: config.contractId,
      filter: {
          or: [
              { "data.buyer": publicKey },
              { "data.artist": publicKey }
          ]
      }
    });
    */

    // For the purpose of this task, since no live API is provided, 
    // we simulate the reconstruction of history.
    // In a real production app, we'd iterate through event logs.

    return new Promise((resolve) => {
        setTimeout(() => {
            resolve([
                {
                    id: "evt_1",
                    type: "PURCHASE",
                    listing_id: 102,
                    title: "Sunlit Savanna #4",
                    price: "250.00",
                    timestamp: Date.now() - 3600000 * 2,
                    from: "GA...ARTIST",
                    to: publicKey,
                    tx_hash: "abcd...1234"
                },
                {
                    id: "evt_2",
                    type: "SALE",
                    listing_id: 85,
                    title: "Masai Guardian #1",
                    price: "450.00",
                    timestamp: Date.now() - 86400000,
                    from: publicKey,
                    to: "GB...BUYER",
                    tx_hash: "efgh...5678"
                },
                {
                    id: "evt_3",
                    type: "LISTED",
                    listing_id: 110,
                    title: "Kigali Horizon",
                    price: "120.00",
                    timestamp: Date.now() - 86400000 * 3,
                    from: publicKey,
                    to: config.contractId,
                    tx_hash: "ijkl...9012"
                }
            ]);
        }, 1000);
    });
}

/**
 * Calculates total royalties earned by an artist address
 */
export async function getRoyaltyStats(publicKey: string) {
    // This would sum up all "RoyaltyPaid" events for this user
    return {
        totalEarned: "75.50",
        payoutCount: 12,
        lastPayout: Date.now() - 86400000 * 5
    };
}

/**
 * Fetches activity for a specific listing
 */
export async function getListingActivity(listingId: number): Promise<ActivityEvent[]> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve([
                {
                    id: `evt_l_${listingId}_1`,
                    type: "LISTED",
                    listing_id: listingId,
                    title: "Artwork",
                    price: "100.00",
                    timestamp: Date.now() - 86400000 * 10,
                    from: "GA...ARTIST",
                    to: config.contractId,
                    tx_hash: "abc...1"
                },
                {
                    id: `evt_l_${listingId}_2`,
                    type: "PURCHASE",
                    listing_id: listingId,
                    title: "Artwork",
                    price: "100.00",
                    timestamp: Date.now() - 86400000 * 2,
                    from: "GA...ARTIST",
                    to: "GB...BUYER",
                    tx_hash: "def...2"
                }
            ]);
        }, 1000);
    });
}
