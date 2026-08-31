import axios from 'axios';

/**
 * IPFS gateway used to resolve metadata JSON during indexing.
 * Override with IPFS_GATEWAY (defaults to the Pinata public gateway).
 */
const IPFS_GATEWAY = (
    process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud'
).replace(/\/$/, '');

const IPFS_TIMEOUT_MS = 5_000;

/**
 * Best-effort resolution of the art category from an artwork's IPFS metadata.
 * Returns `null` when the CID is missing, the metadata cannot be fetched, or
 * the metadata has no usable `category` field — callers must treat this as
 * "category unknown" and never fail the surrounding index/update path.
 */
export async function resolveMetadataCategory(cid?: string | null): Promise<string | null> {
    if (!cid) return null;
    const cleanCid = String(cid).replace(/^ipfs:\/\//, '').replace(/\/$/, '');
    if (!cleanCid) return null;

    try {
        const res = await axios.get<{ category?: unknown }>(
            `${IPFS_GATEWAY}/ipfs/${cleanCid}`,
            { timeout: IPFS_TIMEOUT_MS },
        );
        const category = res.data?.category;
        if (typeof category === 'string' && category.trim()) {
            return category.trim();
        }
    } catch (err) {
        console.warn(
            `[ipfs] Failed to resolve category for CID ${cleanCid}:`,
            err instanceof Error ? err.message : err,
        );
    }
    return null;
}
