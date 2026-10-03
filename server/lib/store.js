// Small JSON/gzip persistence helpers with atomic writes (write temp file, then rename).
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

let tmpCounter = 0;
export async function writeFileAtomic(file, data) {
  await ensureDir(path.dirname(file));
  // Unique per write: pid + Date.now() alone collided when the same file was written twice in one millisecond
  // (concurrent rebuilds), so one rename failed with ENOENT.
  const tmp = `${file}.${process.pid}.${Date.now()}.${++tmpCounter}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Serialize read-modify-write updates of one file inside this process. Saving two trades at the same time used to
 * read the same list twice and write it twice, so one of the saves vanished (20 parallel saves kept 3 — BUG_AUDIT 2,
 * R1). `update(current) → next` runs only after every earlier update of the same file has been written.
 */
const fileLocks = new Map();
export function updateJSON(file, fallback, update, opts) {
  const prev = fileLocks.get(file) || Promise.resolve();
  const run = prev.then(async () => {
    const next = await update(await readJSON(file, structuredClone(fallback)));
    await writeJSON(file, next, opts);
    return next;
  });
  const settled = run.catch(() => {});
  fileLocks.set(file, settled);
  settled.then(() => { if (fileLocks.get(file) === settled) fileLocks.delete(file); });
  return run;
}

export async function writeJSON(file, obj, { pretty = false } = {}) {
  await writeFileAtomic(file, JSON.stringify(obj, null, pretty ? 2 : 0));
}

/** Files that were unreadable (corrupt JSON/gzip) and were moved aside; reported by /api/status. */
export const recoveredFiles = [];

/**
 * A corrupt file used to make every caller throw forever (one bad sources-status.json → /api/status 500 and no sync
 * could ever run again). It is now moved aside to `<file>.corrupt-<time>` — the bytes are kept for inspection, never
 * deleted — the caller gets its fallback, and the event is recorded.
 */
async function setAsideCorrupt(file, err) {
  const movedTo = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await fs.rename(file, movedTo).catch(() => {});
  recoveredFiles.push({ file, moved_to: movedTo, error: String(err.message || err).slice(0, 200), at: new Date().toISOString() });
  if (recoveredFiles.length > 50) recoveredFiles.shift();
  console.warn(`  Warning: ${path.basename(file)} was unreadable (${err.message}); moved to ${path.basename(movedTo)} and continuing without it.`);
}

export async function readJSON(file, fallback = null) {
  let txt;
  try {
    txt = await fs.readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Failed to read ${file}: ${e.message}`);
  }
  try {
    return JSON.parse(txt);
  } catch (e) {
    await setAsideCorrupt(file, e);
    return fallback;
  }
}

export function readJSONSync(file, fallback = null) {
  let txt;
  try { txt = fss.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  // Name the file: a typo in config/model.json used to surface as a bare "Unexpected token" (BUG_AUDIT 2, R6).
  try { return JSON.parse(txt); } catch (e) { throw new Error(`${path.basename(path.dirname(file))}/${path.basename(file)} is not valid JSON (${e.message}). Fix or restore the file.`); }
}

export async function writeGzJSON(file, obj) {
  await writeFileAtomic(file, await gzip(Buffer.from(JSON.stringify(obj))));
}

export async function readGzJSON(file, fallback = null) {
  let buf;
  try { buf = await fs.readFile(file); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  try { return JSON.parse((await gunzip(buf)).toString('utf8')); } catch (e) { await setAsideCorrupt(file, e); return fallback; }
}

export async function writeGz(file, buf) {
  await writeFileAtomic(file, await gzip(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)));
}

export async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

/** Keep only the newest `keep` files in a directory matching a filter. */
export async function pruneDir(dir, keep, filter = () => true) {
  let names;
  try { names = (await fs.readdir(dir)).filter(filter).sort(); } catch { return; }
  const excess = names.length - keep;
  for (let i = 0; i < excess; i++) await fs.rm(path.join(dir, names[i]), { force: true, recursive: true });
}
