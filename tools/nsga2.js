'use strict';
// NSGA-II over 6-item builds: maximise defense, maximise DPS, minimise gold. Run: node tools/nsga2.js
const fs = require('fs');
const path = require('path');
const { pool, ARCH, TARGET, evaluate } = require('./model');
const SIZE = 6, POP = 300, GENS = 400, SEEDS = [1, 2, 3];

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const legal = (idx) => { const ids = new Set(idx); if (ids.size !== idx.length) return false; let b = 0; const g = new Set();
  for (const i of idx) { const it = pool[i]; if (it.boots && ++b > 1) return false; if (it.group >= 0) { if (g.has(it.group)) return false; g.add(it.group); } } return true; };
function repair(idx, R) {   // keep what is legal, refill randomly
  const out = []; const g = new Set(); let boots = false;
  for (const i of idx) { const it = pool[i]; if (out.includes(i) || (it.boots && boots) || (it.group >= 0 && g.has(it.group))) continue;
    out.push(i); boots = boots || it.boots; if (it.group >= 0) g.add(it.group); }
  while (out.length < SIZE) { const i = Math.floor(R() * pool.length); const it = pool[i];
    if (out.includes(i) || (it.boots && boots) || (it.group >= 0 && g.has(it.group))) continue; out.push(i); boots = boots || it.boots; if (it.group >= 0) g.add(it.group); }
  return out.sort((x, y) => x - y);
}
function makeInd(idx, name) { const e = evaluate(name, idx.map((i) => pool[i])); return { idx, e, f: [-e.defense, -e.dps, e.cost] }; }
const dom = (a, b) => { let better = false; for (let k = 0; k < 3; k++) { if (a.f[k] > b.f[k]) return false; if (a.f[k] < b.f[k]) better = true; } return better; };

function sortFronts(P) {
  const S = P.map(() => []), n = P.map(() => 0), fronts = [[]];
  for (let p = 0; p < P.length; p++) for (let q = 0; q < P.length; q++) { if (p === q) continue;
    if (dom(P[p], P[q])) S[p].push(q); else if (dom(P[q], P[p])) n[p]++; }
  for (let p = 0; p < P.length; p++) if (n[p] === 0) { P[p].rank = 0; fronts[0].push(p); }
  let i = 0;
  while (fronts[i].length) { const next = []; for (const p of fronts[i]) for (const q of S[p]) if (--n[q] === 0) { P[q].rank = i + 1; next.push(q); } i++; fronts.push(next); }
  fronts.pop(); return fronts;
}
function crowding(P, front) {
  for (const p of front) P[p].cd = 0;
  for (let k = 0; k < 3; k++) {
    const s = [...front].sort((a, b) => P[a].f[k] - P[b].f[k]); const lo = P[s[0]].f[k], hi = P[s[s.length - 1]].f[k];
    P[s[0]].cd = P[s[s.length - 1]].cd = Infinity; if (hi === lo) continue;
    for (let i = 1; i < s.length - 1; i++) P[s[i]].cd += (P[s[i + 1]].f[k] - P[s[i - 1]].f[k]) / (hi - lo);
  }
}
function run(name, seed) {
  const R = rng(seed);
  let P = []; const seen = new Set();
  while (P.length < POP) { const idx = repair([], R); const key = idx.join(); if (seen.has(key)) continue; seen.add(key); P.push(makeInd(idx, name)); }
  const better = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.cd > b.cd);
  let fr = sortFronts(P); fr.forEach((f) => crowding(P, f));
  for (let g = 0; g < GENS; g++) {
    const kids = [];
    while (kids.length < POP) {
      const pick = () => { const a = P[Math.floor(R() * POP)], b = P[Math.floor(R() * POP)]; return better(a, b) ? a : b; };
      const p1 = pick(), p2 = pick();
      const pl = [...new Set([...p1.idx, ...p2.idx])]; let child = [];
      while (child.length < SIZE && pl.length) child.push(pl.splice(Math.floor(R() * pl.length), 1)[0]);   // uniform crossover on the union
      if (R() < 0.6) { const m = 1 + (R() < 0.3 ? 1 : 0); for (let j = 0; j < m; j++) child[Math.floor(R() * child.length)] = Math.floor(R() * pool.length); }   // mutation
      child = repair(child, R); const key = child.join(); if (seen.has(key) && R() < 0.8) continue; seen.add(key);
      kids.push(makeInd(child, name));
    }
    const all = P.concat(kids); const fronts = sortFronts(all); const next = [];
    for (const f of fronts) { crowding(all, f); if (next.length + f.length <= POP) f.forEach((i) => next.push(all[i])); else { f.sort((a, b) => all[b].cd - all[a].cd); for (const i of f) { if (next.length >= POP) break; next.push(all[i]); } break; } }
    P = next;
  }
  const fronts = sortFronts(P); return fronts[0].map((i) => P[i]);
}
function merge(inds) {   // union of the runs, keep only non-dominated distinct builds
  const uniq = new Map(inds.map((x) => [x.idx.join(), x])); const arr = [...uniq.values()];
  return arr.filter((a) => !arr.some((b) => dom(b, a))).sort((a, b) => a.e.cost - b.e.cost);
}
const out = { size: SIZE, pop: POP, gens: GENS, seeds: SEEDS, target: TARGET, archetypes: {} };
for (const name of Object.keys(ARCH)) {
  const t = Date.now(); let all = [];
  for (const s of SEEDS) all = all.concat(run(name, s));
  const front = merge(all);
  out.archetypes[name] = { front: front.map((x) => ({ items: x.idx.map((i) => pool[i].name), defense: x.e.defense, phys: x.e.phys, magic: x.e.magic, dps: x.e.dps, cost: x.e.cost })) };
  const mx = (k) => Math.max(...front.map((x) => x.e[k]));
  console.log(name, 'front', front.length, 'maxDef', Math.round(mx('defense')), 'maxDps', Math.round(mx('dps')), ((Date.now() - t) / 1000).toFixed(0) + 's');
}
fs.writeFileSync(path.join(__dirname, 'nsga2-fronts.json'), JSON.stringify(out, null, 1));
