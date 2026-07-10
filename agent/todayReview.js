import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = path.join(__dirname, "..", "review");
const APPROVED_DIR = path.join(__dirname, "..", "approved");
const PUBLISHED_DIR = path.join(__dirname, "..", "published");
const BRANDS_PATH = path.join(__dirname, "..", "data", "brands.json");

const PLATFORMS = ["instagram", "facebook", "x", "reddit"];

/**
 * "Today" per Asia/Kolkata (IST is fixed UTC+5:30 — no DST).
 * Returns "YYYY-MM-DD" as observed in IST for the given instant.
 */
function istDateString(instant) {
  const shifted = new Date(instant.getTime() + 5.5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function listJson(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
    return Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f.name);
        try {
          const raw = await readFile(full, "utf8");
          return { file: f.name, data: JSON.parse(raw) };
        } catch {
          return null;
        }
      })
    ).then((rows) => rows.filter(Boolean));
  } catch {
    return [];
  }
}

async function loadSFWBrandSet() {
  try {
    const raw = await readFile(BRANDS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.brands ?? [];
    return new Set(list.filter((b) => b.isSFW === true).map((b) => b.slug));
  } catch {
    return new Set();
  }
}

/**
 * Build the set of brand slugs that are already "taken for today":
 * any brand with an approved/ or published/ post whose relevant timestamp
 * (published_at || approved_at || created_at) falls on today's IST date.
 */
async function loadTakenBrands(todayIst) {
  const taken = new Set();
  const scan = async (dir) => {
    const items = await listJson(dir);
    for (const { data } of items) {
      const ts = data?.published_at || data?.approved_at || data?.created_at;
      if (!ts) continue;
      if (istDateString(new Date(ts)) !== todayIst) continue;
      const slug = data?.brand?.slug;
      if (slug) taken.add(slug);
    }
  };
  await Promise.all([scan(APPROVED_DIR), scan(PUBLISHED_DIR)]);
  return taken;
}

/**
 * Group review/ candidates by platform, keep only SFW-verified brands,
 * sort each group oldest-first by created_at.
 */
async function loadReviewCandidates(sfwBrands) {
  const items = await listJson(REVIEW_DIR);
  const groups = { instagram: [], facebook: [], x: [], reddit: [] };
  for (const { file, data } of items) {
    const platform = String(data?.platform || "").toLowerCase();
    const slug = data?.brand?.slug;
    if (!platform || !slug) continue;
    if (!PLATFORMS.includes(platform)) continue;
    if (!sfwBrands.has(slug)) continue;
    groups[platform].push({
      file,
      slug,
      name: data?.brand?.name || slug,
      created_at: data?.created_at || null,
      data
    });
  }
  for (const p of PLATFORMS) {
    groups[p].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : Infinity;
      const tb = b.created_at ? new Date(b.created_at).getTime() : Infinity;
      return ta - tb;
    });
  }
  return groups;
}

/**
 * Pick 4 posts — one per platform — for today's IST date.
 *
 * Constraints:
 *  - each pick's brand must be SFW-verified (isSFW: true)
 *  - each pick's brand must NOT already be taken today
 *    (approved/ + published/ dated today, IST)
 *  - the 4 picks must be from 4 different brands
 *  - prefer oldest created_at within each platform group
 *  - solve scarcest-platform-first to avoid greedy shutouts
 *
 * Streams progress via onEvent so the UI can show a live "searching" animation.
 *
 * @param {(event: object) => void} onEvent
 * @returns {Promise<{ date: string, picks: Record<string, object|null>, taken: string[] }>}
 */
export async function suggestTodayBatch(onEvent = () => {}) {
  const now = new Date();
  const todayIst = istDateString(now);

  onEvent({ step: "start", date: todayIst });

  const [sfwBrands, taken] = await Promise.all([
    loadSFWBrandSet(),
    loadTakenBrands(todayIst)
  ]);

  onEvent({
    step: "context",
    sfw_brand_count: sfwBrands.size,
    taken_brands: Array.from(taken)
  });

  const groups = await loadReviewCandidates(sfwBrands);
  onEvent({
    step: "candidates",
    counts: Object.fromEntries(PLATFORMS.map((p) => [p, groups[p].length]))
  });

  const usedBrands = new Set(taken);
  const picks = { instagram: null, facebook: null, x: null, reddit: null };

  // Scarcest-first ordering — platform with the fewest eligible candidates
  // picks first, so it doesn't get shut out by an earlier platform grabbing
  // its only usable brand.
  const eligibleForPlatform = (p) => groups[p].filter((c) => !usedBrands.has(c.slug));
  const order = [...PLATFORMS].sort(
    (a, b) => eligibleForPlatform(a).length - eligibleForPlatform(b).length
  );

  for (const platform of order) {
    onEvent({ step: "search_start", platform });

    const eligible = eligibleForPlatform(platform);
    if (!eligible.length) {
      onEvent({
        step: "search_done",
        platform,
        picked: null,
        reason: groups[platform].length === 0
          ? "no SFW candidates in review"
          : "all candidate brands already taken today"
      });
      continue;
    }

    const chosen = eligible[0];
    picks[platform] = {
      file: chosen.file,
      slug: chosen.slug,
      name: chosen.name,
      created_at: chosen.created_at,
      data: chosen.data
    };
    usedBrands.add(chosen.slug);

    onEvent({
      step: "search_done",
      platform,
      picked: {
        file: chosen.file,
        slug: chosen.slug,
        name: chosen.name,
        created_at: chosen.created_at
      },
      considered: eligible.length
    });
  }

  const result = { date: todayIst, picks, taken: Array.from(taken) };
  onEvent({ step: "done", result });
  return result;
}
