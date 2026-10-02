#!/usr/bin/env node
// CLI: npm run sync [-- --force] [-- --source fantasycalc,sleeper] [-- --failed] [-- --rebuild-only]
import { runSync } from '../server/sync-engine.js';
import { loadEnv } from '../server/lib/env.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (name) => args.includes(`--${name}`);
const val = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const t0 = Date.now();
const summary = await runSync({
  force: opt('force'),
  failedOnly: opt('failed'),
  rebuildOnly: opt('rebuild-only'),
  sources: val('source') ? val('source').split(',') : undefined,
  verbose: !opt('quiet'),
});
const pad = (s, n) => String(s).padEnd(n);
console.log('\nSource'.padEnd(26) + pad('Status', 13) + 'Records / message');
console.log('-'.repeat(90));
for (const [id, r] of Object.entries(summary.results)) {
  const recs = r.records ? Object.entries(r.records).map(([t, n]) => `${t}:${n}`).join(' ') : '';
  console.log(pad(id, 25) + pad(r.status, 13) + (r.error ? `${recs} ${r.error}`.trim() : recs));
}
console.log('-'.repeat(90));
console.log(`succeeded ${summary.succeeded} · partial ${summary.partial} · failed ${summary.failed} · skipped ${summary.skipped}`);
if (summary.build) console.log(`dataset ${summary.build.data_version}: ${summary.build.players} players, ${summary.build.picks} pick values, unresolved ${summary.build.unresolved}, ambiguous ${summary.build.ambiguous}`);
if (summary.build_error) console.log(`BUILD ERROR: ${summary.build_error}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(summary.http.bytes / 1e6).toFixed(1)} MB in ${summary.http.requests} requests`);
process.exit(summary.build_error ? 1 : 0);
