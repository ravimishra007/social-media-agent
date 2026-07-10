import { readFileSync } from "node:fs";

const PROMPTS_FOLDER = new URL("../prompts/", import.meta.url);

/**
 * Builds the final prompt from a platform template.
 *
 * @param {Object} brand
 * @param {Object} guidelines
 * @param {Object|null} trend
 * @param {string} platform
 * @returns {string}
 */
export function buildPrompt(
  brand,
  guidelines,
  trend = null,
  platform
) {
  const templatePath = new URL(
    `${platform}.md`,
    PROMPTS_FOLDER
  );

  console.log({templatePath});
  
  let template = readFileSync(templatePath, "utf8");

  const trendText = trend
    ? [
        `Topic: ${trend.topic}`,
        `Summary: ${trend.summary}`,
        trend.angle ? `Angle: ${trend.angle}` : null,
        trend.source_url ? `Source: ${trend.source_url}` : null
      ].filter(Boolean).join("\n")
    : "No current trend available. Create an evergreen post.";

  const variables = {
    name: brand.name,
    description: brand.description,
    country: brand.country,
    tags: brand.secondary_tags.join(", "),

    language: guidelines.language,
    tone: guidelines.tone,
    target_audience: guidelines.target_audience || "General Audience",

    max_words: guidelines.content.max_words,

    emoji_enabled: guidelines.emoji.enabled ? "Yes" : "No",
    emoji_max: guidelines.emoji.max,

    hashtags_enabled: guidelines.hashtags.enabled ? "Yes" : "No",
    hashtags_max: guidelines.hashtags.max,

    cta_enabled: guidelines.cta.enabled ? "Yes" : "No",
    cta_style: guidelines.cta.style,

    trend: trendText
  };

  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value);
  }

  return template;
}