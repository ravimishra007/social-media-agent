import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_URL = "https://api.x.ai/v1/chat/completions";
const TEXT_MODEL = process.env.XAI_MODERATION_MODEL || process.env.XAI_MODEL || "grok-4";
const VISION_MODEL = process.env.XAI_VISION_MODEL || "grok-4.3";

function extractJson(text) {
  if (!text) throw new Error("Empty response from Grok.");
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No valid JSON found in Grok moderation response.");
    return JSON.parse(match[0]);
  }
}

async function chat(model, messages, { temperature = 0 } = {}) {
  try {
    const response = await axios.post(
      API_URL,
      { model, messages, temperature },
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 60_000
      }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    const apiErr = err.response?.data?.error || err.response?.data;
    const detail = typeof apiErr === "string" ? apiErr : JSON.stringify(apiErr || {});
    const status = err.response?.status || "?";
    throw new Error(`xAI ${model} ${status}: ${detail || err.message}`);
  }
}

const TEXT_SYSTEM = `
You are a strict Safe-For-Work (SFW) content moderator.
You classify text (brand descriptions, tags, keywords) as SFW or NSFW.

Definition of NSFW:
- Sexual, erotic, suggestive, or fetish content
- Nudity references, explicit body descriptions
- Adult platforms (OnlyFans, Fansly, etc.), escort, adult performer terms
- Graphic violence, gore, self-harm, hate speech, illegal content

Return ONLY valid JSON. No markdown. No commentary.
Schema:
{
  "sfw": boolean,
  "confidence": number between 0 and 1,
  "reasons": string[],
  "flagged_terms": string[]
}
`.trim();

/**
 * Classify plain text as SFW or NSFW.
 * @param {string} text
 * @returns {Promise<{ sfw: boolean, confidence: number, reasons: string[], flagged_terms: string[] }>}
 */
export async function moderateText(text) {
  const raw = await chat(TEXT_MODEL, [
    { role: "system", content: TEXT_SYSTEM },
    { role: "user", content: `Classify this text:\n\n${text}` }
  ]);
  return extractJson(raw);
}

const REWRITE_SYSTEM = `
You rewrite brand text so it is fully Safe-For-Work while keeping the same voice and identity.

Rules:
- Preserve first name, ethnicity, country, and profession-appropriate hobbies.
- Remove or replace any sexual, suggestive, adult-platform, or unsafe references.
- Do NOT invent new adult, fetish, or violent references.
- Keep the tone warm, professional, and creator-friendly.

Return ONLY valid JSON. No markdown. Schema exactly:
{
  "description": string,
  "secondary_tags": string[]
}
`.trim();

/**
 * Ask Grok to rewrite a brand's description and tags into an SFW version.
 * @param {{ description: string, secondary_tags: string[], country?: string, ethnicity?: string, previous_reasons?: string[] }} brandText
 * @returns {Promise<{ description: string, secondary_tags: string[] }>}
 */
export async function rewriteTextSFW(brandText) {
  const payload = {
    description: brandText.description || "",
    secondary_tags: brandText.secondary_tags || [],
    country: brandText.country || null,
    ethnicity: brandText.ethnicity || null,
    previous_reasons: brandText.previous_reasons || []
  };
  const raw = await chat(TEXT_MODEL, [
    { role: "system", content: REWRITE_SYSTEM },
    {
      role: "user",
      content: `Rewrite this brand text into an SFW version.\n\nInput JSON:\n${JSON.stringify(payload, null, 2)}`
    }
  ], { temperature: 0.4 });
  const out = extractJson(raw);
  return {
    description: String(out.description || "").trim(),
    secondary_tags: Array.isArray(out.secondary_tags) ? out.secondary_tags.map(String) : []
  };
}

const IMAGE_SYSTEM = `
You are a strict Safe-For-Work (SFW) image moderator.

Definition of NSFW:
- Nudity (partial or full), exposed genitals, exposed breasts, sheer/see-through clothing revealing intimate areas
- Sexually suggestive poses, lingerie/underwear as primary outfit, fetish attire
- Graphic violence, gore, weapons pointed at people, hate symbols
- Any content unsuitable for a general social media platform

You return a strict JSON verdict for the given image.

Return ONLY valid JSON. No markdown. Schema:
{
  "sfw": boolean,
  "confidence": number between 0 and 1,
  "reasons": string[],
  "detected": string[]
}
`.trim();

/**
 * Classify an image URL as SFW / NSFW using Grok Vision.
 * @param {string} imageUrl
 * @returns {Promise<{ sfw: boolean, confidence: number, reasons: string[], detected: string[] }>}
 */
export async function moderateImage(imageUrl) {
  if (!imageUrl) throw new Error("moderateImage: imageUrl is required");
  const raw = await chat(VISION_MODEL, [
    { role: "system", content: IMAGE_SYSTEM },
    {
      role: "user",
      content: [
        { type: "text", text: "Classify this image as SFW or NSFW. Return JSON only." },
        { type: "image_url", image_url: { url: imageUrl } }
      ]
    }
  ]);
  return extractJson(raw);
}
