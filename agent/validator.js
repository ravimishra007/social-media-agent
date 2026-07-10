/**
 * Validate generated content.
 *
 * @param {Object} content
 * @param {Object} guidelines
 * @returns {{passed:boolean,errors:string[]}}
 */

export function validateContent(content, guidelines) {
  const errors = [];

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

  // CTA
  if (
    guidelines.cta.enabled &&
    (!content.cta || !content.cta.trim())
  ) {
    errors.push("CTA is required.");
  }

  return {
    passed: errors.length === 0,
    errors
  };
}