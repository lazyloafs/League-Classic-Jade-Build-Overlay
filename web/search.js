'use strict';
// Multi-objective search over fixed-size item builds, plus weighted ranking of the resulting Pareto front.
// Objectives are all maximised. maxGold is handled with constrained domination (feasible beats infeasible).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JadeSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function run(o) {
    const { model, size, maxGold, keys, pop = 240, gens = 200, onProgress } = o;
    const R = rng(o.seed == null ? 12345 : o.seed), pool = model.pool, K = keys.length;
    const ok = (out, i, boots, groups) => { const it = pool[i]; return !out.includes(i) && !(it.boots && boots) && !(it.group >= 0 && groups.has(it.group)); };
    function repair(idx) {
      const out = [], groups = new Set(); let boots = false;
      const add = (i) => { out.push(i); boots = boots || pool[i].boots; if (pool[i].group >= 0) groups.add(pool[i].group); };
      for (const i of idx) if (ok(out, i, boots, groups)) add(i);
      while (out.length < size) { const i = Math.floor(R() * pool.length); if (ok(out, i, boots, groups)) add(i); }
      return out.sort((a, b) => a - b);
    }
    const make = (idx) => { const v = model.evaluate(idx.map((i) => pool[i])); return { idx, v, f: keys.map((k) => -v[k]), viol: Math.max(0, v.cost - maxGold) }; };
    const dom = (a, b) => {
      if (a.viol > 0 || b.viol > 0) { if (a.viol === 0) return true; if (b.viol === 0) return false; return a.viol < b.viol; }
      let better = false;
      for (let k = 0; k < K; k++) { if (a.f[k] > b.f[k]) return false; if (a.f[k] < b.f[k]) better = true; }
      return better;
    };
    function fronts(P) {
      const dominated = P.map(() => []), n = P.map(() => 0), out = [[]];
      for (let p = 0; p < P.length; p++) for (let q = p + 1; q < P.length; q++) {
        if (dom(P[p], P[q])) { dominated[p].push(q); n[q]++; } else if (dom(P[q], P[p])) { dominated[q].push(p); n[p]++; }
      }
      for (let p = 0; p < P.length; p++) if (n[p] === 0) { P[p].rank = 0; out[0].push(p); }
      for (let i = 0; out[i].length; i++) { const next = []; for (const p of out[i]) for (const q of dominated[p]) if (--n[q] === 0) { P[q].rank = i + 1; next.push(q); } out.push(next); }
      out.pop(); return out;
    }
    function crowd(P, front) {
      for (const p of front) P[p].cd = 0;
      for (let k = 0; k < K; k++) {
        const s = [...front].sort((a, b) => P[a].f[k] - P[b].f[k]), lo = P[s[0]].f[k], hi = P[s[s.length - 1]].f[k];
        P[s[0]].cd = P[s[s.length - 1]].cd = Infinity; if (hi === lo) continue;
        for (let i = 1; i < s.length - 1; i++) P[s[i]].cd += (P[s[i + 1]].f[k] - P[s[i - 1]].f[k]) / (hi - lo);
      }
    }
    let P = []; const seen = new Set();
    while (P.length < pop) { const idx = repair([]); const key = idx.join(); if (seen.has(key)) continue; seen.add(key); P.push(make(idx)); }
    const better = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.cd > b.cd);
    fronts(P).forEach((f) => crowd(P, f));
    for (let g = 0; g < gens; g++) {
      const kids = [];
      while (kids.length < pop) {
        const pick = () => { const a = P[Math.floor(R() * pop)], b = P[Math.floor(R() * pop)]; return better(a, b) ? a : b; };
        const union = [...new Set([...pick().idx, ...pick().idx])], child = [];
        while (child.length < size && union.length) child.push(union.splice(Math.floor(R() * union.length), 1)[0]);
        if (R() < 0.6) { const m = 1 + (R() < 0.3 ? 1 : 0); for (let j = 0; j < m; j++) child[Math.floor(R() * child.length)] = Math.floor(R() * pool.length); }
        const idx = repair(child), key = idx.join(); if (seen.has(key) && R() < 0.8) continue; seen.add(key); kids.push(make(idx));
      }
      const all = P.concat(kids), fr = fronts(all), next = [];
      for (const f of fr) { crowd(all, f); if (next.length + f.length <= pop) f.forEach((i) => next.push(all[i])); else { f.sort((a, b) => all[b].cd - all[a].cd); for (const i of f) { if (next.length >= pop) break; next.push(all[i]); } break; } }
      P = next;
      if (onProgress && g % 10 === 0) onProgress((g + 1) / gens);
    }
    const f0 = fronts(P)[0].map((i) => P[i]).filter((x) => x.viol === 0);
    return f0;
  }

  // Weighted-sum ranking of a front. Each active objective is scaled 0..1 over the front, then weighted.
  function ranges(front, keys) {
    const r = {};
    for (const k of keys) { let lo = Infinity, hi = -Infinity; for (const b of front) { lo = Math.min(lo, b.v[k]); hi = Math.max(hi, b.v[k]); } r[k] = [lo, hi]; }
    return r;
  }
  const scoreOf = (v, w, r) => { let s = 0, t = 0; for (const k of Object.keys(w)) { if (!(w[k] > 0)) continue; const [lo, hi] = r[k]; s += w[k] * (hi > lo ? (v[k] - lo) / (hi - lo) : 1); t += w[k]; } return (t ? s / t : 0) - (v.cost || 0) * 1e-8; };   // tiny gold penalty breaks ties toward the cheaper build

  // Swap-one-item hill climb on the weighted score (keeps every build legal and under the gold cap).
  function polish(model, build, w, r, size, maxGold) {
    const pool = model.pool; let idx = build.idx.slice(), best = scoreOf(build.v, w, r), improved = true;
    while (improved) {
      improved = false;
      for (let slot = 0; slot < size; slot++) for (let c = 0; c < pool.length; c++) {
        if (idx.includes(c)) continue;
        const t = idx.slice(); t[slot] = c;
        if (t.filter((i) => pool[i].boots).length > 1) continue;
        const gs = t.map((i) => pool[i].group).filter((g) => g >= 0); if (new Set(gs).size !== gs.length) continue;
        const v = model.evaluate(t.map((i) => pool[i])); if (v.cost > maxGold) continue;
        const sc = scoreOf(v, w, r); if (sc > best + 1e-9) { best = sc; idx = t; improved = true; }
      }
    }
    idx.sort((a, b) => a - b);
    return { idx, v: model.evaluate(idx.map((i) => pool[i])), score: best };
  }
  function rank(model, front, weights, topN, size, maxGold) {
    const keys = Object.keys(weights).filter((k) => weights[k] > 0), r = ranges(front, keys);
    const scored = front.map((b) => ({ idx: b.idx, v: b.v, score: scoreOf(b.v, weights, r) })).sort((a, b) => b.score - a.score);
    const out = new Map();
    for (const b of scored.slice(0, topN * 2)) { const p = polish(model, b, weights, r, size, maxGold); out.set(p.idx.join(), p); }
    for (const b of scored) { if (out.size >= topN * 3) break; out.set(b.idx.join(), b); }   // runners-up so the list has variety
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, topN);
  }
  return { run, rank, ranges, scoreOf };
});
