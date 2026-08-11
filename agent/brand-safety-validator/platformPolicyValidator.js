import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICIES_DIR = path.join(__dirname, "policies");

const policyCache = new Map();

async function loadPolicy(platform) {
  if (policyCache.has(platform)) return policyCache.get(platform);
  const file = path.join(POLICIES_DIR, `${platform}.json`);
  const raw = await readFile(file, "utf8");
  const policy = JSON.parse(raw);
  policyCache.set(platform, policy);
  return policy;
}

function normalizeTag(tag) {
  return String(tag || "").trim().toLowerCase().replace(/^#/, "");
}

function daysBetween(fromIso, toDate = new Date()) {
  if (!fromIso) return Infinity;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return Infinity;
  return Math.floor((toDate.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function hasUrl(text) {
  return /\bhttps?:\/\/\S+/i.test(text || "");
}

/**
 * Deterministic platform-policy check for a generated post.
 * No LLM calls. Safe to run before any moderation.
 *
 * @param {{
 *   content: { caption?: string, hashtags?: string[], cta?: string, title?: string },
 *   brand: { slug?: string, created_at?: string },
 *   platform: string,
 *   accountAgeDays?: number
 * }} args
 * @returns {Promise<{ passed: boolean, errors: string[], warnings: string[], applied: object }>}
 */
export async function validatePlatformPolicy({ content, brand, platform, accountAgeDays }) {
  const errors = [];
  const warnings = [];

  let policy;
  try {
    policy = await loadPolicy(platform);
  } catch (err) {
    // No policy file = platform is opted out (e.g. reddit). Pass through.
    return {
      passed: true,
      errors,
      warnings: [`no policy file for platform '${platform}' — skipping platform policy checks`],
      applied: null
    };
  }

  const caption = String(content?.caption || "");
  const hashtags = Array.isArray(content?.hashtags) ? content.hashtags : [];
  const cta = String(content?.cta || "");

  const ageDays = typeof accountAgeDays === "number"
    ? accountAgeDays
    : daysBetween(brand?.created_at);
  const isNewAccount = ageDays < (policy.new_account?.days_threshold ?? 0);

  const maxHashtags = isNewAccount && typeof policy.new_account?.hashtag_max_override === "number"
    ? policy.new_account.hashtag_max_override
    : policy.hashtags?.max_recommended;

  // 1. Hashtag count
  if (typeof maxHashtags === "number" && hashtags.length > maxHashtags) {
    errors.push(
      `hashtag count ${hashtags.length} exceeds ${isNewAccount ? "new-account " : ""}max ${maxHashtags}`
    );
  }

  // 2 + 3. Hashtag deny-list + patterns
  const denyList = new Set((policy.hashtags?.deny_list || []).map(normalizeTag));
  const denyPatterns = (policy.hashtags?.deny_patterns || []).map((p) => new RegExp(p, "i"));

  for (const tag of hashtags) {
    const norm = normalizeTag(tag);
    if (!norm) continue;
    if (denyList.has(norm)) {
      errors.push(`hashtag '#${norm}' is on the deny-list (spam/bot signal)`);
      continue;
    }
    for (const rx of denyPatterns) {
      if (rx.test(norm)) {
        errors.push(`hashtag '#${norm}' matches deny pattern /${rx.source}/`);
        break;
      }
    }
  }

  // 4. Solicitation-signal count
  const solicitationSignals = policy.caption?.solicitation_signals || [];
  const solicitationMax = policy.caption?.solicitation_max ?? 0;
  const captionLower = caption.toLowerCase();
  const solicitationHits = solicitationSignals.filter((s) => captionLower.includes(s.toLowerCase()));
  if (solicitationHits.length > solicitationMax) {
    errors.push(
      `caption contains ${solicitationHits.length} solicitation signal(s) [${solicitationHits.join(", ")}]; max ${solicitationMax}`
    );
  }

  // 5. Stereotype patterns against caption + hashtags
  const stereotypeBlob = [caption, hashtags.join(" ")].join(" ");
  for (const raw of policy.stereotype_patterns || []) {
    const rx = new RegExp(raw, "i");
    if (rx.test(stereotypeBlob)) {
      errors.push(`stereotype pattern matched: /${raw}/`);
    }
  }

  // 6. New-account CTA / link gate
  if (isNewAccount) {
    if (policy.new_account?.forbid_cta && cta.trim()) {
      errors.push(`new-account rule: CTA not allowed (account age ${ageDays}d < ${policy.new_account.days_threshold}d)`);
    }
    if (policy.new_account?.forbid_links && hasUrl(caption)) {
      errors.push(`new-account rule: URLs not allowed in caption (account age ${ageDays}d < ${policy.new_account.days_threshold}d)`);
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    applied: {
      platform,
      accountAgeDays: ageDays,
      isNewAccount,
      maxHashtags
    }
  };
}
