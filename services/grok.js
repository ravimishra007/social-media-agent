import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_URL = "https://api.x.ai/v1/chat/completions";
const MODEL = process.env.XAI_MODEL || "grok-4";
/**
 * Extract JSON object from LLM response.
 */
function extractJson(text) {
  if (!text) {
    throw new Error("Empty response from Grok.");
  }

  // Remove ```json ... ``` if present
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error("No valid JSON found in Grok response.");
    }

    return JSON.parse(match[0]);
  }
}

/**
 * Generate social media content using Grok.
 *
 * @param {string} prompt
 * @returns {Promise<Object>}
 */
export async function generateContent(prompt) {
  try {
    const response = await axios.post(
      API_URL,
      {
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `
You are an expert Social Media Content Creator.

Rules:
- Return ONLY valid JSON.
- Never wrap JSON inside markdown.
- Never explain your answer.
- Do not return extra text.
- Use exactly the JSON structure requested in the user's message, including every field it specifies.
`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.8
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const content = response.data.choices[0].message.content;

    return extractJson(content);

  } catch (error) {
    console.error("\n❌ Grok API Error\n");

    if (error.response) {
      console.error(error.response.status);
      console.error(error.response.data);
    } else {
      console.error(error.message);
    }

    throw error;
  }
}