// ─────────────────────────────────────────────────────────────
// lib/fileValidation.ts — Client-side artwork file constraints
// ─────────────────────────────────────────────────────────────
// Kept free of network code so the rules can be unit-tested and
// shared between the listing and auction forms before any IPFS
// upload is attempted.
// ─────────────────────────────────────────────────────────────

/** Maximum artwork file size accepted for IPFS upload (10 MB). */
export const MAX_ARTWORK_FILE_BYTES = 10 * 1024 * 1024;

/** Image formats the marketplace accepts for artwork uploads. */
export const ARTWORK_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

/** Value for the file input `accept` attribute, matching ARTWORK_MIME_TYPES. */
export const ARTWORK_ACCEPT_ATTRIBUTE = ARTWORK_MIME_TYPES.join(",");

/**
 * Validates an artwork file's MIME type and size before it is uploaded to
 * IPFS. Returns a human-readable error message, or null when the file is
 * acceptable.
 */
export function validateArtworkFile(file: File): string | null {
  if (!(ARTWORK_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Unsupported format. Upload a PNG, JPEG, WebP, or SVG image.";
  }
  if (file.size > MAX_ARTWORK_FILE_BYTES) {
    return "Image is too large. Maximum file size is 10 MB.";
  }
  return null;
}
