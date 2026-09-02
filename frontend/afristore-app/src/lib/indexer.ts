// ─────────────────────────────────────────────────────────────
// lib/indexer.ts — Afristore HTTP indexer client
// ─────────────────────────────────────────────────────────────

import axios, { AxiosError, isAxiosError } from "axios";
import { config } from "./config";
import type { Listing, Auction } from "./contract";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

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

interface RoyaltyStatsResponse {
  totalEarned: string;
  payoutCount: number;
  lastPayout: number;
}

export interface IndexerCollectionRow {
  id: number;
  contractAddress: string;
  kind: string;
  creator: string;
  name: string | null;
  symbol: string | null;
  deployedAtLedger: number;
  createdAt?: string;
}

export interface CollectionFilter {
  kind?: string;
  creator?: string;
  page?: number;
  limit?: number;
}

/** Raw event row as returned by the indexer API and stored in Prisma. */
interface RawMarketplaceEvent {
  id: number;
  listingId?: string | null;
  eventType: string;
  actor: string;
  data: Record<string, unknown>;
  ledgerSequence: number;
  ledgerTimestamp?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientAxiosError(e: unknown): boolean {
  if (!isAxiosError(e)) return false;
  if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") return true;
  const s = e.response?.status;
  return s === undefined || s >= 500;
}

async function httpGet<T>(url: string): Promise<T> {
  const res = await axios.get<T>(url, {
    timeout: DEFAULT_TIMEOUT_MS,
    validateStatus: (s) => s < 400,
  });
  return res.data;
}

async function fetchWithRetry<T>(path: string): Promise<T> {
  const url = `${config.indexerUrl}${path}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await httpGet<T>(url);
    } catch (e) {
      lastErr = e;
      const retry =
        attempt < MAX_RETRIES - 1 && isTransientAxiosError(e as AxiosError);
      if (!retry) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Indexer request failed");
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isRawMarketplaceEvent(v: unknown): v is RawMarketplaceEvent {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.eventType === "string" &&
    typeof o.actor === "string" &&
    typeof o.ledgerSequence === "number" &&
    typeof o.data === "object" &&
    o.data !== null
  );
}

function parseActivityList(data: unknown): RawMarketplaceEvent[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isRawMarketplaceEvent);
}

function addrString(x: unknown): string {
  if (typeof x === "string") return x;
  return "";
}

/**
 * The indexer serialises `price` as a string (BigInts have no JSON
 * representation — see `serialize()` in indexer/src/api/routes.ts), but
 * `Listing.price` is typed as `bigint` for on-chain arithmetic. Convert at
 * the fetch boundary so callers never see the raw wire value.
 */
function normalizeListing(raw: unknown): Listing {
  const l = raw as Listing & { price: unknown };
  const price =
    typeof l.price === "bigint" ? l.price : BigInt(l.price as string | number);
  return { ...l, price };
}

function isRoyaltyStatsResponse(v: unknown): v is RoyaltyStatsResponse {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.totalEarned === "string" &&
    typeof o.payoutCount === "number" &&
    Number.isFinite(o.payoutCount) &&
    typeof o.lastPayout === "number" &&
    Number.isFinite(o.lastPayout)
  );
}

function isIndexerCollectionRow(v: unknown): v is IndexerCollectionRow {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.contractAddress === "string" &&
    typeof o.kind === "string" &&
    typeof o.creator === "string"
  );
}

function eventTypeToActivity(eventType: string): ActivityEvent["type"] {
  switch (eventType) {
    case "LISTING_CREATED":
      return "LISTED";
    case "ARTWORK_SOLD":
      return "PURCHASE";
    case "LISTING_CANCELLED":
      return "CANCELLED";
    default:
      return "SALE";
  }
}

/**
 * Fetches marketplace-related events for a wallet from the Afristore indexer.
 */
export async function getWalletActivity(
  publicKey: string,
): Promise<ActivityEvent[]> {
  if (!isNonEmptyString(publicKey)) return [];
  try {
    const raw = await fetchWithRetry<unknown>(
      `/wallets/${encodeURIComponent(publicKey)}/activity?limit=50`,
    );
    return parseActivityList(raw).map((ev) =>
      mapWalletEventToActivity(ev, publicKey),
    );
  } catch (e) {
    console.warn(
      "[indexer] getWalletActivity:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

function mapWalletEventToActivity(
  ev: RawMarketplaceEvent,
  publicKey: string,
): ActivityEvent {
  const data = ev.data;
  const listingIdRaw = ev.listingId;
  const listingIdNum = listingIdRaw != null ? Number(listingIdRaw) : 0;
  const ts = ev.ledgerTimestamp
    ? new Date(ev.ledgerTimestamp).getTime()
    : Date.now();
  const buyer = addrString(data.buyer);
  const artist = addrString(data.artist);
  const price = data.price != null ? String(data.price) : "0";

  let type = eventTypeToActivity(ev.eventType);
  let from = ev.actor;
  let to = ev.actor;

  if (ev.eventType === "LISTING_CREATED") {
    from = artist || ev.actor;
    to = config.contractId || "Contract";
  } else if (ev.eventType === "ARTWORK_SOLD") {
    if (buyer === publicKey) {
      type = "PURCHASE";
      from = artist;
      to = publicKey;
    } else {
      type = "SALE";
      from = artist;
      to = buyer;
    }
  } else if (ev.eventType === "LISTING_CANCELLED") {
    type = "CANCELLED";
    to = "—";
  }

  return {
    id: `ix_${ev.id}`,
    type,
    listing_id: Number.isFinite(listingIdNum) ? listingIdNum : 0,
    title: `Listing #${listingIdNum || "—"}`,
    price,
    timestamp: ts,
    from: from || "—",
    to: to || "—",
    tx_hash: `ledger_${ev.ledgerSequence}`,
  };
}

/**
 * Estimates total royalties for an artist from indexed sales (listing rows).
 */
export async function getRoyaltyStats(
  publicKey: string,
): Promise<RoyaltyStatsResponse> {
  const empty: RoyaltyStatsResponse = {
    totalEarned: "0",
    payoutCount: 0,
    lastPayout: 0,
  };
  if (!isNonEmptyString(publicKey)) return empty;
  try {
    const data = await fetchWithRetry<unknown>(
      `/wallets/${encodeURIComponent(publicKey)}/royalty-stats`,
    );
    if (isRoyaltyStatsResponse(data)) return data;
  } catch (e) {
    console.warn(
      "[indexer] getRoyaltyStats:",
      e instanceof Error ? e.message : e,
    );
  }
  return empty;
}

/**
 * Fetches activity (event timeline) for a specific marketplace listing.
 */
export async function getListingActivity(
  listingId: number,
): Promise<ActivityEvent[]> {
  if (!Number.isFinite(listingId)) return [];
  try {
    const raw = await fetchWithRetry<unknown>(`/listings/${listingId}/history`);
    return parseActivityList(raw).map((ev) =>
      mapListingHistoryEvent(ev, listingId),
    );
  } catch (e) {
    console.warn(
      "[indexer] getListingActivity:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

function mapListingHistoryEvent(
  ev: RawMarketplaceEvent,
  listingId: number,
): ActivityEvent {
  const data = ev.data;
  const ts = ev.ledgerTimestamp
    ? new Date(ev.ledgerTimestamp).getTime()
    : Date.now();
  const priceField = data.price ?? (data as { new_price?: unknown }).new_price;
  const price = priceField != null ? String(priceField) : "0";
  const artist = addrString(data.artist);
  const buyer = addrString(data.buyer);

  return {
    id: `lst_${ev.id}`,
    type: eventTypeToActivity(ev.eventType),
    listing_id: listingId,
    title: "Artwork",
    price,
    timestamp: ts,
    from: artist || ev.actor,
    to: buyer || config.contractId,
    tx_hash: `ledger_${ev.ledgerSequence}`,
  };
}

/**
 * Deployed collections from the indexer (Supplementary to on-chain `all_collections` when the indexer is synced).
 */
export async function getCollections(
  filter: CollectionFilter = {},
): Promise<{ collections: IndexerCollectionRow[]; total: number }> {
  const params = new URLSearchParams();
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.creator) params.set("creator", filter.creator);
  if (filter.limit != null) params.set("limit", String(filter.limit));
  if (filter.page != null) params.set("page", String(filter.page));
  const q = params.toString();
  try {
    const raw = await fetchWithRetry<unknown>(
      `/collections${q ? `?${q}` : ""}`,
    );
    if (!Array.isArray(raw)) return { collections: [], total: 0 };
    const collections = raw.filter(isIndexerCollectionRow);
    return { collections, total: collections.length };
  } catch (e) {
    console.warn(
      "[indexer] getCollections:",
      e instanceof Error ? e.message : e,
    );
    return { collections: [], total: 0 };
  }
}

/**
 * Fetch a single collection by contract address from the indexer.
 */
export async function getCollection(address: string): Promise<IndexerCollectionRow | null> {
  if (!isNonEmptyString(address)) return null;
  try {
    const raw = await fetchWithRetry<unknown>(`/collections/${encodeURIComponent(address)}`);
    if (isIndexerCollectionRow(raw)) return raw;
    return null;
  } catch (e) {
    console.warn(
      "[indexer] getCollection:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Fetch royalty stats for an artist (alias for getRoyaltyStats for server-side usage)
 */
export async function fetchRoyaltyStats(
  publicKey: string,
): Promise<RoyaltyStatsResponse> {
  return getRoyaltyStats(publicKey);
}

/**
 * Fetch artist listings from the indexer
 */
export async function fetchArtistListings(
  publicKey: string
): Promise<Listing[]> {
  if (!isNonEmptyString(publicKey)) return [];
  try {
    const data = await fetchWithRetry<unknown>(
      `/listings?artist=${encodeURIComponent(publicKey)}`,
    );
    if (Array.isArray(data)) return data.map(normalizeListing);
    if (
      data &&
      typeof data === "object" &&
      Array.isArray((data as { listings?: unknown }).listings)
    ) {
      return (data as { listings: unknown[] }).listings.map(normalizeListing);
    }
    return [];
  } catch (e) {
    console.warn(
      "[indexer] fetchArtistListings:",
      e instanceof Error ? e.message : e,
    );
    return [];
  }
}

export interface WalletPreferences {
  walletAddress?: string;
  theme?: string;
  currency?: string;
  priceAlerts?: boolean;
  offerUpdates?: boolean;
  auctionEndings?: boolean;
}

/**
 * Load per-wallet preferences from the indexer.
 */
export async function getWalletPreferences(
  publicKey: string,
): Promise<WalletPreferences> {
  if (!isNonEmptyString(publicKey)) return {};
  try {
    const data = await fetchWithRetry<unknown>(
      `/wallets/${encodeURIComponent(publicKey)}/preferences`,
    );
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as WalletPreferences;
    }
    return {};
  } catch (e) {
    console.warn(
      "[indexer] getWalletPreferences:",
      e instanceof Error ? e.message : e,
    );
    return {};
  }
}

/**
 * Persist per-wallet preferences to the indexer.
 */
export async function putWalletPreferences(
  publicKey: string,
  prefs: Pick<WalletPreferences, "theme" | "currency" | "priceAlerts" | "offerUpdates" | "auctionEndings">,
): Promise<WalletPreferences> {
  if (!isNonEmptyString(publicKey)) return {};
  const url = `${config.indexerUrl}/wallets/${encodeURIComponent(publicKey)}/preferences`;
  try {
    const res = await axios.put<WalletPreferences>(url, prefs, {
      timeout: DEFAULT_TIMEOUT_MS,
      validateStatus: (s) => s < 400,
    });
    return res.data;
  } catch (e) {
    console.warn(
      "[indexer] putWalletPreferences:",
      e instanceof Error ? e.message : e,
    );
    throw e;
  }
}

export interface MarketplaceStats {
  totalListings: number;
  activeListings: number;
  totalSales: number;
}

/**
 * Fetch marketplace-wide aggregates from the indexer.
 */
export async function fetchMarketplaceStats(): Promise<MarketplaceStats | null> {
  try {
    const raw = await fetchWithRetry<unknown>("/stats");
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      typeof (raw as { totalListings?: unknown }).totalListings === "number"
    ) {
      const o = raw as Record<string, unknown>;
      return {
        totalListings: Number(o.totalListings ?? 0),
        activeListings: Number(o.activeListings ?? 0),
        totalSales: Number(o.totalSales ?? 0),
      };
    }
    return null;
  } catch (e) {
    console.warn(
      "[indexer] fetchMarketplaceStats:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// SSE (Server-Sent Events) for real-time wallet notifications
// ─────────────────────────────────────────────────────────────

export interface WalletEvent {
  id: string;
  type: "PRICE_ALERT" | "OFFER_RECEIVED" | "OFFER_ACCEPTED" | "OFFER_REJECTED" | "AUCTION_ENDING" | "AUCTION_WON" | "AUCTION_OUTBID" | "SALE" | "PURCHASE" | "ROYALTY";
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  link?: string;
  data?: Record<string, unknown>;
}

export type SSEEventType = WalletEvent["type"];

/**
 * Creates an EventSource connection to the wallet-specific SSE stream.
 * @param walletAddress - The connected wallet's public key
 * @param onEvent - Callback fired when a new event is received
 * @param onError - Callback fired when the connection encounters an error
 * @returns Object with close function to terminate the connection
 */
export function createWalletSSEConnection(
  walletAddress: string,
  onEvent: (event: WalletEvent) => void,
  onError?: (error: Event) => void,
): { close: () => void } {
  if (!isNonEmptyString(walletAddress)) {
    return { close: () => {} };
  }

  const url = `${config.indexerUrl}/wallets/${encodeURIComponent(walletAddress)}/events`;

  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelayMs = 3000;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    try {
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        reconnectAttempts = 0;
        console.info("[SSE] Connected to wallet event stream:", walletAddress.slice(0, 8) + "...");
      };

      eventSource.onmessage = (messageEvent) => {
        try {
          const rawData = JSON.parse(messageEvent.data);
          const event: WalletEvent = {
            id: rawData.id || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            type: rawData.type || "SALE",
            title: rawData.title || "Notification",
            message: rawData.message || "",
            timestamp: rawData.timestamp || Date.now(),
            read: false,
            link: rawData.link,
            data: rawData.data,
          };
          onEvent(event);
        } catch (parseError) {
          console.warn("[SSE] Failed to parse event:", parseError);
        }
      };

      eventSource.onerror = (error) => {
        console.warn("[SSE] Connection error:", error);
        onError?.(error);

        // Attempt reconnection with exponential backoff
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = reconnectDelayMs * Math.pow(2, reconnectAttempts);
          console.info(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
          reconnectTimeout = setTimeout(() => {
            reconnectAttempts++;
            connect();
          }, delay);
        } else {
          console.error("[SSE] Max reconnection attempts reached");
        }
      };
    } catch (err) {
      console.error("[SSE] Failed to create EventSource:", err);
      onError?.(new Event("error"));
    }
  };

  connect();

  return {
    close: () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
        console.info("[SSE] Disconnected from wallet event stream");
      }
    },
  };
}

/**
 * Fetch listings from the indexer with optional filters and pagination.
 * Throws if the indexer is unreachable so callers can fall back to on-chain.
 */
export async function fetchListings(options: {
  status?: string;
  category?: string;
  sort?: string;
  limit?: number;
  offset?: number;
  minPrice?: string;
  maxPrice?: string;
  search?: string;
} = {}): Promise<{ listings: Listing[]; total?: number }> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.category) params.set("category", options.category);
  if (options.sort) params.set("sort", options.sort);
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  if (options.minPrice) params.set("minPrice", options.minPrice);
  if (options.maxPrice) params.set("maxPrice", options.maxPrice);
  if (options.search) params.set("search", options.search);
  const q = params.toString();
  try {
    const raw = await fetchWithRetry<unknown>(`/listings${q ? `?${q}` : ''}`);
    if (raw == null) return { listings: [] };
    // If paginated, indexer returns { listings, total }
    if (typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).listings) {
      const r = raw as { listings: unknown; total?: number };
      return {
        listings: Array.isArray(r.listings) ? r.listings.map(normalizeListing) : [],
        total: r.total,
      };
    }
    if (Array.isArray(raw)) return { listings: raw.map(normalizeListing) };
    return { listings: [] };
  } catch (e) {
    console.warn('[indexer] fetchListings:', e instanceof Error ? e.message : e);
    return { listings: [] };
  }
}

/**
 * Fetch auctions from the indexer with optional filters.
 * Throws if the indexer is unreachable so callers can fall back to on-chain.
 */
export async function fetchAuctions(options: {
  creator?: string;
  status?: string;
} = {}): Promise<Auction[]> {
  const params = new URLSearchParams();
  if (options.creator) params.set("creator", options.creator);
  if (options.status) params.set("status", options.status);
  const q = params.toString();
  const raw = await fetchWithRetry<unknown>(`/auctions${q ? `?${q}` : ''}`);
  if (Array.isArray(raw)) return raw as Auction[];
  return [];
}

/**
 * Fetch a single listing (with optional metadata) from the indexer.
 */
export async function fetchListingById(id: number): Promise<Listing | null> {
  if (!Number.isFinite(id)) return null;
  try {
    const raw = await fetchWithRetry<unknown>(`/listings/${id}`);
    return raw ? normalizeListing(raw) : null;
  } catch (e) {
    console.warn(
      "[indexer] fetchListingById:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export interface OwnedToken {
  collectionAddress: string;
  tokenId: number;
  name?: string;
  image?: string;
}

/**
 * Fetch tokens owned by a specific wallet.
 */
export async function getOwnedTokens(publicKey: string): Promise<OwnedToken[]> {
  if (!isNonEmptyString(publicKey)) return [];
  try {
    const raw = await fetchWithRetry<unknown>(
      `/wallets/${encodeURIComponent(publicKey)}/tokens`,
    );
    if (Array.isArray(raw)) return raw as OwnedToken[];
    return [];
  } catch (e) {
    console.warn(
      "[indexer] getOwnedTokens:",
      e instanceof Error ? e.message : e,
    );

    // Remove mock data and throw the error to be handled by the caller
    throw e;
  }
}
