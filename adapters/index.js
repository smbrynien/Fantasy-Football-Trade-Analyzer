// Adapter registry: maps the `adapter` name in config/sources.json to an implementation.
// To add a source: write adapters/<name>.js extending BaseAdapter, register it here, add an entry to
// config/sources.json. Nothing else in the application needs to change (see docs/ADDING_A_SOURCE.md).

import { SleeperAdapter, SleeperProjectionsAdapter, SleeperStatsAdapter } from './sleeper.js';
import { FantasyCalcAdapter } from './fantasycalc.js';
import { DynastyProcessValuesAdapter, DynastyProcessIdsAdapter, FantasyProsECRAdapter } from './dynastyprocess.js';
import { NflverseAdapter } from './nflverse.js';
import { FFCAdapter } from './ffc.js';
import { EspnAdapter } from './espn.js';

export const ADAPTERS = {
  sleeper: SleeperAdapter,
  sleeper_projections: SleeperProjectionsAdapter,
  sleeper_stats: SleeperStatsAdapter,
  fantasycalc: FantasyCalcAdapter,
  dynastyprocess_values: DynastyProcessValuesAdapter,
  dynastyprocess_ids: DynastyProcessIdsAdapter,
  fantasypros_ecr: FantasyProsECRAdapter,
  nflverse: NflverseAdapter,
  ffc_adp: FFCAdapter,
  espn: EspnAdapter,
};

export function createAdapter(source, ctx) {
  const Cls = ADAPTERS[source.adapter];
  if (!Cls) return null;
  return new Cls(source, ctx);
}
