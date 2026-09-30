'use strict';
// Shared item/scoring model used by tools/nsga2.js (the exhaustive tools/optimize.js keeps its own copy).
const fs = require('fs');
const path = require('path');
const ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'jade-items.json'), 'utf8')).items;

const TARGET = { hp: 2500, armor: 100, mr: 60 };   // what damage is dealt to
const AS_CAP = 2.5, CDR_CAP = 0.4;
const ARCH = {
  'AD build':   { kind: 'ad', hp: 1800, armor: 70, mr: 45, ad: 100, as: 0.70, mana: 500, defense: 'blend', sunfire: false },
  'AP build':   { kind: 'ap', hp: 1700, armor: 60, mr: 40, ad: 60,  as: 0.65, mana: 900, defense: 'blend', sunfire: false },
  'MR tank':    { kind: 'ad', hp: 2100, armor: 100, mr: 50, ad: 80, as: 0.65, mana: 400, defense: 'magic', sunfire: true },
  'Armor tank': { kind: 'ad', hp: 2100, armor: 100, mr: 50, ad: 80, as: 0.65, mana: 400, defense: 'physical', sunfire: true },
};
// AP caster: 4 spells on a 7 s base cooldown, each (80 + 0.7 AP) magic damage
const SPELL = { count: 4, cd: 7, base: 80, ratio: 0.7 };

const byId = new Map(ITEMS.map((i) => [i.id, i]));
const purchasable = (id) => byId.has(id) && byId.get(id).purchasable;
const isFinal = (i) => i.purchasable && i.cost > 0 && !(i.into || []).some(purchasable) &&
  !i.tags.some((t) => ['Consumable', 'Trinket', 'Vision'].includes(t)) &&
  !/Doran's/.test(i.name) && !/Ward|Potion|Elixir|Flask|Trinket|Recall|Biscuit/.test(i.name);
const BOOTS = new Set([773006, 773009, 773020, 773047, 773111, 773117, 773158]);
const GROUPS = [[773068, 773073], [773206, 773207, 773209]];   // Sunfires; jungle items: one each
const groupOf = new Map(); GROUPS.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
const S = (i, k) => (i.stats && i.stats[k]) || 0;

function base(i) {
  const cdr = /(\d+)% Cooldown Reduction/.exec(i.description || '');
  return {
    id: i.id, name: i.name, cost: i.cost, boots: BOOTS.has(i.id), group: groupOf.has(i.id) ? groupOf.get(i.id) : -1,
    hp: S(i, 'FlatHPPoolMod'), armor: S(i, 'FlatArmorMod'), mr: S(i, 'FlatSpellBlockMod'),
    ad: S(i, 'FlatPhysicalDamageMod'), ap: S(i, 'FlatMagicDamageMod'), as: S(i, 'PercentAttackSpeedMod'),
    crit: S(i, 'FlatCritChanceMod'), mana: S(i, 'FlatMPPoolMod'), cdr: cdr ? +cdr[1] / 100 : 0,
    lethality: 0, pctPen: 0, armorRed: 0, magPen: 0, magPctPen: 0, mrRed: 0, apMult: 0, burn: 0,
    onhitMagic: 0, onhitPhys: 0, hpMult: 1, shieldMagic: 0, critMult: 0, adFromMaxHp: 0, adFromMana: 0, dmgReduction: 0,
  };
}
const PATCH = {
  773131: (o) => { o.as += 0.45; },
  773071: (o) => { o.lethality += 10; o.armorRed = 0.25; },
  773142: (o) => { o.lethality += 20; },
  773035: (o) => { o.pctPen = 0.35; },
  773031: (o) => { o.critMult = 0.5; },
  773091: (o) => { o.onhitMagic += 42; },
  773114: (o) => { o.onhitMagic += 15; },
  773109: (o) => { o.onhitMagic += 0.04 * TARGET.hp; },
  773153: (o) => { o.onhitPhys += 0.05 * TARGET.hp * 0.6; },
  773178: (o) => { o.onhitMagic += 125 / 4; },
  773087: (o) => { o.onhitMagic += 100 / 5; },
  773124: (o) => { o.as += 0.32; },
  773005: (o) => { o.adFromMaxHp = 0.015; },
  773004: (o) => { o.adFromMana = 0.02; },
  773026: (o) => { o.hpMult = 1.3; },
  773156: (o) => { o.shieldMagic = 400; },
  773020: (o) => { o.magPen += 15; },                    // Sorcerer's Shoes
  773151: (o) => { o.magPen += 15; o.burn = 0.02 * TARGET.hp; },   // Liandry's: 15 pen + 2% current HP/s
  773135: (o) => { o.magPctPen = 0.35; },                // Void Staff
  773001: (o) => { o.mrRed = 20; },                      // Abyssal Scepter aura
  773089: (o) => { o.apMult = 0.3; },                    // Rabadon's
};
const pool = ITEMS.filter(isFinal).map((i) => { const o = base(i); if (PATCH[i.id]) PATCH[i.id](o); return o; });

function sum(items) {
  const s = { hp: 0, armor: 0, mr: 0, ad: 0, ap: 0, as: 0, crit: 0, mana: 0, cdr: 0, lethality: 0, magPen: 0, onhitMagic: 0, onhitPhys: 0,
    shieldMagic: 0, adFromMaxHp: 0, adFromMana: 0, burn: 0, cost: 0, pctPen: 0, armorRed: 0, magPctPen: 0, mrRed: 0, apMult: 0,
    hpMult: 1, critMult: 0, dmgReduction: 0 };
  for (const it of items) {
    for (const k of ['hp', 'armor', 'mr', 'ad', 'ap', 'as', 'crit', 'mana', 'cdr', 'lethality', 'magPen', 'onhitMagic', 'onhitPhys', 'shieldMagic', 'adFromMaxHp', 'adFromMana', 'burn', 'cost'])
      s[k] += it[k];
    for (const k of ['pctPen', 'armorRed', 'magPctPen', 'mrRed', 'apMult', 'hpMult', 'critMult', 'dmgReduction']) s[k] = Math.max(s[k], it[k]);
  }
  return s;
}

function defense(a, s) {
  const hp = (a.hp + s.hp) * s.hpMult, dr = 1 - s.dmgReduction;
  const phys = hp * (1 + (a.armor + s.armor) / 100) / dr;
  const magic = (hp * (1 + (a.mr + s.mr) / 100) + s.shieldMagic) / dr;
  return { phys, magic, value: a.defense === 'physical' ? phys : a.defense === 'magic' ? magic : 2 / (1 / phys + 1 / magic) };
}
function autoDps(a, s) {
  const hp = a.hp + s.hp, mana = a.mana + s.mana;
  const ad = a.ad + s.ad + s.adFromMaxHp * hp + s.adFromMana * mana;
  const as = Math.min(AS_CAP, a.as * (1 + s.as));
  const critMul = 1 + Math.min(1, s.crit) * (1 + s.critMult);
  const armor = Math.max(0, TARGET.armor * (1 - s.armorRed) * (1 - s.pctPen) - s.lethality);
  const physM = 100 / (100 + armor), magM = 100 / (100 + TARGET.mr);
  let d = as * (ad * critMul * physM + s.onhitPhys * physM + s.onhitMagic * magM);
  if (a.sunfire && s.sunfire) d += 40 * magM;
  return d;
}
function apDps(a, s) {
  const ap = s.ap * (1 + s.apMult);
  const mr = Math.max(0, (TARGET.mr - s.mrRed) * (1 - s.magPctPen) - s.magPen);
  const magM = 100 / (100 + mr);
  const cdr = Math.min(CDR_CAP, s.cdr);
  return (SPELL.count * (SPELL.base + SPELL.ratio * ap) / (SPELL.cd * (1 - cdr)) + s.burn) * magM;
}
function evaluate(name, items) {
  const a = ARCH[name]; const s = sum(items);
  s.sunfire = items.some((i) => i.id === 773068 || i.id === 773073) ? 1 : 0;
  const d = defense(a, s);
  return { defense: d.value, phys: d.phys, magic: d.magic, dps: a.kind === 'ap' ? apDps(a, s) : autoDps(a, s), cost: s.cost };
}
module.exports = { pool, ARCH, TARGET, evaluate, ITEMS };
