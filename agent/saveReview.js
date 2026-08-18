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
  validation,
  options = {}
) {
  mkdirSync(REVIEW_FOLDER, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  // Video posts get a distinct "-video-" token so they never collide with
  // image post files and stay identifiable at a glance.
  const isVideo = options.isVideo === true && options.video?.file_url;
  const filename = isVideo
    ? `${brand.slug}-${platform}-video-${timestamp}.json`
    : `${brand.slug}-${platform}-${timestamp}.json`;

  const review = {
    brand: {
      id: brand.id,
      slug: brand.slug,
      name: brand.name
    },

    // Video posts carry only the video; image posts keep the profile image.
    assets: isVideo
      ? {
          video_url: options.video.file_url,
          video_title: options.video.title ?? null
        }
      : {
          profile_image_url: brand.profile_image_url
        },

    ...(isVideo ? { isVideo: true } : {}),

    // Human attestation that the video itself was watched and judged SFW
    // (the text `validation` below only covers the caption).
    ...(isVideo && options.video.verification
      ? { video_verification: options.video.verification }
      : {}),

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