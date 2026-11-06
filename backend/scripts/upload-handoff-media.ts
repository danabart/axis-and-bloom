// upload-handoff-media — Camila's handoff photos and video into the asset bucket.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_MEDIA_UPLOAD.md
//
// Reads MEDIA_MAP.json (source → target rows; sources relative to the handoff's
// source/ folder) and compares each row with gs://<bucket>/<target>.
//
//   npx tsx scripts/upload-handoff-media.ts                 dry run (default): the table, nothing written
//   npx tsx scripts/upload-handoff-media.ts --write         uploads `missing` rows; `same` skipped; `different` refused
//   npx tsx scripts/upload-handoff-media.ts --write --replace   also overwrites `different` rows
//   npx tsx scripts/upload-handoff-media.ts --verify        waits for the optimizer's WebP pair (images), checks raw
//                                                           objects (video, raw-served files), fetches every public URL
//   --map <path>                                            another map (default: the website_handoff MEDIA_MAP.json)
//
// Rules (the brief's decisions): a target is never renamed or moved; nothing in the
// bucket is ever deleted; an existing object is overwritten only when its content
// differs AND --replace is given. Uploads carry the registry's contentType and
// cacheControl `public, max-age=300` (frontend/src/design/CLAUDE.md). The optimizer
// Cloud Function (cloud-functions/image-optimizer) turns raw/<p>.<ext> into
// optimized/<p>.webp + optimized/<p>-mobile.webp for everything but .svg/.mp4.
//
// Credentials: the gitignored serviceAccountKey.json at the repo root (the Firebase
// Admin SDK account), through firebase-admin's storage client. The key is read into
// memory (the file is saved with a UTF-8 byte-order mark, which the storage
// library's own keyFilename reader rejects) and handed to the client as a
// credential object; nothing about it is ever printed, only the account's email. No database is touched (G3.7: nothing to name).
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DEFAULT_MAP = path.join(REPO, 'backend', 'src', 'features', 'website_handoff', 'MEDIA_MAP.json');
const SOURCE_ROOT = path.join(REPO, 'misc', 'design_documents', 'website', 'axis-and-bloom-handoff', 'source');
const KEY_PATH = path.join(REPO, 'serviceAccountKey.json');
const CACHE_CONTROL = 'public, max-age=300';
const PASS_THROUGH = ['.svg', '.mp4']; // the optimizer skips these (cloud-functions/image-optimizer/index.js)
const VERIFY_TIMEOUT_MS = 3 * 60 * 1000;
const VERIFY_POLL_MS = 10 * 1000;
const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
};

interface Row { source: string; target: string; brief?: number | string }
interface MediaMap { bucket: string; rows: Row[] }
type State = 'missing' | 'same' | 'different';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const mapPath = (() => { const i = args.indexOf('--map'); return i >= 0 ? path.resolve(args[i + 1]) : DEFAULT_MAP; })();
const mode: 'dry-run' | 'write' | 'verify' = flag('--verify') ? 'verify' : flag('--write') ? 'write' : 'dry-run';
const replace = flag('--replace');

function md5Base64(buf: Buffer) { return createHash('md5').update(buf).digest('base64'); }
function hexOf(b64: string) { return Buffer.from(b64, 'base64').toString('hex'); }
function kb(n: number) { return `${(n / 1024).toFixed(0)} KB`; }
function table(headers: string[], rows: string[][]) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(w[i])).join('  ');
  console.log(line(headers));
  console.log(w.map(n => '-'.repeat(n)).join('  '));
  rows.forEach(r => console.log(line(r)));
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** JSON from disk without a leading byte-order mark (serviceAccountKey.json is saved with one). */
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')) as T;

function loadMap(): MediaMap {
  const m = readJson<MediaMap>(mapPath);
  if (!m.bucket || !Array.isArray(m.rows)) throw new Error(`${mapPath}: needs "bucket" and "rows"`);
  for (const r of m.rows) {
    if (!r.target.startsWith('raw/')) throw new Error(`target must live under raw/: ${r.target}`);
    if (!CONTENT_TYPES[path.extname(r.target).toLowerCase()]) throw new Error(`no content type for ${r.target}`);
  }
  return m;
}

function bucketFor(name: string) {
  const key = readJson<{ project_id: string; client_email: string; private_key: string }>(KEY_PATH);
  const app = initializeApp({
    credential: cert({ projectId: key.project_id, clientEmail: key.client_email, privateKey: key.private_key }),
    storageBucket: name,
  }, 'upload-handoff-media');
  console.log(`account: ${key.client_email} · bucket: gs://${name} · map: ${path.relative(REPO, mapPath)} · mode: ${mode}${replace ? ' (--replace)' : ''}\n`);
  return { bucket: getStorage(app).bucket(name), app };
}

async function stateOf(bucket: ReturnType<typeof bucketFor>['bucket'], target: string, md5: string): Promise<{ state: State; remoteMd5: string | null }> {
  const file = bucket.file(target);
  const [exists] = await file.exists();
  if (!exists) return { state: 'missing', remoteMd5: null };
  const [meta] = await file.getMetadata();
  const remote = (meta.md5Hash as string | undefined) ?? null;
  return { state: remote === md5 ? 'same' : 'different', remoteMd5: remote };
}

async function plan(bucket: ReturnType<typeof bucketFor>['bucket'], m: MediaMap) {
  const out = [];
  for (const r of m.rows) {
    const abs = path.join(SOURCE_ROOT, r.source);
    const buf = readFileSync(abs);
    const md5 = md5Base64(buf);
    const { state } = await stateOf(bucket, r.target, md5);
    const action = state === 'missing' ? 'upload' : state === 'same' ? 'skip (same)' : replace ? 'replace' : 'refuse (different; --replace)';
    out.push({ row: r, abs, buf, md5, size: statSync(abs).size, state, action });
  }
  return out;
}

async function main() {
  const m = loadMap();
  const { bucket, app } = bucketFor(m.bucket);
  let failed = false;
  try {
    if (mode !== 'verify') {
      const p = await plan(bucket, m);
      table(['#', 'source', 'size', 'md5', 'target', 'bucket', 'action'],
        p.map((x, i) => [String(i + 1), x.row.source, kb(x.size), hexOf(x.md5).slice(0, 10), x.row.target, x.state, x.action]));
      const counts = p.reduce((a, x) => ({ ...a, [x.state]: (a[x.state] ?? 0) + 1 }), {} as Record<string, number>);
      console.log(`\n${p.length} rows: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      if (mode === 'dry-run') { console.log('dry run: nothing written. Re-run with --write after the go.'); return; }

      const results: string[][] = [];
      for (const x of p) {
        if (x.state === 'same') { results.push([x.row.target, 'skipped (same)']); continue; }
        if (x.state === 'different' && !replace) { results.push([x.row.target, 'REFUSED (different)']); failed = true; continue; }
        const contentType = CONTENT_TYPES[path.extname(x.row.target).toLowerCase()];
        await bucket.file(x.row.target).save(x.buf, {
          resumable: false, validation: 'md5',
          metadata: { contentType, cacheControl: CACHE_CONTROL, md5Hash: x.md5 },
        });
        const after = await stateOf(bucket, x.row.target, x.md5);
        results.push([x.row.target, after.state === 'same' ? `uploaded (${contentType})` : `UPLOAD CHECK FAILED (${after.state})`]);
        if (after.state !== 'same') failed = true;
      }
      console.log('');
      table(['target', 'result'], results);
      return;
    }

    // --verify
    const start = Date.now();
    const imageRows = m.rows.filter(r => !PASS_THROUGH.includes(path.extname(r.target).toLowerCase()));
    const pending = new Set(imageRows.map(r => r.target));
    const rawTime = new Map<string, number>();
    for (const r of m.rows) {
      const [exists] = await bucket.file(r.target).exists();
      if (exists) { const [meta] = await bucket.file(r.target).getMetadata(); rawTime.set(r.target, Date.parse(meta.updated as string)); }
    }
    const optimizedOf = (target: string) => {
      const rel = target.slice('raw/'.length); const ext = path.extname(rel);
      const base = rel.slice(0, -ext.length);
      return [`optimized/${base}.webp`, `optimized/${base}-mobile.webp`];
    };
    while (pending.size && Date.now() - start < VERIFY_TIMEOUT_MS) {
      for (const t of [...pending]) {
        const ok = await Promise.all(optimizedOf(t).map(async o => {
          const [e] = await bucket.file(o).exists();
          if (!e) return false;
          const [meta] = await bucket.file(o).getMetadata();
          return Date.parse(meta.updated as string) >= (rawTime.get(t) ?? 0); // written from this raw object, not an older one
        }));
        if (ok.every(Boolean)) pending.delete(t);
      }
      if (pending.size) await sleep(VERIFY_POLL_MS);
    }
    const base = `https://storage.googleapis.com/${m.bucket}`;
    const rows: string[][] = [];
    for (const r of m.rows) {
      const isImage = !PASS_THROUGH.includes(path.extname(r.target).toLowerCase());
      const urls = [r.target, ...(isImage ? optimizedOf(r.target) : [])];
      for (const u of urls) {
        const res = await fetch(`${base}/${encodeURI(u)}`, { method: 'HEAD' });
        const type = res.headers.get('content-type') ?? '';
        const cache = res.headers.get('cache-control') ?? '';
        const ok = res.status === 200 && (!u.startsWith('optimized/') || !pending.has(r.target));
        if (!ok) failed = true;
        rows.push([u, String(res.status), type, cache, ok ? 'ok' : 'MISSING']);
      }
    }
    table(['object', 'http', 'content-type', 'cache-control', 'verify'], rows);
    console.log(`\n${rows.filter(r => r[4] === 'ok').length}/${rows.length} ok${pending.size ? ` · optimizer did not finish within 3 min for: ${[...pending].join(', ')}` : ''}`);
  } finally {
    await deleteApp(app);
    if (failed) process.exitCode = 1;
  }
}

main().catch(err => { console.error('[upload-handoff-media]', err instanceof Error ? err.message : err); process.exit(1); });
