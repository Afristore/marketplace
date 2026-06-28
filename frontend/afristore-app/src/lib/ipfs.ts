// ─────────────────────────────────────────────────────────────
// lib/ipfs.ts — IPFS upload helpers via Pinata REST API
// ─────────────────────────────────────────────────────────────
//
// Artwork metadata schema (stored on IPFS):
// {
//   "title": "…",
//   "description": "…",
//   "artist": "…",
//   "image": "ipfs://CID",
//   "year": "2024"
// }
// ─────────────────────────────────────────────────────────────

import axios from "axios";
import { config } from "./config";

/** Artwork metadata stored on IPFS */
export interface ArtworkMetadata {
  title: string;
  description: string;
  artist: string;
  /** Must be in the form "ipfs://CID" */
  image: string;
  year: string;
  category: string;
}

/** Result of any IPFS upload */
export interface IpfsUploadResult {
  cid: string;
  url: string;
}

// ── Upload a File (image) ─────────────────────────────────────

/**
 * Uploads an artwork image to IPFS via Pinata.
 * Returns the raw CID string.
 */
export async function uploadImageToIPFS(
  file: File,
  name?: string,
): Promise<IpfsUploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name ?? file.name);

  try {
    const res = await axios.post("/api/ipfs/upload-image", formData, {
      maxBodyLength: Infinity,
    });

    const cid: string = res.data.cid;
    return {
      cid,
      url: `${config.pinataGateway}/ipfs/${cid}`,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Unknown error";
    throw new Error(
      `Failed to upload image to IPFS. Please try again. (${message})`
    );
  }
}

// ── Upload JSON metadata ──────────────────────────────────────

/**
 * Uploads artwork metadata JSON to IPFS via Pinata.
 * Returns the CID of the metadata file.
 */
export async function uploadMetadataToIPFS(
  metadata: ArtworkMetadata,
  name?: string,
): Promise<IpfsUploadResult> {
  try {
    const res = await axios.post("/api/ipfs/upload-metadata", {
      metadata,
      name: name ?? `${metadata.title}-metadata.json`,
    });

    const cid: string = res.data.cid;
    return {
      cid,
      url: `${config.pinataGateway}/ipfs/${cid}`,
    };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Unknown error";
    throw new Error(
      `Failed to upload metadata to IPFS. Please try again. (${message})`
    );
  }
}

// ── Bounded metadata cache (LRU eviction, max 100 entries) ────

const MAX_CACHE_SIZE = 100;

class MetadataCache {
  private cache = new Map<string, { data: ArtworkMetadata | null; ttl: number }>();

  get(cid: string): ArtworkMetadata | null | undefined {
    const entry = this.cache.get(cid);
    if (!entry) return undefined;
    if (Date.now() > entry.ttl) {
      this.cache.delete(cid);
      return undefined;
    }
    // LRU: re-insert to move to end
    this.cache.delete(cid);
    this.cache.set(cid, entry);
    return entry.data;
  }

  set(cid: string, data: ArtworkMetadata | null, ttlMs = 300_000) {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest (first inserted) entry
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cid, { data, ttl: Date.now() + ttlMs });
  }

  clear() {
    this.cache.clear();
  }
}

export const metadataCache = new MetadataCache();

/** Thin wrapper around fetchMetadata that uses the bounded cache. */
export async function getCachedMetadata(
  cid?: string,
): Promise<ArtworkMetadata | null> {
  if (!cid) return null;
  const cached = metadataCache.get(cid);
  if (cached !== undefined) return cached;
  try {
    const meta = await fetchMetadata(cid);
    metadataCache.set(cid, meta);
    return meta;
  } catch {
    metadataCache.set(cid, null);
    return null;
  }
}

// ── Fetch metadata ────────────────────────────────────────────

/**
 * Fetches and parses artwork metadata JSON from IPFS.
 * `cid` can be a raw CID string or an "ipfs://CID" URI.
 */
export async function fetchMetadata(cid?: string): Promise<ArtworkMetadata> {
  if (!cid) {
    return {
      title: "Unknown Artwork",
      description: "",
      artist: "Unknown",
      image: "/placeholder-art.svg",
      year: "",
      category: "",
    };
  }
  const cleanCid = cid.replace("ipfs://", "").trim();
  const url = `${config.pinataGateway}/ipfs/${cleanCid}`;
  const res = await axios.get<ArtworkMetadata>(url);
  return res.data;
}

// ── Utility ───────────────────────────────────────────────────

/** Converts a raw CID string or an IPFS URI to an IPFS gateway URL for image display. Handles full URLs and local paths gracefully. */
export function cidToGatewayUrl(cid: string): string {
  if (cid.startsWith("http")) return cid;
  if (cid.startsWith("/")) return cid; // Local path
  const cleanCid = cid.replace("ipfs://", "").trim();
  return `${config.pinataGateway}/ipfs/${cleanCid}`;
}
