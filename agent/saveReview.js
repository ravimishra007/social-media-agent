import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REVIEW_FOLDER = fileURLToPath(
  new URL("../review/", import.meta.url)
);

export function saveReview(
  brand,
  platform,
  content,
  validation
) {
  mkdirSync(REVIEW_FOLDER, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const filename = `${brand.slug}-${platform}-${timestamp}.json`;

  const review = {
    brand: {
      id: brand.id,
      slug: brand.slug,
      name: brand.name
    },

    assets: {
      profile_image_url: brand.profile_image_url
    },

    platform,

    content,

    // Reddit targeting comes from the brand config (brands.json -> brand.reddit).
    ...(platform === "reddit"
      ? {
          target: {
            subreddit: brand.reddit?.subreddit ?? null,
            flair: brand.reddit?.flair ?? null
          }
        }
      : {}),

    validation,

    status: "review",

    created_at: new Date().toISOString()
  };

  const filePath = path.join(REVIEW_FOLDER, filename);

  writeFileSync(
    filePath,
    JSON.stringify(review, null, 2),
    "utf8"
  );

  return filePath;
}