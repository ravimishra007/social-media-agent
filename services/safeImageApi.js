import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const RAW_URL = process.env.FETCH_BRANDS_API || "";

/**
 * Build the image-fetch URL for a given brand slug.
 *
 * Supported patterns for FETCH_BRANDS_API:
 *   1. Explicit placeholder: "https://.../models/{slug}/images?..."
 *   2. Concrete example URL: "https://.../models/vera-popov/images?..." — the
 *      slug segment right after "/models/" is swapped for the requested slug.
 */
function buildUrl(slug) {
  if (!RAW_URL) {
    throw new Error("FETCH_BRANDS_API is not set in .env");
  }
  if (RAW_URL.includes("{slug}")) {
    return RAW_URL.replace(/\{slug\}/g, slug);
  }
  return RAW_URL.replace(/(\/models\/)[^/]+(\/)/, `$1${slug}$2`);
}

function normalise(item) {
  if (!item || !item.url) return null;
  return {
    id: item.id || item.filename || item.url,
    url: item.url,
    filename: item.filename || null,
    description: item.description || null,
    category: item.category || null
  };
}

/**
 * Fetch the SFW image pool for a brand.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.excludeIds] - image ids to skip
 * @param {Set<string>|string[]} [opts.excludeUrls] - image urls to skip
 * @returns {Promise<Array<{ id: string, url: string, filename: string|null, description: string|null, category: string|null }>>}
 */
export async function fetchSafeImages(slug, opts = {}) {
  const excludeIds = new Set(opts.excludeIds || []);
  const excludeUrls = new Set(opts.excludeUrls || []);
  const url = buildUrl(slug);

  const response = await axios.get(url, { timeout: 30_000 });
  const payload = response.data;
  const rows = Array.isArray(payload)
    ? payload
    : payload?.data || payload?.images || payload?.items || [];

  return rows
    .map(normalise)
    .filter((it) => it && !excludeIds.has(it.id) && !excludeUrls.has(it.url));
}

/**
 * Pick the next candidate image from the pool, skipping already-rejected ones.
 *
 * @param {string} slug
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.excludeIds]
 * @param {Set<string>|string[]} [opts.excludeUrls]
 * @returns {Promise<{ id: string, url: string, filename: string|null, description: string|null, category: string|null }|null>}
 */
export async function pickNextSafeImage(slug, opts = {}) {
  const pool = await fetchSafeImages(slug, opts);
  return pool[0] || null;
}
