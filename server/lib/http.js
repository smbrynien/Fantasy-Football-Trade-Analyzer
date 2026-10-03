// HTTP client for adapters: timeouts, limited retries with backoff, per-host politeness delay, byte accounting.
// Uses Node's built-in fetch (Node >= 18). Never retries 4xx except 408/429.

const lastHit = new Map();
const MIN_HOST_INTERVAL_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, { status, url, body } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function createHttp({ userAgent, timeoutMs = 45000, retries = 2, onRequest } = {}) {
  const ua = userAgent || process.env.FFTA_USER_AGENT || 'FantasyFootballTradeAnalyzer/1.0 (personal use)';
  // A negative/tiny/garbage FFTA_FETCH_TIMEOUT_MS made every request time out at once (BUG_AUDIT 2, R5): ≥ 1 s or default.
  const envTo = Number(process.env.FFTA_FETCH_TIMEOUT_MS);
  const to = Number.isFinite(envTo) && envTo >= 1000 ? envTo : timeoutMs;
  let bytes = 0, requests = 0;

  async function request(url, { as = 'json', headers = {}, retry = retries } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      const wait = (lastHit.get(host) || 0) + MIN_HOST_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastHit.set(host, Date.now());
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), to);
      try {
        requests++;
        onRequest && onRequest(url);
        const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: as === 'json' ? 'application/json' : '*/*', ...headers }, signal: ctrl.signal, redirect: 'follow' });
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 300);
          const err = new HttpError(`HTTP ${res.status} ${res.statusText} for ${url}`, { status: res.status, url, body });
          if ((res.status >= 500 || res.status === 408 || res.status === 429) && attempt < retry) { await sleep(1000 * 2 ** attempt); continue; }
          throw err;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        bytes += buf.length;
        if (as === 'buffer') return buf;
        const text = buf.toString('utf8');
        if (as === 'text') return text;
        try { return JSON.parse(text); } catch (e) { throw new HttpError(`Invalid JSON from ${url}: ${e.message}`, { url, body: text.slice(0, 200) }); }
      } catch (e) {
        const transient = e.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(String(e.message) + String(e.cause?.code || ''));
        if (transient && attempt < retry) { await sleep(1000 * 2 ** attempt); continue; }
        if (e.name === 'AbortError') throw new HttpError(`Timed out after ${to} ms: ${url}`, { url });
        if (e instanceof HttpError) throw e;
        throw new HttpError(`Network error for ${url}: ${e.cause?.code || e.message}`, { url });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return {
    json: (url, o) => request(url, { ...o, as: 'json' }),
    text: (url, o) => request(url, { ...o, as: 'text' }),
    buffer: (url, o) => request(url, { ...o, as: 'buffer' }),
    stats: () => ({ bytes, requests }),
  };
}
