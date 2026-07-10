import { moderateText, rewriteTextSFW } from "../../services/grokModeration.js";

const MAX_TEXT_RETRIES = 5;

function buildTextBlob(brand) {
  return [
    brand.description || "",
    Array.isArray(brand.secondary_tags) ? brand.secondary_tags.join(", ") : "",
    brand.country || "",
    brand.ethnicity || ""
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Validate + (if needed) rewrite a brand's text fields until SFW or attempts run out.
 *
 * @param {object} brand
 * @returns {Promise<{
 *   sfw: boolean,
 *   attempts: Array<{ verdict: object, applied?: { description: string, secondary_tags: string[] } }>,
 *   final: { description: string, secondary_tags: string[] },
 *   changed: boolean
 * }>}
 */
export async function validateBrandText(brand, onEvent = () => {}) {
  let current = {
    description: brand.description || "",
    secondary_tags: Array.isArray(brand.secondary_tags) ? [...brand.secondary_tags] : []
  };

  const attempts = [];
  let changed = false;

  onEvent({ step: "text_check", state: "start", attempt: 1 });
  const first = await moderateText(buildTextBlob({ ...brand, ...current }));
  attempts.push({ verdict: first });
  onEvent({
    step: "text_check",
    state: "done",
    attempt: 1,
    sfw: first.sfw,
    reasons: first.reasons || [],
    flagged_terms: first.flagged_terms || []
  });

  if (first.sfw) {
    return { sfw: true, attempts, final: current, changed: false };
  }

  const collectedReasons = [...(first.reasons || [])];

  for (let i = 0; i < MAX_TEXT_RETRIES; i++) {
    const attemptNo = i + 2;

    onEvent({ step: "text_rewrite", state: "start", attempt: attemptNo });
    const rewritten = await rewriteTextSFW({
      description: current.description,
      secondary_tags: current.secondary_tags,
      country: brand.country,
      ethnicity: brand.ethnicity,
      previous_reasons: collectedReasons
    });
    current = rewritten;
    changed = true;
    onEvent({
      step: "text_rewrite",
      state: "done",
      attempt: attemptNo,
      description: current.description,
      secondary_tags: current.secondary_tags
    });

    onEvent({ step: "text_check", state: "start", attempt: attemptNo });
    const verdict = await moderateText(buildTextBlob({ ...brand, ...current }));
    attempts.push({ verdict, applied: current });
    onEvent({
      step: "text_check",
      state: "done",
      attempt: attemptNo,
      sfw: verdict.sfw,
      reasons: verdict.reasons || [],
      flagged_terms: verdict.flagged_terms || []
    });

    if (verdict.sfw) {
      return { sfw: true, attempts, final: current, changed };
    }

    collectedReasons.push(...(verdict.reasons || []));
  }

  return { sfw: false, attempts, final: current, changed };
}
