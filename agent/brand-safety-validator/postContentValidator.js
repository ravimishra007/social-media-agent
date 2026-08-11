import { moderatePostText } from "../../services/grokModeration.js";

/**
 * LLM moderation for a GENERATED post. Runs after platformPolicyValidator
 * passes, so regex-catchable issues never reach the model.
 *
 * @param {{ caption?: string, hashtags?: string[], cta?: string, title?: string }} content
 * @param {{ name?: string, country?: string, ethnicity?: string }} brand
 * @returns {Promise<{
 *   sfw: boolean,
 *   confidence: number,
 *   categories: { nsfw: boolean, hateful: boolean, stereotype: boolean, solicitation: boolean, impersonation: boolean },
 *   reasons: string[],
 *   flagged_terms: string[]
 * }>}
 */
export async function validatePostContent(content, brand = {}) {
  const empty = !content?.caption && !(content?.hashtags?.length) && !content?.cta && !content?.title;
  if (empty) {
    return {
      sfw: false,
      confidence: 1,
      categories: { nsfw: false, hateful: false, stereotype: false, solicitation: false, impersonation: false },
      reasons: ["post has no caption, hashtags, cta, or title"],
      flagged_terms: []
    };
  }
  return moderatePostText(content, brand);
}
