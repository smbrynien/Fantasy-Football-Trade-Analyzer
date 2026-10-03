// Filesystem layout. Everything the app writes lives under data/ (git-ignored except data/README.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_DIR = path.join(ROOT, 'config');
export const DATA_DIR = process.env.FFTA_DATA_DIR ? path.resolve(process.env.FFTA_DATA_DIR) : path.join(ROOT, 'data');

export const P = {
  raw: (source) => path.join(DATA_DIR, 'raw', source),
  normalized: (source) => path.join(DATA_DIR, 'normalized', source),
  normalizedFile: (source, type) => path.join(DATA_DIR, 'normalized', source, `${type}.json`),
  players: path.join(DATA_DIR, 'players', 'players.json'),
  playerOverrides: path.join(DATA_DIR, 'players', 'overrides.json'),
  playerEvents: path.join(DATA_DIR, 'players', 'events.json'),
  unresolved: path.join(DATA_DIR, 'players', 'unresolved.json'),
  dataset: path.join(DATA_DIR, 'calculated', 'dataset.json'),
  values: path.join(DATA_DIR, 'calculated', 'values-default.json'),
  history: path.join(DATA_DIR, 'calculated', 'history.json'),
  snapshots: path.join(DATA_DIR, 'snapshots'),
  archive: path.join(DATA_DIR, 'archive'),
  sourceStatus: path.join(DATA_DIR, 'state', 'sources-status.json'),
  lastSync: path.join(DATA_DIR, 'state', 'last-sync.json'),
  syncLog: path.join(DATA_DIR, 'state', 'sync-log.json'),
  quality: path.join(DATA_DIR, 'state', 'quality-report.json'),
  nflState: path.join(DATA_DIR, 'state', 'nfl-state.json'),
  userProfiles: path.join(DATA_DIR, 'user', 'profiles.json'),
  trades: path.join(DATA_DIR, 'user', 'trades.json'),
};
