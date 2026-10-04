'use strict';
// Lane handling: reading the lane from the game, and choosing which build to show for a champion + lane.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const LANES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const LABELS = { TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'Bot', UTILITY: 'Support' };
const ALIASES = { MID: 'MIDDLE', BOT: 'BOTTOM', ADC: 'BOTTOM', SUPPORT: 'UTILITY', SUP: 'UTILITY', JUNGLER: 'JUNGLE', JG: 'JUNGLE' };

// 'TOP' | 'JUNGLE' | ... or '' when it isn't a real lane ('NONE', '', undefined).
function normalizeLane(v) {
  const u = String(v == null ? '' : v).trim().toUpperCase();
  const lane = ALIASES[u] || u;
  return LANES.includes(lane) ? lane : '';
}

// The game's own position field wins; a Smite spell means jungle. Returns { lane, source } or null.
function detectLane(player) {
  if (!player) return null;
  const fromPos = normalizeLane(player.position);
  if (fromPos) return { lane: fromPos, source: 'api' };
  const sp = player.summonerSpells || {};
  const names = [sp.summonerSpellOne, sp.summonerSpellTwo].map((s) => String((s && s.displayName) || ''));
  if (names.some((n) => /smite/i.test(n))) return { lane: 'JUNGLE', source: 'spell' };
  return null;
}

const selKey = (champion, lane) => norm(champion) + '|' + (lane ? lane : 'any');
const newest = (a, b) => String(b.updated || '').localeCompare(String(a.updated || ''));

// Which build to show. `matches(buildChampion, gameChampion)` decides if a build is for the champion.
// Order: the build selected for this lane, a build tagged with this lane, the selected/any-lane build, anything for the champion.
function pickBuild(builds, selections, champion, lane, matches) {
  const cands = builds.filter((b) => matches(b.champion, champion));
  if (!cands.length) return { build: null, laneMatch: false };
  const byId = (id) => cands.find((b) => b.id === id);
  if (lane) {
    const sel = byId(selections[selKey(champion, lane)]);
    if (sel) return { build: sel, laneMatch: true };
    const tagged = cands.filter((b) => b.lane === lane).sort(newest)[0];
    if (tagged) return { build: tagged, laneMatch: true };
  }
  const anySel = byId(selections[selKey(champion, '')]) || byId(selections[norm(champion)]);   // older versions stored one build per champion
  if (anySel) return { build: anySel, laneMatch: !lane || !anySel.lane };
  const generic = cands.filter((b) => !b.lane).sort(newest)[0];
  if (generic) return { build: generic, laneMatch: true };
  return { build: cands.sort(newest)[0], laneMatch: !lane };
}

// Lanes that have a build for this champion, in lane order, with '' (any) first when a generic build exists.
function lanesFor(builds, champion, matches) {
  const cands = builds.filter((b) => matches(b.champion, champion));
  const out = [];
  if (cands.some((b) => !b.lane)) out.push('');
  for (const l of LANES) if (cands.some((b) => b.lane === l)) out.push(l);
  return out;
}

function nextLane(current, available) {
  if (!available.length) return '';
  const i = available.indexOf(current || '');
  return available[(i + 1) % available.length];
}

module.exports = { LANES, LABELS, normalizeLane, detectLane, selKey, pickBuild, lanesFor, nextLane, norm };
