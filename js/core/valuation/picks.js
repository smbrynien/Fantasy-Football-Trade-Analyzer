// ROOKIE DRAFT PICK model. See docs/ROOKIE_PICK_MODEL.md.
//
// A pick is valued by its position p in the rookie class (p = (round-1)·teams + slot), so league size is handled
// naturally (1.12 in a 12-team league ≈ 1.12 in 14-team; 2.01 in 14-team = 15th rookie).
//   V(p) = w_market·M(p) + w_hist·H(p) + w_class·C(p)            (weights renormalised over available parts)
//   M(p)  market pick values (FantasyCalc, DynastyProcess, KTC…) mapped onto our scale via each source's own
//         player values (value-function mapping), interpolated between slot/bucket anchors
//   H(p)  historical slot-value SHAPE (rookie consensus rank → realised production, calibration) × current anchor
//   C(p)  current rookie class: model values of the latest rookie class ordered by consensus rookie rank (isotonic)
// Future seasons: model parts × future_year_discount^Δ, market parts from that season's market values when present.
// Unknown/bucketed/ranged slots integrate V over the slot distribution; spread feeds uncertainty.

import { interp, isotonicDecreasing, mean, sd, weightedMean, clamp } from '../util/stats.js';
import { fitValueFunction } from './mapping.js';
import { parsePickLabel, pickAssetId, pickDisplayName } from '../pick-labels.js';

export function upcomingRookieYear(asOf, model) {
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  const m = d.getUTCMonth() + 1;
  return m >= model.picks.upcoming_class_switch_month ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}

function bucketSlots(bucket, T, buckets) {
  const [lo, hi] = buckets[bucket];
  const out = [];
  for (let k = 1; k <= T; k++) {
    const f = (k - 0.5) / T;
    if (f >= lo && f < hi) out.push(k);
  }
  return out.length ? out : [Math.max(1, Math.round(T * (lo + hi) / 2))];
}

/** Center class-position (reference 12-team terms) for a market descriptor. */
function anchorPosition(desc, Tref, buckets) {
  if (desc.slot) return (desc.round - 1) * Tref + desc.slot;
  if (desc.bucket) return (desc.round - 1) * Tref + mean(bucketSlots(desc.bucket, Tref, buckets));
  return null;
}

export function runPicks(dataset, league, model, env, dyn) {
  const cfg = model.picks;
  const T = league.teams;
  const Tref = cfg.reference_teams;
  const rounds = clamp((league.dynasty && league.dynasty.rookie_rounds) || cfg.default_rounds, 1, cfg.max_rounds);
  const nYears = clamp((league.dynasty && league.dynasty.pick_years) || cfg.years_ahead, 1, 6);
  const asOf = dataset.state?.as_of ? new Date(dataset.state.as_of) : new Date(dataset.built_at || Date.now());
  const upcoming = upcomingRookieYear(asOf, model);
  const seasons = Array.from({ length: nYears }, (_, i) => upcoming + i);
  const maxP = rounds * T;

  const playerScores = [...dyn.assets.values()].map((a) => a.score).sort((a, b) => b - a);

  // ---------- Market curves ----------
  const marketBySource = new Map(); // src → { slots: Map(season → [[p, v]]), rounds: Map(season → Map(round → v)) }
  const valueFns = new Map();
  for (const [src, variant] of dyn.marketLists) {
    const f = fitValueFunction(variant.items.map((i) => i.key), playerScores, model.mapping.min_source_players);
    if (f) valueFns.set(src, { f, qb: variant.meta.qb || '1qb' });
  }
  for (const pk of dataset.picks || []) {
    if (pk.dynasty === false) continue;
    const vf = valueFns.get(pk.src);
    if (!vf || (pk.qb || '1qb') !== vf.qb) continue;
    const desc = pk.season ? pk : parsePickLabel(pk.label);
    if (!desc || !seasons.includes(Number(desc.season)) || typeof pk.value !== 'number') continue;
    const mapped = vf.f(pk.value);
    if (mapped === null) continue;
    if (!marketBySource.has(pk.src)) marketBySource.set(pk.src, { slots: new Map(), rounds: new Map() });
    const ms = marketBySource.get(pk.src);
    const s = Number(desc.season);
    const ap = anchorPosition(desc, Tref, cfg.buckets);
    if (ap !== null) {
      if (!ms.slots.has(s)) ms.slots.set(s, []);
      ms.slots.get(s).push([ap, mapped, pk.label || pickDisplayName(desc)]);
    } else {
      if (!ms.rounds.has(s)) ms.rounds.set(s, new Map());
      ms.rounds.get(s).set(desc.round, { v: mapped, label: pk.label || pickDisplayName(desc), raw: pk.value });
    }
  }
  // Build per-source curve per season (slot anchors) — future seasons without slot anchors are derived from
  // round-level values relative to the upcoming season's curve.
  const srcCurves = new Map(); // src → Map(season → fn(p) | null)
  for (const [src, ms] of marketBySource) {
    const m = new Map();
    const base = (ms.slots.get(upcoming) || []).sort((a, b) => a[0] - b[0]);
    const baseFn = base.length >= 2 ? (p) => (p > base[base.length - 1][0] + Tref / 2 ? null : interp(base.map(([a, b]) => [a, b]), p)) : null;
    for (const s of seasons) {
      const anchors = (ms.slots.get(s) || []).sort((a, b) => a[0] - b[0]);
      if (anchors.length >= 2) {
        const pts = anchors.map(([a, b]) => [a, b]);
        const last = anchors[anchors.length - 1][0];
        m.set(s, (p) => (p > last + Tref / 2 ? null : interp(pts, p)));
      } else if (baseFn && ms.rounds.has(s)) {
        const rv = ms.rounds.get(s);
        m.set(s, (p) => {
          const r = Math.ceil(p / Tref);
          const rr = rv.get(r);
          if (!rr) return null;
          const ref = mean(Array.from({ length: Tref }, (_, i) => baseFn((r - 1) * Tref + i + 1)).filter((v) => v !== null));
          const b = baseFn(p);
          return b === null || !ref ? null : b * (rr.v / ref);
        });
      } else m.set(s, null);
    }
    srcCurves.set(src, m);
  }
  const marketAt = (season, p) => {
    const items = [];
    for (const [src, m] of srcCurves) {
      const fn = m.get(season);
      if (!fn) continue;
      const v = fn(p); // p and the anchors are both rookie-class positions
      if (v !== null && v !== undefined) items.push({ v, w: model.source_weights.pick_market[src] ?? 0.5, src });
    }
    return items.length ? { v: weightedMean(items), sources: items } : null;
  };

  // ---------- Current rookie class curve ----------
  const rookieRanks = [];
  for (const p of dataset.players) {
    const rr = (p.rankings || []).filter((r) => r.kind === 'rookie' && typeof (r.ecr ?? r.rank) === 'number');
    if (!rr.length) continue;
    const a = dyn.assets.get(p.cid);
    if (!a) continue;
    rookieRanks.push({ cid: p.cid, rank: mean(rr.map((r) => r.ecr ?? r.rank)), score: a.score, draftYear: p.draft?.year ?? null, name: p.name });
  }
  rookieRanks.sort((a, b) => a.rank - b.rank);
  const classYearCounts = {};
  for (const r of rookieRanks) if (r.draftYear) classYearCounts[r.draftYear] = (classYearCounts[r.draftYear] || 0) + 1;
  const classYear = Number(Object.entries(classYearCounts).sort((a, b) => b[1] - a[1])[0]?.[0]) || null;
  const classPlayers = rookieRanks.filter((r) => !classYear || Number(r.draftYear) === classYear);
  const classCurve = classPlayers.length >= 12 ? isotonicDecreasing(classPlayers.map((r) => r.score)) : null;
  const classAt = (p) => (classCurve && p <= classCurve.length ? classCurve[Math.max(1, Math.round(p)) - 1] : null);
  const classIsUpcoming = classYear === upcoming;

  // ---------- Historical shape ----------
  const shape = cfg.historical_shape || null;
  let anchor = null;
  if (classCurve) anchor = mean(classCurve.slice(0, Math.min(12, classCurve.length)));
  else {
    const top = Array.from({ length: 12 }, (_, i) => marketAt(upcoming, i + 1)).filter(Boolean).map((x) => x.v);
    if (top.length >= 6) anchor = mean(top);
  }
  const histAt = (p) => (shape && anchor !== null && p <= shape.length ? anchor * shape[Math.max(1, Math.round(p)) - 1] : null);

  // ---------- Slot value ----------
  const W = cfg.weights;
  const slotValue = (season, p) => {
    const delta = season - upcoming;
    const disc = Math.pow(cfg.future_year_discount, delta);
    const modelAdj = classIsUpcoming ? 1 : (cfg.prior_class_adjustment ?? 1);
    const mk = marketAt(season, p);
    const parts = {
      market: mk ? mk.v : null,
      historical: histAt(p) !== null ? histAt(p) * cfg.class_strength * disc * modelAdj : null,
      current_class: classAt(p) !== null ? classAt(p) * cfg.class_strength * disc * modelAdj : null,
    };
    let sw = 0, v = 0;
    const contributions = {};
    for (const [k, val] of Object.entries(parts)) if (val !== null && W[k] > 0) sw += W[k];
    for (const [k, val] of Object.entries(parts)) if (val !== null && W[k] > 0) { contributions[k] = (val * W[k]) / sw; v += contributions[k]; }
    return { v: sw ? v : null, parts, contributions, marketSources: mk ? mk.sources : [], disc };
  };

  /** Value a descriptor (known slot / bucket / range / unknown) for this league. */
  const valueDescriptor = (desc) => {
    const season = Number(desc.season), r = Number(desc.round);
    let slots;
    if (desc.slot) slots = [clamp(desc.slot, 1, T)];
    else if (desc.bucket) slots = bucketSlots(desc.bucket, T, cfg.buckets);
    else if (desc.range) slots = Array.from({ length: desc.range[1] - desc.range[0] + 1 }, (_, i) => clamp(desc.range[0] + i, 1, T));
    else slots = Array.from({ length: T }, (_, i) => i + 1);
    const evals = slots.map((k) => ({ k, ...slotValue(season, (r - 1) * T + k) })).filter((e) => e.v !== null);
    if (!evals.length) return null;
    const vals = evals.map((e) => e.v);
    const v = mean(vals);
    const contributions = {};
    for (const e of evals) for (const [k, c] of Object.entries(e.contributions)) contributions[k] = (contributions[k] || 0) + c / evals.length;
    const spread = vals.length > 1 ? sd(vals) : 0;
    const partVals = evals.map((e) => Object.values(e.parts).filter((x) => x !== null));
    const partsSd = mean(partVals.map((a) => (a.length > 1 ? sd(a) : 0)));
    const futureCv = (season - upcoming) * cfg.unknown_slot_extra_cv;
    // Estimate uncertainty (what is the pick worth?) — distinct from outcome risk (will the player hit?).
    const sigma = Math.sqrt(spread ** 2 + partsSd ** 2 + (futureCv * v) ** 2 + (model.confidence.min_range_pct * v) ** 2);
    const partsAvail = Object.keys(contributions);
    const label = desc.slot && season === upcoming && partsAvail.includes('market') && partsAvail.length >= 2 ? 'Moderate' : 'Low';
    return {
      score: v, contributions, sigma,
      slots, classPositions: slots.map((k) => (r - 1) * T + k),
      marketSources: [...new Set(evals.flatMap((e) => e.marketSources.map((s) => s.src)))],
      discount: evals[0].disc,
      outcomeRiskCv: cfg.hit_rate_cv,
      confidence: {
        label, score: null, sigma,
        reasons: [
          `Rookie picks carry high outcome risk (historical outcome spread ≈ ±${Math.round(cfg.hit_rate_cv * 100)}% of value)`,
          ...(desc.slot ? [] : ['slot not yet known — value integrates over possible slots']),
          ...(season > upcoming ? [`future class (${season}) discounted ${Math.round((1 - evals[0].disc) * 100)}%`] : []),
          ...(partsAvail.includes('market') ? [] : ['no market pick data for this pick']),
        ],
      },
    };
  };

  const assets = new Map();
  const add = (desc) => {
    const res = valueDescriptor(desc);
    if (!res) return;
    const id = pickAssetId(desc);
    assets.set(id, {
      id, kind: 'pick', mode: 'dynasty', name: pickDisplayName(desc), position: 'PICK', team: null, age: null,
      descriptor: desc, score: res.score, contributions: res.contributions, groups: {},
      confidence: res.confidence, sources: res.marketSources,
      details: { slots: res.slots, classPositions: res.classPositions, discount: res.discount, sigma: res.sigma, outcomeRiskCv: res.outcomeRiskCv, upcoming, classYear, classIsUpcoming },
    });
  };
  for (const s of seasons) {
    for (let r = 1; r <= rounds; r++) {
      add({ season: s, round: r, slot: null, bucket: null, range: null });
      for (const b of ['early', 'mid', 'late']) add({ season: s, round: r, slot: null, bucket: b, range: null });
      for (let k = 1; k <= T; k++) add({ season: s, round: r, slot: k, bucket: null, range: null });
    }
  }

  return {
    assets, valueDescriptor, upcoming, seasons, rounds, classYear, classIsUpcoming,
    diagnostics: {
      classSize: classPlayers.length, anchor, hasShape: Boolean(shape), marketSources: [...marketBySource.keys()],
      slotTable: Array.from({ length: Math.min(maxP, 72) }, (_, i) => {
        const sv = slotValue(upcoming, i + 1);
        return { p: i + 1, value: sv.v, ...sv.parts };
      }),
      classTop: classPlayers.slice(0, 36).map((r, i) => ({ p: i + 1, name: r.name, rank: r.rank, score: r.score, smoothed: classCurve ? classCurve[i] : null })),
    },
  };
}
