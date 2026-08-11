/**
 * Validate generated content.
 *
 * Structural checks only (word count, hashtag count, CTA presence when
 * guidelines.cta.required is true).
 * Policy/moderation is handled downstream by postSafetyValidator, which
 * consumes guidelines.validation.* flags. This function asserts those
 * flags exist so a missing config surfaces here instead of silently
 * disabling the safety gate.
 *
 * @param {Object} content
 * @param {Object} guidelines
 * @returns {{passed:boolean,errors:string[]}}
 */

const REQUIRED_VALIDATION_FLAGS = ["allow_nsfw", "allow_hate", "allow_politics", "allow_misinformation"];

export function validateContent(content, guidelines) {
  const errors = [];

  // Fail-loud on missing safety config so it can never quietly regress.
  const validation = guidelines.validation || {};
  for (const flag of REQUIRED_VALIDATION_FLAGS) {
    if (typeof validation[flag] !== "boolean") {
      errors.push(`guidelines.validation.${flag} must be a boolean (got ${typeof validation[flag]}).`);
    }
  }

  // Caption
  if (!content.caption || !content.caption.trim()) {
    errors.push("Caption is required.");
  } else {
    const wordCount = content.caption.trim().split(/\s+/).filter(Boolean).length;
    const { min_words, max_words } = guidelines.content || {};
    if (typeof max_words === "number" && wordCount > max_words) {
      errors.push(`Caption is ${wordCount} words; max is ${max_words}.`);
    }
    if (typeof min_words === "number" && wordCount < min_words) {
      errors.push(`Caption is ${wordCount} words; min is ${min_words}.`);
    }
  }

  // Hashtags
  if (!Array.isArray(content.hashtags)) {
    errors.push("Hashtags must be an array.");
  } else if (
    content.hashtags.length > guidelines.hashtags.max
  ) {
    errors.push(
      `Maximum ${guidelines.hashtags.max} hashtags allowed.`
    );
  }

  // CTA is optional. cta.enabled only means the prompt asks the model for one;
  // a platform must set cta.required = true to make a missing CTA a failure.
  if (
    guidelines.cta.required === true &&
    (!content.cta || !content.cta.trim())
  ) {
    errors.push("CTA is required.");
  }

  return {
    passed: errors.length === 0,
    errors
  };
}