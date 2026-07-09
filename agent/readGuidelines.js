import { readFileSync } from "node:fs";

const GUIDELINES_PATH = new URL("../data/guidelines.json", import.meta.url);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Deep-merge: override wins, nested objects merge, non-objects replace.
function deepMerge(base, override) {
  const result = { ...base };

  for (const key of Object.keys(override)) {
    if (isObject(base[key]) && isObject(override[key])) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }

  return result;
}

export function getGuidelines(platform) {
  const raw = readFileSync(GUIDELINES_PATH, "utf8");
  const data = JSON.parse(raw);

  if (!(platform in data) || platform === "default") {
    throw new Error(`Unsupported platform: ${platform}`);
}

  return deepMerge(data.default, data[platform]);
}
