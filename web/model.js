'use strict';
// Item scoring model for the optimizer tab. Works in the browser (worker) and in Node (tests).
// One generic level-18 champion; every objective is "bigger is better".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JadeModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const BASE = { hp: 1900, armor: 80, mr: 45, ad: 90, as: 0.68, mana: 600 };
  const TARGET = { hp: 2500, armor: 100, mr: 60 };   // what damage is dealt to
  const AS_CAP = 2.5, CDR_CAP = 0.4;
  const OBJECTIVES = [
    { key: 'magicEHP', label: 'Magic EHP', hint: 'HP x (1 + MR/100), incl. Maw shield' },
    { key: 'armorEHP', label: 'Armor EHP', hint: 'HP x (1 + armor/100)' },
    { key: 'dpsCrit', label: 'DPS with crit', hint: 'Auto-attack damage per second, expected crits' },
    { key: 'dpsNoCrit', label: 'DPS without crit', hint: 'Auto-attack damage per second, crit ignored' },
    { key: 'ap', label: 'Ability Power', hint: 'Total AP (Rabadon\'s +30% included)' },
    { key: 'cdr', label: 'Cooldown Reduction', hint: 'Capped at 40%' },
  ];
  const BOOTS = new Set([773006, 773009, 773020, 773047, 773111, 773117, 773158]);
  const GROUPS = [[773068, 773073], [773206, 773207, 773209]];   // Sunfires; jungle items: one of each group
  const groupOf = new Map(); GROUPS.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));

  function create(ITEMS) {
    const byId = new Map(ITEMS.map((i) => [i.id, i]));
    const purchasable = (id) => byId.has(id) && byId.get(id).purchasable;
    const isFinal = (i) => i.purchasable && i.cost > 0 && !(i.into || []).some(purchasable) &&
      !(i.tags || []).some((t) => ['Consumable', 'Trinket', 'Vision'].includes(t)) &&
      !/Doran's/.test(i.name) && !/Ward|Potion|Elixir|Flask|Trinket|Recall|Biscuit/.test(i.name);
    const S = (i, k) => (i.stats && i.stats[k]) || 0;
    const base = (i) => {
      const cdr = /(\d+)% Cooldown Reduction/.exec(i.description || '');
      return {
        id: i.id, name: i.name, cost: i.cost, icon: i.icon, boots: BOOTS.has(i.id), group: groupOf.has(i.id) ? groupOf.get(i.id) : -1,
        hp: S(i, 'FlatHPPoolMod'), armor: S(i, 'FlatArmorMod'), mr: S(i, 'FlatSpellBlockMod'),
        ad: S(i, 'FlatPhysicalDamageMod'), ap: S(i, 'FlatMagicDamageMod'), as: S(i, 'PercentAttackSpeedMod'),
        crit: S(i, 'FlatCritChanceMod'), mana: S(i, 'FlatMPPoolMod'), cdr: cdr ? +cdr[1] / 100 : 0,
        lethality: 0, pctPen: 0, armorRed: 0, apMult: 0, onhitMagic: 0, onhitPhys: 0, hpMult: 1, shieldMagic: 0,
        critMult: 0, adFromMaxHp: 0, adFromMana: 0, sunfire: 0,
      };
    };
    // numbers the item text states but the stat blocks don't carry
    const PATCH = {
      773131: (o) => { o.as += 0.45; },                          // Sword of the Divine passive
      773071: (o) => { o.lethality += 10; o.armorRed = 0.25; },  // Black Cleaver
      773142: (o) => { o.lethality += 20; },                     // Youmuu's
      773035: (o) => { o.pctPen = 0.35; },                       // Last Whisper
      773031: (o) => { o.critMult = 0.5; },                      // Infinity Edge (250% crits)
      773091: (o) => { o.onhitMagic += 42; },                    // Wit's End
      773114: (o) => { o.onhitMagic += 15; },                    // Malady (value assumed)
      773109: (o) => { o.onhitMagic += 0.04 * TARGET.hp; },      // Madred's Bloodrazor
      773153: (o) => { o.onhitPhys += 0.05 * TARGET.hp * 0.6; }, // Blade of the Ruined King
      773178: (o) => { o.onhitMagic += 125 / 4; },               // Ionic Spark
      773087: (o) => { o.onhitMagic += 100 / 5; },               // Statikk Shiv (assumed)
      773124: (o) => { o.as += 0.32; },                          // Guinsoo's, 8 stacks
      773005: (o) => { o.adFromMaxHp = 0.015; },                 // Atma's Impaler
      773004: (o) => { o.adFromMana = 0.02; },                   // Manamune
      773026: (o) => { o.hpMult = 1.3; },                        // Guardian Angel revive
      773156: (o) => { o.shieldMagic = 400; },                   // Maw of Malmortius
      773089: (o) => { o.apMult = 0.3; },                        // Rabadon's Deathcap
      773068: (o) => { o.sunfire = 1; }, 773073: (o) => { o.sunfire = 1; },
    };
    const pool = ITEMS.filter(isFinal).map((i) => { const o = base(i); if (PATCH[i.id]) PATCH[i.id](o); return o; });

    function evaluate(items) {
      const s = { hp: 0, armor: 0, mr: 0, ad: 0, ap: 0, as: 0, crit: 0, mana: 0, cdr: 0, lethality: 0, onhitMagic: 0, onhitPhys: 0,
        shieldMagic: 0, adFromMaxHp: 0, adFromMana: 0, cost: 0, sunfire: 0, pctPen: 0, armorRed: 0, apMult: 0, hpMult: 1, critMult: 0 };
      for (const it of items) {
        for (const k of ['hp', 'armor', 'mr', 'ad', 'ap', 'as', 'crit', 'mana', 'cdr', 'lethality', 'onhitMagic', 'onhitPhys', 'shieldMagic', 'adFromMaxHp', 'adFromMana', 'cost', 'sunfire'])
          s[k] += it[k];
        for (const k of ['pctPen', 'armorRed', 'apMult', 'hpMult', 'critMult']) s[k] = Math.max(s[k], it[k]);
      }
      const hp = (BASE.hp + s.hp) * s.hpMult;
      const armorEHP = hp * (1 + (BASE.armor + s.armor) / 100);
      const magicEHP = hp * (1 + (BASE.mr + s.mr) / 100) + s.shieldMagic;
      const ad = BASE.ad + s.ad + s.adFromMaxHp * (BASE.hp + s.hp) + s.adFromMana * (BASE.mana + s.mana);
      const as = Math.min(AS_CAP, BASE.as * (1 + s.as));
      const armor = Math.max(0, TARGET.armor * (1 - s.armorRed) * (1 - s.pctPen) - s.lethality);
      const physM = 100 / (100 + armor), magM = 100 / (100 + TARGET.mr);
      const dps = (crit) => {
        const mul = 1 + Math.min(1, crit) * (1 + s.critMult);
        return as * (ad * mul * physM + s.onhitPhys * physM + s.onhitMagic * magM) + (s.sunfire ? 40 * magM : 0);
      };
      return { magicEHP, armorEHP, dpsCrit: dps(s.crit), dpsNoCrit: dps(0), ap: s.ap * (1 + s.apMult), cdr: Math.min(CDR_CAP, s.cdr), cost: s.cost };
    }
    return { pool, evaluate, OBJECTIVES, BASE, TARGET };
  }
  return { create, OBJECTIVES, BASE, TARGET };
});
