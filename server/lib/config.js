// Loads configuration files (read fresh on each call so edits apply without restarting).
import path from 'node:path';
import fs from 'node:fs';
import { CONFIG_DIR } from './paths.js';
import { readJSONSync } from './store.js';

export function loadConfig() {
  const calibration = {};
  const calDir = path.join(CONFIG_DIR, 'calibration');
  if (fs.existsSync(calDir)) {
    for (const f of fs.readdirSync(calDir)) {
      if (!f.endsWith('.json')) continue;
      calibration[f.replace(/\.json$/, '').replace(/-/g, '_')] = readJSONSync(path.join(calDir, f));
    }
  }
  // Required files: a missing one used to come back as null and crash much later with an unrelated message.
  const required = (f) => {
    const v = readJSONSync(path.join(CONFIG_DIR, f), null);
    if (!v || typeof v !== 'object') throw new Error(`config/${f} is missing or empty. Restore it from the app download (or \`git checkout config/${f}\`).`);
    return v;
  };
  return {
    sources: required('sources.json'),
    model: required('model.json'),
    leagueDefaults: required('league-defaults.json'),
    profiles: required('profiles.json'),
    importSpecs: required('import-specs.json'),
    calibration,
  };
}
