import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePlatformPolicy } from "./platformPolicyValidator.js";
import { validatePostContent } from "./postContentValidator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, "..", "..", "data", "post-safety-history.jsonl");

async function appendHistory(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  try {
    await appendFile(HISTORY_PATH, line + "\n", "utf8");
  } catch {
    // History is best-effort; never fail the pipeline on log errors.
  }
}

/**
 * Full safety pipeline for ONE generated post on ONE platform.
 *
 * Order:
 *   1. platformPolicyValidator (deterministic — deny-lists, stereotypes, new-account)
 *   2. postContentValidator    (LLM — hateful/stereotype/solicitation/impersonation)
 *
 * Skip step 2 if step 1 rejects — save the xAI call.
 *
 * @param {{
 *   content: { caption?: string, hashtags?: string[], cta?: string, title?: string },
 *   brand:   { slug?: string, name?: string, country?: string, ethnicity?: string, created_at?: string },
 *   platform: string,
 *   accountAgeDays?: number,
 *   validationFlags?: { allow_nsfw?: boolean, allow_hate?: boolean, allow_politics?: boolean, allow_misinformation?: boolean }
 * }} args
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'verified_safe' | 'policy_rejected' | 'moderation_rejected' | 'moderation_error',
 *   errors: string[],
 *   warnings: string[],
 *   policy: object,
 *   moderation: object | null
 * }>}
 */
export async function validatePostSafety({ content, brand, platform, accountAgeDays, validationFlags = {} }) {
  const policy = await validatePlatformPolicy({ content, brand, platform, accountAgeDays });

  if (!policy.passed) {
    const result = {
      ok: false,
      status: "policy_rejected",
      errors: policy.errors,
      warnings: policy.warnings,
      policy,
      moderation: null
    };
    await appendHistory({ slug: brand?.slug, platform, ...result });
    return result;
  }

  let moderation = null;
  try {
    moderation = await validatePostContent(content, brand);
  } catch (err) {
    const result = {
      ok: false,
      status: "moderation_error",
      errors: [`moderation error: ${err.message}`],
      warnings: policy.warnings,
      policy,
      moderation: null
    };
    await appendHistory({ slug: brand?.slug, platform, ...result });
    return result;
  }

  const categories = moderation.categories || {};
  const violations = [];
  if (categories.nsfw && !validationFlags.allow_nsfw) violations.push("nsfw");
  if (categories.hateful && !validationFlags.allow_hate) violations.push("hateful");
  if (categories.stereotype) violations.push("stereotype");
  if (categories.solicitation) violations.push("solicitation");
  if (categories.impersonation) violations.push("impersonation");

  if (violations.length || moderation.sfw === false) {
    const result = {
      ok: false,
      status: "moderation_rejected",
      errors: [
        `moderation rejected: ${violations.join(", ") || "sfw=false"}`,
        ...(moderation.reasons || [])
      ],
      warnings: policy.warnings,
      policy,
      moderation
    };
    await appendHistory({ slug: brand?.slug, platform, ...result });
    return result;
  }

  const result = {
    ok: true,
    status: "verified_safe",
    errors: [],
    warnings: policy.warnings,
    policy,
    moderation
  };
  await appendHistory({ slug: brand?.slug, platform, ...result });
  return result;
}
