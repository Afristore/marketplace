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

const PINATA_BASE = "https://api.pinata.cloud";

/** Artwork metadata stored on IPFS */
export interface ArtworkMetadata {
  title: string;
  description: string;
  artist: string;
  /** Must be in the form "ipfs://CID" */
  image: string;
  year: string;
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
  name?: string
): Promise<IpfsUploadResult> {
  const formData = new FormData();
  formData.append("file", file);

  const metadata = JSON.stringify({ name: name ?? file.name });
  formData.append("pinataMetadata", metadata);

  const options = JSON.stringify({ cidVersion: 1 });
  formData.append("pinataOptions", options);

  const res = await axios.post(`${PINATA_BASE}/pinning/pinFileToIPFS`, formData, {
    maxBodyLength: Infinity,
    headers: {
      Authorization: `Bearer ${config.pinataJwt}`,
      "Content-Type": "multipart/form-data",
    },
  });

  const cid: string = res.data.IpfsHash;
  return {
    cid,
    url: `${config.pinataGateway}/ipfs/${cid}`,
  };
}

// ── Upload JSON metadata ──────────────────────────────────────

/**
 * Uploads artwork metadata JSON to IPFS via Pinata.
 * Returns the CID of the metadata file.
 */
export async function uploadMetadataToIPFS(
  metadata: ArtworkMetadata,
  name?: string
): Promise<IpfsUploadResult> {
  const body = {
    pinataContent: metadata,
    pinataMetadata: { name: name ?? `${metadata.title}-metadata.json` },
    pinataOptions: { cidVersion: 1 },
  };

  const res = await axios.post(`${PINATA_BASE}/pinning/pinJSONToIPFS`, body, {
    headers: {
      Authorization: `Bearer ${config.pinataJwt}`,
      "Content-Type": "application/json",
    },
  });

  const cid: string = res.data.IpfsHash;
  return {
    cid,
    url: `${config.pinataGateway}/ipfs/${cid}`,
  };
}

// ── Fetch metadata ────────────────────────────────────────────

/**
 * Fetches and parses artwork metadata JSON from IPFS.
 * `cid` can be a raw CID string or an "ipfs://CID" URI.
 */
export async function fetchMetadata(cid: string): Promise<ArtworkMetadata> {
  const cleanCid = cid.replace("ipfs://", "").trim();
  const url = `${config.pinataGateway}/ipfs/${cleanCid}`;
  const res = await axios.get<ArtworkMetadata>(url);
  return res.data;
}

// ── Utility ───────────────────────────────────────────────────

/** Converts a raw CID string or an IPFS URI to an IPFS gateway URL for image display. Handles full URLs gracefully. */
export function cidToGatewayUrl(cid: string): string {
  if (cid.startsWith("http")) return cid;
  const cleanCid = cid.replace("ipfs://", "").trim();
  return `${config.pinataGateway}/ipfs/${cleanCid}`;
}
