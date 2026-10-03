// API client. When the local server is not reachable (e.g. the app is hosted by any static server) the app falls
// back to static files and runs read-only: valuations and the trade calculator still work from the cached dataset.

import { DATASET_SCHEMA_VERSION } from '../core/version.js';

let serverAvailable = null;

async function req(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.detail = data && data.detail;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b || {}),
  put: (p, b) => req('PUT', p, b || {}),
  del: (p) => req('DELETE', p),
};

export async function detectServer() {
  try { const h = await api.get('/api/health'); serverAvailable = Boolean(h && h.ok); } catch { serverAvailable = false; }
  return serverAvailable;
}
export const hasServer = () => serverAvailable === true;

async function staticJSON(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadConfig() {
  if (hasServer()) return api.get('/api/config');
  const [sources, model, leagueDefaults, profiles, importSpecs] = await Promise.all(['sources', 'model', 'league-defaults', 'profiles', 'import-specs'].map((f) => staticJSON(`config/${f}.json`)));
  const calibration = {};
  for (const f of ['aging-curves', 'attrition', 'availability', 'draft-priors', 'rookie-slot-curve', 'year-over-year']) {
    try { calibration[f.replace(/-/g, '_')] = await staticJSON(`config/calibration/${f}.json`); } catch { /* optional */ }
  }
  return { sources, model, leagueDefaults, profiles, importSpecs, calibration };
}

export async function loadDataset() {
  let ds;
  try {
    ds = hasServer() ? await api.get('/api/dataset') : await staticJSON('data/calculated/dataset.json');
  } catch (e) {
    if (e.status === 404 || /404/.test(e.message)) return null;
    throw e;
  }
  // Static hosting (no server to rebuild): refuse data in another format instead of misreading it (BUG_AUDIT 2, R7).
  if (ds && ds.schema_version !== DATASET_SCHEMA_VERSION) throw new Error(`the cached data uses format ${ds.schema_version}, this version reads ${DATASET_SCHEMA_VERSION} — start the app and run Sync All`);
  return ds;
}
