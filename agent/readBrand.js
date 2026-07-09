import { readFileSync } from "node:fs";

const BRANDS_PATH = new URL("../data/brands.json", import.meta.url);

export function getBrand(slug) {
  const raw = readFileSync(BRANDS_PATH, "utf8");
  const data = JSON.parse(raw);

  const brands = Array.isArray(data)
    ? data
    : data.brands ?? [];

  const brand = brands.find(
    (b) => b.slug === slug
  );

  if (!brand) {
    throw new Error(`Brand "${slug}" not found.`);
  }

  return brand;
}