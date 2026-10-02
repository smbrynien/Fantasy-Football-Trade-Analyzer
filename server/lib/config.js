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
  return {
    sources: readJSONSync(path.join(CONFIG_DIR, 'sources.json')),
    model: readJSONSync(path.join(CONFIG_DIR, 'model.json')),
    leagueDefaults: readJSONSync(path.join(CONFIG_DIR, 'league-defaults.json')),
    profiles: readJSONSync(path.join(CONFIG_DIR, 'profiles.json')),
    importSpecs: readJSONSync(path.join(CONFIG_DIR, 'import-specs.json')),
    calibration,
  };
}
