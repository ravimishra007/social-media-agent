import { getBrand } from "./agent/readBrand.js";
import { getGuidelines } from "./agent/readGuidelines.js";
import { buildPrompt } from "./agent/promptBuilder.js";
import { generateContent } from "./services/grok.js";
import { normalizeContent } from "./agent/normalizeContent.js";
import { validateContent } from "./agent/validator.js";
import { validatePostSafety } from "./agent/brand-safety-validator/postSafetyValidator.js";
import { saveReview } from "./agent/saveReview.js";

async function main() {
  try {
    console.log("\n🚀 SOCIAL MEDIA FACTORY STARTED\n");

    const brand = getBrand("chloe-thompson");

    console.log(`✅ Brand Loaded: ${brand.name}`);

    const platforms = [
      "instagram",
      "facebook",
      "x",
      "reddit"
    ];

    const trend = null;

    const results = [];

    for (const platform of platforms) {
      console.log("\n======================================");
      console.log(`📱 Processing ${platform.toUpperCase()}`);
      console.log("======================================");

      try {
        // Load platform guidelines
        const guidelines = getGuidelines(platform);
        console.log("✅ Guidelines Loaded");

        // Build prompt
        const prompt = buildPrompt(
          brand,
          guidelines,
          trend,
          platform
        );

        console.log("🧠 Prompt Built");

        // Generate content
        const content = normalizeContent(await generateContent(prompt));

        console.log("🤖 Content Generated");

        // Validate
        const validation = validateContent(
          content,
          guidelines
        );

        if (!validation.passed) {
          console.log("❌ Validation Failed");

          results.push({
            platform,
            status: "Validation Failed",
            errors: validation.errors
          });

          continue;
        }

        console.log("✅ Validation Passed");

        // Platform-policy + LLM moderation gate.
        const safety = await validatePostSafety({
          content,
          brand,
          platform,
          validationFlags: guidelines.validation || {}
        });

        if (!safety.ok) {
          console.log(`❌ Safety Rejected (${safety.status})`);

          results.push({
            platform,
            status: "Safety Rejected",
            reason: safety.status,
            errors: safety.errors
          });

          continue;
        }

        console.log("🛡️  Safety Verified");

        // Save JSON
        const file = saveReview(
          brand,
          platform,
          content,
          validation
        );

        console.log(`📁 Review Saved`);

        results.push({
          platform,
          status: "Success",
          file
        });

      } catch (err) {
        console.error(`❌ ${platform} failed`);
        console.error(err.message);

        results.push({
          platform,
          status: "Failed",
          error: err.message
        });
      }
    }

    console.log("\n======================================");
    console.log("📊 FINAL SUMMARY");
    console.log("======================================");

    for (const result of results) {
      if (result.status === "Success") {
        console.log(`✅ ${result.platform} → ${result.file}`);
      } else {
        console.log(`❌ ${result.platform} → ${result.status}`);
      }
    }

    console.log("\n🎉 Social Media Factory Completed!\n");

  } catch (err) {
    console.error(err);
  }
}

main();