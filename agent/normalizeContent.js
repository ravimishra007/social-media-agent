/**
 * Normalize LLM-generated content before validation.
 *
 * The model sometimes returns hashtags without the leading "#" or with
 * stray whitespace. Stored JSON and publishing expect "#tag", so this
 * enforces that shape deterministically instead of relying on the prompt.
 *
 * @param {Object} content parsed model output
 * @returns {Object} content with normalized hashtags (other fields untouched)
 */
export function normalizeContent(content) {
  if (!content || !Array.isArray(content.hashtags)) {
    return content;
  }

  const hashtags = content.hashtags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.replace(/\s+/g, "").replace(/^#+/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`);

  return { ...content, hashtags: [...new Set(hashtags)] };
}
