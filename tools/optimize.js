'use strict';
// Exhaustive best-build search for League Classic (Jade) items.
// For every objective and every build size 1..6 it tests every legal combination of
// finished items and keeps the highest scorer. Run: node tools/optimize.js [--stacked]
const fs = require('fs');
const path = require('path');
const ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'jade-items.json'), 'utf8')).items;
const STACKED = process.argv.includes('--stacked');

// ---------- assumptions (edit these) ----------
const TANK = { hp: 2100, armor: 100, mr: 50 };                 // level-18 frontliner, before items
const CARRY = { ad: 100, as: 0.70, hp: 1800, mana: 500 };      // level-18 marksman-ish, before items
const TARGET = { hp: 2500, armor: 100, mr: 60 };               // what the carry is hitting
const AS_CAP = 2.5;
const MANA_STACKS = 750;                                       // Manamune "Mana Charge" full (stacked mode only)

// ---------- items ----------
const byId = new Map(ITEMS.map((i) => [i.id, i]));
const purchasable = (id) => byId.has(id) && byId.get(id).purchasable;
const isFinal = (i) => i.purchasable && i.cost > 0 && !(i.into || []).some(purchasable) &&
  !i.tags.some((t) => ['Consumable', 'Trinket', 'Vision'].includes(t)) &&
  !/Doran's/.test(i.name) && !/Ward|Potion|Elixir|Flask|Trinket|Recall|Biscuit/.test(i.name);
const BOOTS = new Set([773006, 773009, 773020, 773047, 773111, 773117, 773158]);
// only one of each group may be owned
const GROUPS = [[773068, 773073], [773206, 773207, 773209]];
const groupOf = new Map(); GROUPS.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));

function stat(i, k) { return (i.stats && i.stats[k]) || 0; }
function base(i) {
  return {
    id: i.id, name: i.name, cost: i.cost, boots: BOOTS.has(i.id), group: groupOf.has(i.id) ? groupOf.get(i.id) : -1,
    hp: stat(i, 'FlatHPPoolMod'), armor: stat(i, 'FlatArmorMod'), mr: stat(i, 'FlatSpellBlockMod'),
    ad: stat(i, 'FlatPhysicalDamageMod'), as: stat(i, 'PercentAttackSpeedMod'), crit: stat(i, 'FlatCritChanceMod'),
    mana: stat(i, 'FlatMPPoolMod'),
    lethality: 0, pctPen: 0, armorRed: 0, onhitMagic: 0, onhitPhys: 0, hpMult: 1, shieldMagic: 0, critMult: 0,
    adFromMaxHp: 0, adFromMana: 0, dmgReduction: 0,
  };
}
// numbers the item descriptions state but the stat blocks don't
const PATCH = {
  773131: (o) => { o.as += 0.45; },                                   // Sword of the Divine passive AS
  773071: (o) => { o.lethality += 10; o.armorRed = 0.25; },           // Black Cleaver
  773142: (o) => { o.lethality += 20; },                              // Youmuu's
  773035: (o) => { o.pctPen = 0.35; },                                // Last Whisper
  773031: (o) => { o.critMult = 0.5; },                               // Infinity Edge: 250% crits
  773091: (o) => { o.onhitMagic += 42; },                             // Wit's End
  773114: (o) => { o.onhitMagic += 15; },                             // Malady (value not in description; assumed 15)
  773109: (o) => { o.onhitMagic += 0.04 * TARGET.hp; },               // Madred's Bloodrazor
  773153: (o) => { o.onhitPhys += 0.05 * TARGET.hp * 0.6; },          // BotRK (target ~60% HP on average)
  773178: (o) => { o.onhitMagic += 125 / 4; },                        // Ionic Spark (single target)
  773087: (o) => { o.onhitMagic += 100 / 5; o.statikk = 1; },         // Statikk Shiv (assumed 1 proc / 5 attacks)
  773124: (o) => { o.as += 0.32; },                                   // Guinsoo's, 8 stacks
  773005: (o) => { o.adFromMaxHp = 0.015; },                          // Atma's Impaler
  773004: (o) => { o.adFromMana = 0.02; o.manaBonus = STACKED ? MANA_STACKS : 0; }, // Manamune
  773026: (o) => { o.hpMult = 1.3; },                                 // Guardian Angel revive (+30% max HP)
  773156: (o) => { o.shieldMagic = 400; },                            // Maw of Malmortius shield
  773138: (o) => { if (STACKED) { o.hp += 640; o.dmgReduction = 0.15; } },  // Leviathan 20 stacks
  773027: (o) => { if (STACKED) { o.hp += 200; o.mana += 200; } },    // Rod of Ages 10 stacks
  773072: (o) => { if (STACKED) { o.ad += 30; } },                    // Bloodthirster 30 stacks
  773141: (o) => { if (STACKED) { o.ad += 100; } },                   // Sword of the Occult 20 stacks
};
const pool = ITEMS.filter(isFinal).map((i) => { const o = base(i); if (PATCH[i.id]) PATCH[i.id](o); return o; });

// ---------- scoring ----------
function sum(items) {
  const s = { hp: 0, armor: 0, mr: 0, ad: 0, as: 0, crit: 0, mana: 0, lethality: 0, pctPen: 0, armorRed: 0, onhitMagic: 0, onhitPhys: 0,
    hpMult: 1, shieldMagic: 0, critMult: 0, adFromMaxHp: 0, adFromMana: 0, manaBonus: 0, dmgReduction: 0, statikk: 0, cost: 0 };
  for (const it of items) {
    for (const k of ['hp', 'armor', 'mr', 'ad', 'as', 'crit', 'mana', 'lethality', 'onhitMagic', 'onhitPhys', 'shieldMagic', 'adFromMaxHp', 'adFromMana', 'manaBonus', 'cost', 'statikk'])
      s[k] += it[k] || 0;
    s.pctPen = Math.max(s.pctPen, it.pctPen); s.armorRed = Math.max(s.armorRed, it.armorRed);
    s.hpMult = Math.max(s.hpMult, it.hpMult); s.critMult = Math.max(s.critMult, it.critMult);
    s.dmgReduction = Math.max(s.dmgReduction, it.dmgReduction);
  }
  return s;
}
const tankHp = (s) => (TANK.hp + s.hp) * s.hpMult;
const SCORERS = {
  'Tank vs physical': { fn: (s) => tankHp(s) * (1 + (TANK.armor + s.armor) / 100) / (1 - s.dmgReduction), unit: 'effective HP', pool: (o) => o.hp || o.armor || o.mr },
  'Tank vs magic': { fn: (s) => (tankHp(s) * (1 + (TANK.mr + s.mr) / 100) + s.shieldMagic) / (1 - s.dmgReduction), unit: 'effective HP', pool: (o) => o.hp || o.armor || o.mr || o.shieldMagic },
  'DPS with crit': { fn: (s) => dps(s, true), unit: 'DPS', pool: dpsRelevant },
  'DPS without crit': { fn: (s) => dps(s, false), unit: 'DPS', pool: dpsRelevant },
};
function dpsRelevant(o) { return o.ad || o.as || o.crit || o.onhitMagic || o.onhitPhys || o.adFromMaxHp || o.adFromMana || o.lethality || o.pctPen; }
function dps(s, useCrit) {
  const hp = CARRY.hp + s.hp, mana = CARRY.mana + s.mana + s.manaBonus;
  const ad = CARRY.ad + s.ad + s.adFromMaxHp * hp + s.adFromMana * mana;
  const as = Math.min(AS_CAP, CARRY.as * (1 + s.as));
  const c = useCrit ? Math.min(1, s.crit) : 0;
  const critMul = 1 + c * (1 + s.critMult);            // 200% crit => +1.0 ; Infinity Edge 250% => +1.5
  let armor = TARGET.armor * (1 - s.armorRed);
  armor = Math.max(0, armor * (1 - s.pctPen) - s.lethality);
  const physM = 100 / (100 + armor), magM = 100 / (100 + TARGET.mr);
  const perHit = ad * critMul * physM + s.onhitPhys * physM + s.onhitMagic * magM;
  return as * perHit;
}

// ---------- search ----------
function best(name, sc, size, topN) {
  const p = pool.filter(sc.pool);
  const top = [];
  const chosen = [];
  const usedGroups = new Set();
  function rec(start, boots) {
    if (chosen.length === size) {
      const s = sum(chosen); const v = sc.fn(s);
      if (top.length < topN || v > top[top.length - 1].v) {
        top.push({ v, items: chosen.map((x) => x.name), cost: s.cost });
        top.sort((a, b) => b.v - a.v || a.cost - b.cost); if (top.length > topN) top.pop();
      }
      return;
    }
    for (let i = start; i < p.length; i++) {
      const it = p[i];
      if (it.boots && boots) continue;
      if (it.group >= 0 && usedGroups.has(it.group)) continue;
      chosen.push(it); if (it.group >= 0) usedGroups.add(it.group);
      rec(i + 1, boots || it.boots);
      chosen.pop(); if (it.group >= 0) usedGroups.delete(it.group);
    }
  }
  rec(0, false);
  return top;
}

const out = { mode: STACKED ? 'stacked' : 'base', assumptions: { TANK, CARRY, TARGET, AS_CAP }, results: {} };
for (const [name, sc] of Object.entries(SCORERS)) {
  out.results[name] = { unit: sc.unit, poolSize: pool.filter(sc.pool).length, builds: {} };
  for (let n = 1; n <= 6; n++) out.results[name].builds[n] = best(name, sc, n, 3);
}
fs.writeFileSync(path.join(__dirname, STACKED ? 'best-builds.stacked.json' : 'best-builds.json'), JSON.stringify(out, null, 1));
for (const [name, r] of Object.entries(out.results)) {
  console.log(`\n== ${name} (${r.unit}; ${r.poolSize} candidate items) ==`);
  for (let n = 1; n <= 6; n++) { const b = r.builds[n][0]; console.log(n, Math.round(b.v * 10) / 10, b.cost + 'g', b.items.join(' + ')); }
}
