import http from 'node:http';
import { exec } from 'node:child_process';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBrand } from './agent/readBrand.js';
import { getGuidelines } from './agent/readGuidelines.js';
import { buildPrompt } from './agent/promptBuilder.js';
import { generateContent } from './services/grok.js';
import { normalizeContent } from './agent/normalizeContent.js';
import { validateContent } from './agent/validator.js';
import { saveReview } from './agent/saveReview.js';
import { validateBrandSafety } from './agent/brand-safety-validator/brandSafetyValidator.js';
import { validatePostSafety } from './agent/brand-safety-validator/postSafetyValidator.js';
import { suggestTodayBatch } from './agent/todayReview.js';
import { fetchVideoBrands, fetchBrandVideos, getVideoBrand } from './services/videoApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = path.join(__dirname, 'review');
const APPROVED_DIR = path.join(__dirname, 'approved');
const PUBLISHED_DIR = path.join(__dirname, 'published');
const FAILED_DIR = path.join(__dirname, 'failed');
const BRANDS_PATH = path.join(__dirname, 'data', 'brands.json');
const HTML_PATH = path.join(__dirname, 'review.html');
const PORT = Number(process.env.PORT) || 5174;

const PLATFORMS = ['instagram', 'facebook', 'x', 'reddit'];
const VIDEO_PLATFORMS = ['instagram', 'facebook', 'x'];

const isSafeName = (name) => typeof name === 'string' && /^[A-Za-z0-9._-]+\.json$/.test(name);
const isSafeSlug = (slug) => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug);

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const listFolder = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
  const items = await Promise.all(
    files.map(async (f) => {
      const full = path.join(dir, f.name);
      const raw = await readFile(full, 'utf8');
      try {
        return { file: f.name, data: JSON.parse(raw) };
      } catch {
        return { file: f.name, data: null, error: 'Invalid JSON' };
      }
    })
  );
  items.sort((a, b) => a.file.localeCompare(b.file));
  return items;
};

const listFileNames = async (dir) => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name);
  } catch {
    return [];
  }
};

const approve = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const src = path.join(REVIEW_DIR, file);
  const dest = path.join(APPROVED_DIR, file);
  const raw = await readFile(src, 'utf8');
  const data = JSON.parse(raw);
  data.status = 'approved';
  data.approved_at = new Date().toISOString();
  await writeFile(dest, JSON.stringify(data, null, 2), 'utf8');
  await unlink(src);
  return { file, moved_to: path.relative(__dirname, dest) };
};

const remove = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const src = path.join(REVIEW_DIR, file);
  await unlink(src);
  return { file, deleted_from: path.relative(__dirname, src) };
};

const unapprove = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const src = path.join(APPROVED_DIR, file);
  const dest = path.join(REVIEW_DIR, file);
  const raw = await readFile(src, 'utf8');
  const data = JSON.parse(raw);
  data.status = 'review';
  delete data.approved_at;
  data.returned_to_review_at = new Date().toISOString();
  await writeFile(dest, JSON.stringify(data, null, 2), 'utf8');
  await unlink(src);
  return { file, moved_to: path.relative(__dirname, dest) };
};

const unfail = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const src = path.join(FAILED_DIR, file);
  const dest = path.join(REVIEW_DIR, file);
  const raw = await readFile(src, 'utf8');
  const data = JSON.parse(raw);
  data.status = 'review';
  delete data.failed_at;
  delete data.publish_error;
  data.returned_to_review_at = new Date().toISOString();
  await writeFile(dest, JSON.stringify(data, null, 2), 'utf8');
  await unlink(src);
  return { file, moved_to: path.relative(__dirname, dest) };
};

const listBrands = async () => {
  const raw = await readFile(BRANDS_PATH, 'utf8');
  const data = JSON.parse(raw);
  const brands = Array.isArray(data) ? data : data.brands ?? [];
  return brands.map((b) => ({
    slug: b.slug,
    name: b.name,
    profile_image_url: b.profile_image_url ?? null,
    isSFW: b.isSFW === true,
  }));
};

// Parse "<slug>-<platform>-<timestamp>.json" back into slug + platform.
// Slugs contain hyphens themselves, so we anchor on the platform token.
const parseFileName = (name) => {
  for (const platform of PLATFORMS) {
    const marker = `-${platform}-`;
    const idx = name.indexOf(marker);
    if (idx > 0 && name.endsWith('.json')) {
      return { slug: name.slice(0, idx), platform };
    }
  }
  return null;
};

const buildSummary = async () => {
  const [review, approved, published, failed] = await Promise.all([
    listFileNames(REVIEW_DIR),
    listFileNames(APPROVED_DIR),
    listFileNames(PUBLISHED_DIR),
    listFileNames(FAILED_DIR),
  ]);

  // shape: { [slug]: { [platform]: { review, approved, published, failed } } }
  const summary = {};
  const bump = (files, key) => {
    for (const name of files) {
      const parsed = parseFileName(name);
      if (!parsed) continue;
      const { slug, platform } = parsed;
      summary[slug] ??= {};
      summary[slug][platform] ??= { review: 0, approved: 0, published: 0, failed: 0 };
      summary[slug][platform][key] += 1;
    }
  };
  bump(review, 'review');
  bump(approved, 'approved');
  bump(published, 'published');
  bump(failed, 'failed');
  return summary;
};

// Collect every hashtag this brand has already used across the whole pipeline
// (review/approved/published/failed), so new generations avoid repeating them.
const getUsedHashtags = async (slug) => {
  const dirs = [REVIEW_DIR, APPROVED_DIR, PUBLISHED_DIR, FAILED_DIR];
  const seen = new Map(); // lowercase -> original casing
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue;
      try {
        const data = JSON.parse(await readFile(path.join(dir, e.name), 'utf8'));
        if (data?.brand?.slug !== slug) continue;
        for (const tag of data?.content?.hashtags ?? []) {
          if (typeof tag === 'string' && tag.trim()) {
            seen.set(tag.toLowerCase(), tag);
          }
        }
      } catch {
        // Unreadable file — skip; the avoid-list is best-effort.
      }
    }
  }
  // Cap the list so the prompt stays lean even for prolific brands.
  return [...seen.values()].slice(-50);
};

const generateOne = async (brand, platform, trend = null, saveOptions = {}) => {
  const guidelines = getGuidelines(platform);
  const avoidHashtags = await getUsedHashtags(brand.slug);
  const prompt = buildPrompt(brand, guidelines, trend, platform, avoidHashtags);
  const content = normalizeContent(await generateContent(prompt));
  const validation = validateContent(content, guidelines);
  if (!validation.passed) {
    return { platform, status: 'validation_failed', errors: validation.errors };
  }
  const safety = await validatePostSafety({
    content,
    brand,
    platform,
    validationFlags: guidelines.validation || {},
  });
  if (!safety.ok) {
    return {
      platform,
      status: 'safety_rejected',
      reason: safety.status,
      errors: safety.errors,
    };
  }
  const filePath = saveReview(brand, platform, content, validation, saveOptions);
  const file = path.basename(filePath);
  const raw = await readFile(filePath, 'utf8');
  return { platform, status: 'success', file, data: JSON.parse(raw) };
};

const runGenerate = async ({ slug, platforms }) => {
  if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');
  const brand = getBrand(slug);
  const selected = Array.isArray(platforms) && platforms.length ? platforms : PLATFORMS;
  const targets = selected.filter((p) => PLATFORMS.includes(p));
  if (!targets.length) throw new Error('No valid platforms selected');

  const results = [];
  for (const platform of targets) {
    try {
      results.push(await generateOne(brand, platform));
    } catch (err) {
      results.push({ platform, status: 'failed', error: err.message });
    }
  }
  return { brand: { slug: brand.slug, name: brand.name }, results };
};

// Human verification for videos (Option A gate).
// data/video-sfw.json maps video file_url ->
//   { sfw, apparent_age_verified, method, verified_at }.
// A video may only be used for generation after a human watched it fully and
// attested BOTH that it is not explicit (sfw) AND that the person clearly
// appears to be an adult (apparent_age_verified) — two separate questions,
// both required. These personas are generated, so apparent age is a generator
// output that must be checked per video, not assumed.
const VIDEO_SFW_PATH = path.join(__dirname, 'data', 'video-sfw.json');

const loadVideoSfw = async () => {
  try {
    return JSON.parse(await readFile(VIDEO_SFW_PATH, 'utf8'));
  } catch {
    return {};
  }
};

const saveVideoSfw = (store) =>
  writeFile(VIDEO_SFW_PATH, JSON.stringify(store, null, 2), 'utf8');

// Which pipeline stage "wins" when the same video appears in multiple posts.
const USED_VIDEO_PRIORITY = { published: 3, approved: 2, review: 1, failed: 0 };

// Scan all pipeline folders and map every already-used video URL to its most
// relevant status (published > approved > review > failed).
const getUsedVideoUrls = async () => {
  const dirs = [
    [PUBLISHED_DIR, 'published'],
    [APPROVED_DIR, 'approved'],
    [REVIEW_DIR, 'review'],
    [FAILED_DIR, 'failed'],
  ];
  const used = new Map();
  for (const [dir, status] of dirs) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // Only video post files carry a video URL; their names contain "-video-".
      if (!e.isFile() || !e.name.endsWith('.json') || !e.name.includes('-video-')) continue;
      try {
        const data = JSON.parse(await readFile(path.join(dir, e.name), 'utf8'));
        const url = data?.assets?.video_url;
        if (!url) continue;
        const prev = used.get(url);
        if (!prev || USED_VIDEO_PRIORITY[status] > USED_VIDEO_PRIORITY[prev]) {
          used.set(url, status);
        }
      } catch {
        // Unreadable file — skip; badges are best-effort.
      }
    }
  }
  return used;
};

// Video posts: brand persona comes from the gallery API (NOT brands.json),
// and every platform gets its own distinct video.
const runGenerateVideo = async ({ slug, assignments }) => {
  if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');
  if (!Array.isArray(assignments) || !assignments.length) {
    throw new Error('No platform/video assignments provided');
  }

  const targets = assignments.filter(
    (a) =>
      a &&
      VIDEO_PLATFORMS.includes(a.platform) &&
      a.video &&
      /^https?:\/\//.test(a.video.file_url || '')
  );
  if (!targets.length) throw new Error('No valid platform/video assignments');

  const platformSet = new Set(targets.map((a) => a.platform));
  if (platformSet.size !== targets.length) {
    throw new Error('Each platform may only appear once');
  }
  const videoSet = new Set(targets.map((a) => a.video.file_url));
  if (videoSet.size !== targets.length) {
    throw new Error('Each platform must get a different video');
  }

  // Option A safety gate: every video must be human-verified (not explicit
  // AND person clearly appears adult). Enforced server-side so the UI can't
  // be bypassed.
  const sfwStore = await loadVideoSfw();
  for (const { video } of targets) {
    const v = sfwStore[video.file_url];
    if (v?.sfw !== true || v?.apparent_age_verified !== true) {
      throw new Error(
        `Video not human-verified (SFW + adult appearance): "${video.title ?? video.file_url}". Watch it fully and verify it in the Video Playground first.`
      );
    }
  }

  const brand = await getVideoBrand(slug);

  const results = [];
  for (const { platform, video } of targets) {
    try {
      results.push(
        await generateOne(brand, platform, null, {
          isVideo: true,
          video: {
            slug: video.slug ?? null,
            title: video.title ?? null,
            file_url: video.file_url,
            verification: sfwStore[video.file_url],
          },
        })
      );
    } catch (err) {
      results.push({ platform, status: 'failed', error: err.message });
    }
  }
  return { brand: { slug: brand.slug, name: brand.name }, results };
};

const regenerate = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const parsed = parseFileName(file);
  if (!parsed) throw new Error(`Cannot parse slug/platform from "${file}"`);
  const { slug, platform } = parsed;
  if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');

  // Video posts keep their video and use the gallery-API persona;
  // image posts keep using brands.json.
  const existing = JSON.parse(await readFile(path.join(REVIEW_DIR, file), 'utf8'));
  let brand;
  let saveOptions = {};
  if (existing.isVideo) {
    // Same gate as generation — the video must be human-verified on both counts.
    const sfwStore = await loadVideoSfw();
    const videoUrl = existing.assets?.video_url;
    const v = sfwStore[videoUrl];
    if (v?.sfw !== true || v?.apparent_age_verified !== true) {
      throw new Error(
        'Video not human-verified (SFW + adult appearance) — watch it fully and verify it in the Video Playground first.'
      );
    }
    brand = await getVideoBrand(slug);
    saveOptions = {
      isVideo: true,
      video: {
        title: existing.assets?.video_title ?? null,
        file_url: videoUrl,
        verification: sfwStore[videoUrl],
      },
    };
  } else {
    brand = getBrand(slug);
  }
  const result = await generateOne(brand, platform, null, saveOptions);

  // Only delete the old file if the new one was written successfully.
  if (result.status === 'success') {
    try {
      await unlink(path.join(REVIEW_DIR, file));
    } catch {
      // Old file already gone — non-fatal.
    }
  }
  return { previous: file, ...result };
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/review.html')) {
      const html = await readFile(HTML_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/review') {
      return sendJson(res, 200, { items: await listFolder(REVIEW_DIR) });
    }

    if (req.method === 'GET' && url.pathname === '/api/approved') {
      return sendJson(res, 200, { items: await listFolder(APPROVED_DIR) });
    }

    if (req.method === 'GET' && url.pathname === '/api/published') {
      return sendJson(res, 200, { items: await listFolder(PUBLISHED_DIR) });
    }

    if (req.method === 'GET' && url.pathname === '/api/failed') {
      return sendJson(res, 200, { items: await listFolder(FAILED_DIR) });
    }

    if (req.method === 'GET' && url.pathname === '/api/brands') {
      return sendJson(res, 200, { brands: await listBrands(), platforms: PLATFORMS });
    }

    if (req.method === 'GET' && url.pathname === '/api/video-brands') {
      const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
      const result = await fetchVideoBrands(page);
      return sendJson(res, 200, { ...result, platforms: VIDEO_PLATFORMS });
    }

    if (req.method === 'GET' && url.pathname === '/api/brand-videos') {
      const slug = url.searchParams.get('slug');
      if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');
      const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
      const [result, used, sfwStore] = await Promise.all([
        fetchBrandVideos(slug, page),
        getUsedVideoUrls(),
        loadVideoSfw(),
      ]);
      result.videos = result.videos.map((v) => ({
        ...v,
        used: used.get(v.file_url) ?? null,
        verified:
          sfwStore[v.file_url]?.sfw === true &&
          sfwStore[v.file_url]?.apparent_age_verified === true,
      }));
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/video-sfw') {
      const body = await readBody(req);
      const fileUrl = body.file_url;
      if (typeof fileUrl !== 'string' || !/^https?:\/\//.test(fileUrl)) {
        throw new Error('Invalid video URL');
      }
      const store = await loadVideoSfw();
      // Verification requires BOTH attestations explicitly; anything less unverifies.
      const verifying = body.sfw === true && body.apparent_age_verified === true;
      if (verifying) {
        store[fileUrl] = {
          sfw: true,
          apparent_age_verified: true,
          method: 'human',
          verified_at: new Date().toISOString(),
        };
      } else {
        delete store[fileUrl];
      }
      await saveVideoSfw(store);
      return sendJson(res, 200, { ok: true, file_url: fileUrl, verified: verifying });
    }

    if (req.method === 'POST' && url.pathname === '/api/generate-video') {
      const body = await readBody(req);
      const result = await runGenerateVideo({ slug: body.slug, assignments: body.assignments });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      return sendJson(res, 200, { summary: await buildSummary() });
    }

    if (req.method === 'POST' && url.pathname === '/api/approve') {
      const body = await readBody(req);
      const result = await approve(body.file);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/unapprove') {
      const body = await readBody(req);
      const result = await unapprove(body.file);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/unfail') {
      const body = await readBody(req);
      const result = await unfail(body.file);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/delete') {
      const body = await readBody(req);
      const result = await remove(body.file);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const body = await readBody(req);
      const result = await runGenerate({ slug: body.slug, platforms: body.platforms });
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'POST' && url.pathname === '/api/regenerate') {
      const body = await readBody(req);
      const result = await regenerate(body.file);
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === 'GET' && url.pathname === '/api/today-review') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event) => { res.write(`data: ${JSON.stringify(event)}\n\n`); };
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

      try {
        await suggestTodayBatch(send);
      } catch (err) {
        send({ step: 'done', error: err.message });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/validate-safety') {
      const slug = url.searchParams.get('slug');
      if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');

      // Images the user already saw and skipped — a re-run advances past them.
      const excludeImageUrls = url.searchParams
        .getAll('exclude')
        .filter((u) => /^https?:\/\//.test(u))
        .slice(0, 20);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

      try {
        await validateBrandSafety(slug, send, { excludeImageUrls });
      } catch (err) {
        send({ step: 'done', ok: false, status: 'error', error: err.message });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

// Best-effort: open the review UI in the default browser on startup.
const openBrowser = (url) => {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
};

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Review UI running at ${url}`);
  openBrowser(url);
});
