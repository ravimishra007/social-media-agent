// import { readFile, writeFile, mkdir } from "node:fs/promises";
// import path from "node:path";
// import { fileURLToPath } from "node:url";

// import { liveSearchJson } from "../services/webSearch.js";

// const __dirname = path.dirname(fileURLToPath(import.meta.url));
// const CACHE_DIR = path.join(__dirname, "..", "cache", "trends");
// const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// const PLATFORM_HINT = {
//   instagram: "visually rich, lifestyle-friendly, moment-of-the-week hook",
//   facebook: "conversational, community/story-driven, broadly relatable",
//   x: "punchy, timely, one-line reactable insight or observation",
//   reddit: "substantive, discussion-worthy, tied to a specific subreddit's culture"
// };

// const SYSTEM = `
// You are a senior social-media trend researcher.

// Your job: pick the SINGLE best current trend for a specific creator to post about right now.

// A "trend" here means: a real, verifiable, currently-hot topic — a story, cultural moment, event, meme, holiday, seasonal moment, viral post, or ongoing conversation — that a creator with the given persona could authentically comment on WITHOUT lying about their expertise.

// Hard rules:
// - The trend must be genuinely recent (last 7 days ideal, up to 21 days acceptable if still active).
// - Must be safe-for-work: no politics, no religion, no violence, no adult content, no tragedy, no health scares, no crypto scams.
// - Must be authentic to the creator's country / interests / tags where possible.
// - Must be usable across social platforms without controversy.
// - Do NOT invent a trend. If you cannot find one that fits, return { "found": false }.

// Return ONLY valid JSON. No markdown. Schema:
// {
//   "found": boolean,
//   "topic": string,       // short trend name, 3-8 words
//   "summary": string,     // 2-3 sentences explaining what the trend is + why it's relevant to this creator
//   "angle": string,       // one-line hint on how the creator should approach it in their voice
//   "source_url": string,  // primary source URL you used (empty string if none)
//   "freshness_days": number  // how many days old the trend is (0-21)
// }
// `.trim();

// function buildUser(brand, platform) {
//   const tags = Array.isArray(brand.secondary_tags) ? brand.secondary_tags.join(", ") : "";
//   const platformHint = PLATFORM_HINT[platform] || "general social media";
//   return `
// Creator persona:
// - Name: ${brand.name}
// - Country: ${brand.country || "unspecified"}
// - Ethnicity: ${brand.ethnicity || "unspecified"}
// - Description: ${brand.description || ""}
// - Tags/interests: ${tags}

// Target platform: ${platform} (${platformHint})

// Find the ONE best trend for this creator to post about right now.
// Prefer trends relevant to ${brand.country || "their region"} or their interests: ${tags || "creator lifestyle"}.
// Avoid anything political, religious, tragic, or otherwise unsafe.
// `.trim();
// }

// function cachePath(slug, platform) {
//   return path.join(CACHE_DIR, `${slug}__${platform}.json`);
// }

// async function readCache(slug, platform) {
//   try {
//     const raw = await readFile(cachePath(slug, platform), "utf8");
//     const parsed = JSON.parse(raw);
//     if (Date.now() - parsed.cached_at > CACHE_TTL_MS) return null;
//     return parsed.trend;
//   } catch {
//     return null;
//   }
// }

// async function writeCache(slug, platform, trend) {
//   try {
//     await mkdir(CACHE_DIR, { recursive: true });
//     const payload = { cached_at: Date.now(), trend };
//     await writeFile(cachePath(slug, platform), JSON.stringify(payload, null, 2), "utf8");
//   } catch {
//     // Cache is best-effort — never fail generation because of it.
//   }
// }

// /**
//  * Research the best current trend for a brand on a given platform.
//  *
//  * Returns:
//  *   { topic, summary, angle?, source_url? }  when a suitable trend is found
//  *   null                                     when no trend is available (evergreen fallback)
//  */
// export async function researchTrend(brand, platform, { skipCache = false } = {}) {
//   if (!skipCache) {
//     const cached = await readCache(brand.slug, platform);
//     if (cached) return cached;
//   }

//   let result;
//   try {
//     result = await liveSearchJson({
//       system: SYSTEM,
//       user: buildUser(brand, platform),
//       temperature: 0.3
//     });
//   } catch (err) {
//     console.warn(`trendResearch failed for ${brand.slug}/${platform}: ${err.message}`);
//     return null;
//   }

//   const j = result.json || {};
//   if (!j.found || !j.topic || !j.summary) return null;

//   const trend = {
//     topic: String(j.topic).trim(),
//     summary: String(j.summary).trim(),
//     angle: j.angle ? String(j.angle).trim() : "",
//     source_url: j.source_url ? String(j.source_url).trim() : "",
//     freshness_days: typeof j.freshness_days === "number" ? j.freshness_days : null,
//     citations: result.citations || [],
//     researched_at: new Date().toISOString()
//   };

//   await writeCache(brand.slug, platform, trend);
//   return trend;
// }



// Brand-aware trend researcher.
// Disabled for now — generation runs in evergreen mode.
// Kept as a stub so existing imports don't break.

export async function researchTrend() {
  return null;
}
