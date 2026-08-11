import { fetchSafeImages } from "../../services/safeImageApi.js";
import { validateImage } from "./imageSafetyValidator.js";

const MAX_IMAGE_RETRIES = 5;

/**
 * Resolve a verified-SFW profile image for a brand.
 *
 * Strategy:
 *  1. Validate the current profile_image_url first.
 *  2. If it fails, pull the SFW image pool from the safe-image API and try
 *     candidates one by one. Rejected ids/urls are sent as exclusions so the
 *     same image is never revisited within the run.
 *  3. Stop after MAX_IMAGE_RETRIES replacement attempts.
 *
 * @param {object} brand - { slug, profile_image_url, ... }
 * @param {function} [onEvent]
 * @param {object} [opts]
 * @param {string[]} [opts.excludeUrls] - urls the user already saw and skipped;
 *   the current profile image is not re-validated if it is in this list, so a
 *   re-run advances to the next candidate instead of re-approving the same one.
 * @returns {Promise<{
 *   sfw: boolean,
 *   image: { id: string|null, url: string } | null,
 *   changed: boolean,
 *   attempts: Array<{ image: { id: string|null, url: string }, verdict: object }>,
 *   rejected: Array<{ id: string|null, url: string, reasons: string[] }>
 * }>}
 */
export async function resolveSafeImage(brand, onEvent = () => {}, opts = {}) {
  const attempts = [];
  const rejected = [];
  const excludeIds = new Set();
  const excludeUrls = new Set(opts.excludeUrls || []);

  const currentUrl = brand.profile_image_url || null;
  let attemptNo = 0;

  const safeValidate = async (url) => {
    try {
      return await validateImage(url);
    } catch (err) {
      return { sfw: false, confidence: 0, reasons: [`validator error: ${err.message}`], detected: [] };
    }
  };

  if (currentUrl && !excludeUrls.has(currentUrl)) {
    attemptNo += 1;
    onEvent({ step: "image_check", state: "start", attempt: attemptNo, url: currentUrl, source: "current" });
    const verdict = await safeValidate(currentUrl);
    attempts.push({ image: { id: null, url: currentUrl }, verdict });
    onEvent({
      step: "image_check",
      state: "done",
      attempt: attemptNo,
      url: currentUrl,
      sfw: verdict.sfw,
      reasons: verdict.reasons || [],
      detected: verdict.detected || []
    });

    if (verdict.sfw) {
      return {
        sfw: true,
        image: { id: null, url: currentUrl },
        changed: false,
        attempts,
        rejected
      };
    }

    rejected.push({ id: null, url: currentUrl, reasons: verdict.reasons || [] });
    excludeUrls.add(currentUrl);
  }

  onEvent({ step: "image_pool_fetch", state: "start" });
  let pool = [];
  try {
    pool = await fetchSafeImages(brand.slug, { excludeIds, excludeUrls });
    onEvent({ step: "image_pool_fetch", state: "done", size: pool.length });
  } catch (err) {
    onEvent({ step: "image_pool_fetch", state: "error", error: err.message });
    return {
      sfw: false,
      image: null,
      changed: false,
      attempts,
      rejected,
      error: `safe-image API failed: ${err.message}`
    };
  }

  for (let i = 0; i < MAX_IMAGE_RETRIES && pool.length; i++) {
    const candidate = pool.shift();
    if (excludeUrls.has(candidate.url) || (candidate.id && excludeIds.has(candidate.id))) {
      continue;
    }

    attemptNo += 1;
    onEvent({
      step: "image_check",
      state: "start",
      attempt: attemptNo,
      url: candidate.url,
      source: "replacement"
    });
    const verdict = await safeValidate(candidate.url);
    attempts.push({ image: { id: candidate.id, url: candidate.url }, verdict });
    onEvent({
      step: "image_check",
      state: "done",
      attempt: attemptNo,
      url: candidate.url,
      sfw: verdict.sfw,
      reasons: verdict.reasons || [],
      detected: verdict.detected || []
    });

    if (verdict.sfw) {
      return {
        sfw: true,
        image: { id: candidate.id, url: candidate.url },
        changed: true,
        attempts,
        rejected
      };
    }

    rejected.push({
      id: candidate.id,
      url: candidate.url,
      reasons: verdict.reasons || []
    });
    if (candidate.id) excludeIds.add(candidate.id);
    excludeUrls.add(candidate.url);

    if (!pool.length) {
      try {
        pool = await fetchSafeImages(brand.slug, { excludeIds, excludeUrls });
      } catch {
        break;
      }
    }
  }

  return { sfw: false, image: null, changed: false, attempts, rejected };
}

export { MAX_IMAGE_RETRIES };
