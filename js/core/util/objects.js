// Object helpers: deep merge/clone and a stable hash for settings/data versioning.

export function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export function deepClone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

/** Deep-merge b into a copy of a. Arrays are replaced, not concatenated. Keys starting with '_' (comments) are kept. */
export function deepMerge(a, b) {
  if (!isPlainObject(a)) return deepClone(b);
  const out = deepClone(a);
  if (!isPlainObject(b)) return out;
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : deepClone(v);
  }
  return out;
}

export function stableStringify(x) {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (isPlainObject(x)) {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

/** FNV-1a 32-bit hash → 8 hex chars. Deterministic across browser and Node. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function stableHash(obj) {
  return hashString(stableStringify(obj));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
