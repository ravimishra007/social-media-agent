import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BRANDS_URL = process.env.FETCH_BRANDS || "";
const VIDEOS_URL = process.env.FETCH_BRAND_VIDEOS || "";

export const VIDEO_PAGE_SIZE = 10;

function brandsUrl(page, limit) {
  if (!BRANDS_URL) {
    throw new Error("FETCH_BRANDS is not set in .env");
  }
  const url = new URL(BRANDS_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

/**
 * Build the videos-fetch URL for a brand slug.
 *
 * Supported patterns for FETCH_BRAND_VIDEOS:
 *   1. Explicit placeholder: "https://.../content/by-model?model={slug}&..."
 *   2. Concrete example URL: the "model" query param is overwritten.
 */
function videosUrl(slug, page, limit) {
  if (!VIDEOS_URL) {
    throw new Error("FETCH_BRAND_VIDEOS is not set in .env");
  }
  const raw = VIDEOS_URL.includes("{slug}")
    ? VIDEOS_URL.replace(/\{slug\}/g, slug)
    : null;
  const url = new URL(raw ?? VIDEOS_URL);
  if (!raw) url.searchParams.set("model", slug);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function hasMore(pagination, page, rowCount, limit) {
  if (typeof pagination?.has_more === "boolean") return pagination.has_more;
  if (pagination?.totalPages) return page < pagination.totalPages;
  return rowCount === limit;
}

// The gallery API's own pagination is unstable: each request returns a random
// ordering, so limit=10 pages contain duplicates and some brands never surface.
// Instead we fetch the FULL list in 50-per-page batches (50 is the API's max),
// dedupe, sort for a stable order, and paginate ourselves.
async function fetchAllGalleryModels() {
  const LIMIT = 50;
  const bySlug = new Map();
  let page = 1;
  for (;;) {
    const response = await axios.get(brandsUrl(page, LIMIT), { timeout: 30_000 });
    const models = response.data?.models || [];
    for (const m of models) {
      if (m && m.slug && !bySlug.has(m.slug)) bySlug.set(m.slug, m);
    }
    const pagination = response.data?.pagination || {};
    if (!models.length || !hasMore(pagination, page, models.length, LIMIT)) break;
    page += 1;
  }
  return [...bySlug.values()].sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));
}

/**
 * Fetch one page of brands (stable order, 10 per page).
 *
 * @param {number} [page]
 * @returns {Promise<{ page: number, has_more: boolean, brands: Array<{ slug: string, name: string, profile_image_url: string|null }> }>}
 */
export async function fetchVideoBrands(page = 1) {
  const all = await fetchAllGalleryModels();
  const start = (page - 1) * VIDEO_PAGE_SIZE;
  return {
    page,
    total: all.length,
    has_more: start + VIDEO_PAGE_SIZE < all.length,
    brands: all.slice(start, start + VIDEO_PAGE_SIZE).map((m) => ({
      slug: m.slug,
      name: m.name,
      profile_image_url: m.profile_image_url ?? null,
    })),
  };
}

/**
 * Fetch the FULL gallery record for one brand (used as the persona for
 * video-post generation — video brands live in the API, not brands.json).
 *
 * @param {string} slug
 * @returns {Promise<object>} raw gallery model (name, description, country, secondary_tags, …)
 */
export async function getVideoBrand(slug) {
  const all = await fetchAllGalleryModels();
  const match = all.find((m) => m.slug === slug);
  if (!match) throw new Error(`Brand "${slug}" not found in gallery API.`);
  return match;
}

/**
 * Fetch one page of a brand's videos. Only SFW-category videos are returned.
 *
 * @param {string} slug
 * @param {number} [page]
 * @returns {Promise<{ page: number, has_more: boolean, videos: Array<{ slug: string, title: string, file_url: string }> }>}
 */
export async function fetchBrandVideos(slug, page = 1) {
  const response = await axios.get(videosUrl(slug, page, VIDEO_PAGE_SIZE), { timeout: 30_000 });
  const payload = response.data?.data || response.data || {};
  const rows = payload.videos || [];
  const pagination = payload.pagination || {};
  return {
    page,
    // Total videos the API reports for this brand (before the SFW filter).
    total: pagination.total ?? rows.length,
    // has_more reflects API pages BEFORE the SFW filter, so "Load more" still
    // works even when a filtered page comes back short.
    has_more: hasMore(pagination, page, rows.length, VIDEO_PAGE_SIZE),
    videos: rows
      .filter((v) => v && v.file_url && (v.category || "").toLowerCase() === "sfw")
      .map((v) => ({
        slug: v.slug,
        title: v.title || null,
        file_url: v.file_url,
      })),
  };
}
