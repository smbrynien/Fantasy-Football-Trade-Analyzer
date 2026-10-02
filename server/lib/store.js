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

export async function writeFileAtomic(file, data) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export async function writeJSON(file, obj, { pretty = false } = {}) {
  await writeFileAtomic(file, JSON.stringify(obj, null, pretty ? 2 : 0));
}

export async function readJSON(file, fallback = null) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Failed to read ${file}: ${e.message}`);
  }
}

export function readJSONSync(file, fallback = null) {
  try { return JSON.parse(fss.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}

export async function writeGzJSON(file, obj) {
  await writeFileAtomic(file, await gzip(Buffer.from(JSON.stringify(obj))));
}

export async function readGzJSON(file, fallback = null) {
  try { return JSON.parse((await gunzip(await fs.readFile(file))).toString('utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
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
