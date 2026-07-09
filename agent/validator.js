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