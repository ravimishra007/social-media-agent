// import axios from "axios";
// import dotenv from "dotenv";

// dotenv.config();

// const API_URL = "https://api.x.ai/v1/responses";
// const MODEL = process.env.XAI_SEARCH_MODEL || "grok-4.5";

// function extractJson(text) {
//   if (!text) throw new Error("Empty text from Grok responses API.");
//   const cleaned = text
//     .replace(/```json/gi, "")
//     .replace(/```/g, "")
//     .trim();
//   try {
//     return JSON.parse(cleaned);
//   } catch {
//     const match = cleaned.match(/\{[\s\S]*\}/);
//     if (!match) throw new Error("No valid JSON found in Grok responses output.");
//     return JSON.parse(match[0]);
//   }
// }

// function collectText(output) {
//   const parts = [];
//   for (const item of output || []) {
//     if (item.type === "message" && Array.isArray(item.content)) {
//       for (const c of item.content) {
//         if (c.type === "output_text" && c.text) parts.push(c.text);
//       }
//     }
//   }
//   return parts.join("\n").trim();
// }

// function collectCitations(output) {
//   const urls = new Set();
//   for (const item of output || []) {
//     if (item.type === "web_search_call" && item.action?.sources) {
//       for (const s of item.action.sources) {
//         if (s.url) urls.add(s.url);
//       }
//     }
//   }
//   return Array.from(urls);
// }

// /**
//  * Ask Grok (via the Responses API) with the `web_search` tool enabled,
//  * expect a JSON object back in the assistant message.
//  *
//  * @param {object} opts
//  * @param {string} opts.system - developer/system-level instruction
//  * @param {string} opts.user
//  * @param {number} [opts.temperature]
//  * @returns {Promise<{ json: any, citations: string[] }>}
//  */
// export async function liveSearchJson({ system, user, temperature = 0.3 }) {
//   const payload = {
//     model: MODEL,
//     input: [
//       { role: "system", content: system },
//       { role: "user", content: user }
//     ],
//     tools: [{ type: "web_search" }],
//     temperature
//   };

//   try {
//     const response = await axios.post(API_URL, payload, {
//       headers: {
//         Authorization: `Bearer ${process.env.XAI_API_KEY}`,
//         "Content-Type": "application/json"
//       },
//       timeout: 120_000
//     });

//     const text = collectText(response.data.output);
//     const citations = collectCitations(response.data.output);
//     return { json: extractJson(text), citations };
//   } catch (err) {
//     const apiErr = err.response?.data?.error || err.response?.data;
//     const detail = typeof apiErr === "string" ? apiErr : JSON.stringify(apiErr || {});
//     const status = err.response?.status || "?";
//     throw new Error(`xAI responses ${status}: ${detail || err.message}`);
//   }
// }



// Live web search via xAI Responses API.
// Disabled for now — the trend feature is turned off.
// Kept as a stub so existing imports don't break.

export async function liveSearchJson() {
  return null;
}

