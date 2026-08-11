import { readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateBrandText } from "./contentSafetyValidator.js";
import { resolveSafeImage } from "./safeImageResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRANDS_PATH = path.join(__dirname, "..", "..", "data", "brands.json");
const HISTORY_PATH = path.join(__dirname, "..", "..", "data", "safety-history.jsonl");

async function readBrands() {
  const raw = await readFile(BRANDS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.brands ?? [];
  const isArrayShape = Array.isArray(parsed);
  return { list, isArrayShape, original: parsed };
}

async function writeBrands({ list, isArrayShape, original }) {
  const next = isArrayShape ? list : { ...original, brands: list };
  await writeFile(BRANDS_PATH, JSON.stringify(next, null, 2), "utf8");
}

async function appendHistory(entry) {
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() });
  await appendFile(HISTORY_PATH, line + "\n", "utf8");
}

function stripStatus(brand) {
  const { safety: _s, isSFW: _b, ...rest } = brand;
  return rest;
}

/**
 * Full SFW pipeline for one brand.
 *
 * @param {string} slug
 * @param {function} [onEvent]
 * @param {object} [opts]
 * @param {string[]} [opts.excludeImageUrls] - images the user already saw and
 *   skipped; the resolver moves past them so a re-run picks the next candidate.
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'verified_sfw' | 'manual_review_required' | 'brand_not_found',
 *   slug: string,
 *   updated?: object,
 *   text: object,
 *   image: object
 * }>}
 */
export async function validateBrandSafety(slug, onEvent = () => {}, opts = {}) {
  onEvent({ step: "start", slug });

  const { list, isArrayShape, original } = await readBrands();
  const idx = list.findIndex((b) => b.slug === slug);
  if (idx < 0) {
    onEvent({ step: "done", ok: false, status: "brand_not_found" });
    return { ok: false, status: "brand_not_found", slug };
  }

  const brand = list[idx];

  onEvent({ step: "phase", name: "text" });
  const text = await validateBrandText(brand, onEvent);
  onEvent({
    step: "text_phase",
    state: "done",
    sfw: text.sfw,
    changed: text.changed,
    final: text.final,
    attempts: text.attempts.length
  });

  const working = {
    ...brand,
    description: text.final.description,
    secondary_tags: text.final.secondary_tags
  };

  onEvent({ step: "phase", name: "image" });
  const image = await resolveSafeImage(working, onEvent, {
    excludeUrls: opts.excludeImageUrls || []
  });
  onEvent({
    step: "image_phase",
    state: "done",
    sfw: image.sfw,
    changed: image.changed,
    chosen: image.image || null,
    attempts: image.attempts.length,
    rejected: image.rejected.length,
    error: image.error || null
  });

  const bothOk = text.sfw && image.sfw;
  const nowIso = new Date().toISOString();

  if (!bothOk) {
    await appendHistory({
      slug,
      status: "manual_review_required",
      text: {
        sfw: text.sfw,
        changed: text.changed,
        attempts: text.attempts
      },
      image: {
        sfw: image.sfw,
        changed: image.changed,
        attempts: image.attempts,
        rejected: image.rejected,
        error: image.error || null
      }
    });

    const failResult = { ok: false, status: "manual_review_required", slug, text, image };
    onEvent({ step: "done", ok: false, status: "manual_review_required", result: failResult });
    return failResult;
  }

  // Success — persist to brands.json.
  const updated = {
    ...stripStatus(working),
    profile_image_url: image.image.url,
    isSFW: true
  };

  list[idx] = updated;
  await writeBrands({ list, isArrayShape, original });

  await appendHistory({
    slug,
    status: "verified_sfw",
    text: {
      sfw: true,
      changed: text.changed,
      attempts: text.attempts
    },
    image: {
      sfw: true,
      changed: image.changed,
      chosen: image.image,
      attempts: image.attempts,
      rejected: image.rejected
    }
  });

  const okResult = { ok: true, status: "verified_sfw", slug, updated, text, image };
  onEvent({ step: "done", ok: true, status: "verified_sfw", result: okResult });
  return okResult;
}
