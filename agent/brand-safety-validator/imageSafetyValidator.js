import { moderateImage } from "../../services/grokModeration.js";

/**
 * Validate a single image URL. Thin wrapper so the orchestrator only
 * knows about "validators", not raw Grok clients.
 *
 * @param {string} imageUrl
 * @returns {Promise<{ sfw: boolean, confidence: number, reasons: string[], detected: string[] }>}
 */
export async function validateImage(imageUrl) {
  if (!imageUrl) {
    return { sfw: false, confidence: 1, reasons: ["missing image url"], detected: [] };
  }
  return moderateImage(imageUrl);
}
