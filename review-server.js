import http from 'node:http';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_DIR = path.join(__dirname, 'review');
const APPROVED_DIR = path.join(__dirname, 'approved');
const PUBLISHED_DIR = path.join(__dirname, 'published');
const FAILED_DIR = path.join(__dirname, 'failed');
const BRANDS_PATH = path.join(__dirname, 'data', 'brands.json');
const HTML_PATH = path.join(__dirname, 'review.html');
const PORT = Number(process.env.PORT) || 5174;

const PLATFORMS = ['instagram', 'facebook', 'x', 'reddit'];

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

const generateOne = async (brand, platform, trend = null) => {
  const guidelines = getGuidelines(platform);
  const prompt = buildPrompt(brand, guidelines, trend, platform);
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
  const filePath = saveReview(brand, platform, content, validation);
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

const regenerate = async (file) => {
  if (!isSafeName(file)) throw new Error('Invalid file name');
  const parsed = parseFileName(file);
  if (!parsed) throw new Error(`Cannot parse slug/platform from "${file}"`);
  const { slug, platform } = parsed;
  if (!isSafeSlug(slug)) throw new Error('Invalid brand slug');

  const brand = getBrand(slug);
  const result = await generateOne(brand, platform);

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

server.listen(PORT, () => {
  console.log(`Review UI running at http://localhost:${PORT}`);
});
