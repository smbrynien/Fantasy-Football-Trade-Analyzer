// League structure: starters per position (with FLEX / SUPERFLEX allocation), replacement levels,
// waiver (last-rostered) levels and lineup-displacement levels — all derived from the league settings and
// the current pool of player point estimates. This is where positional scarcity comes from.

const DEDICATED = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SKILL = ['QB', 'RB', 'WR', 'TE'];

/**
 * @param pool   [{cid, position, points}] — points on the scale being valued (ROS or season points)
 * @param league league settings (teams, roster, flex_eligibility)
 */
export function computeLeagueStructure(pool, league) {
  const T = league.teams;
  const R = league.roster;
  const byPos = {};
  for (const p of DEDICATED) byPos[p] = [];
  for (const x of pool) if (byPos[x.position] && typeof x.points === 'number' && Number.isFinite(x.points)) byPos[x.position].push(x);
  for (const p of DEDICATED) byPos[p].sort((a, b) => b.points - a.points);

  const starters = {};
  const taken = {};
  for (const p of DEDICATED) { starters[p] = Math.min(byPos[p].length, T * (R[p] || 0)); taken[p] = starters[p]; }

  // Flex allocation: FLEX first, then SUPERFLEX (QBs will usually win SUPERFLEX slots).
  const elig = league.flex_eligibility || { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] };
  const flexSlots = {};
  for (const slot of ['FLEX', 'SUPERFLEX']) {
    let n = T * (R[slot] || 0);
    const positions = elig[slot] || [];
    flexSlots[slot] = {};
    while (n > 0) {
      let best = null;
      for (const p of positions) {
        const next = byPos[p] && byPos[p][taken[p]];
        if (next && (!best || next.points > best.points)) best = next;
      }
      if (!best) break;
      taken[best.position]++;
      starters[best.position]++;
      flexSlots[slot][best.position] = (flexSlots[slot][best.position] || 0) + 1;
      n--;
    }
  }

  const replacement = {}, waiver = {}, rostered = {}, displacement = {};
  const skillStarters = SKILL.reduce((a, p) => a + starters[p], 0);
  const bench = T * (R.BENCH || 0);
  for (const p of DEDICATED) {
    const list = byPos[p];
    const s = starters[p];
    if (!list.length) { replacement[p] = null; waiver[p] = null; rostered[p] = 0; displacement[p] = null; continue; }
    if (s === 0) {
      // Position not started in this league: nobody has surplus value.
      replacement[p] = list[0].points + 1e-6;
      waiver[p] = replacement[p];
      rostered[p] = 0;
      displacement[p] = replacement[p];
      continue;
    }
    const last = list[Math.min(s, list.length) - 1].points;
    const firstOut = list[Math.min(s, list.length - 1)].points;
    replacement[p] = s >= list.length ? last : (last + firstOut) / 2;
    const benchShare = SKILL.includes(p) && skillStarters ? Math.round(bench * (s / skillStarters)) : 0;
    rostered[p] = Math.min(list.length, s + benchShare);
    waiver[p] = rostered[p] >= list.length ? Math.min(list[list.length - 1].points, replacement[p]) : list[rostered[p]].points;
    waiver[p] = Math.min(waiver[p], replacement[p]);
    // Average team's worst starter sits around rank s - T/2 (+0.5): used for package/lineup displacement.
    const dRank = Math.max(1, Math.round(s - T / 2 + 0.5));
    displacement[p] = list[Math.min(dRank, list.length) - 1].points;
  }
  return { teams: T, starters, flexSlots, replacement, waiver, rostered, displacement, totalRostered: T * (DEDICATED.reduce((a, p) => a + (R[p] || 0), 0) + (R.FLEX || 0) + (R.SUPERFLEX || 0) + (R.BENCH || 0)) };
}

/**
 * Surplus points: full credit above the starter replacement level, plus a fraction (bench value) of the band
 * between the waiver level and the replacement level. Continuous and monotone.
 */
export function surplusPoints(points, position, structure, benchFraction) {
  const r = structure.replacement[position];
  const w = structure.waiver[position];
  if (r === null || r === undefined || points === null || points === undefined) return null;
  const above = Math.max(0, points - r);
  const band = Math.max(0, Math.min(points, r) - w);
  return above + benchFraction * band;
}
