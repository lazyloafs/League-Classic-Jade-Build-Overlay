'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const M = require('../web/model.js');
const N = require('../web/search.js');
const items = require(path.join(__dirname, '..', 'data', 'jade-items.json')).items;
const model = M.create(items);
const keys = M.OBJECTIVES.map((o) => o.key);
const legal = (idx) => {
  const its = idx.map((i) => model.pool[i]);
  return new Set(idx).size === idx.length && its.filter((i) => i.boots).length <= 1 &&
    new Set(its.filter((i) => i.group >= 0).map((i) => i.group)).size === its.filter((i) => i.group >= 0).length;
};

test('pool has only finished, purchasable, non-consumable items', () => {
  assert.ok(model.pool.length > 60);
  assert.ok(!model.pool.some((i) => /Potion|Ward|Doran|Trinket/.test(i.name)));
});
test('evaluate: Randuin\'s Omen on the generic champion', () => {
  const v = model.evaluate([model.pool.find((i) => i.name === "Randuin's Omen")]);
  assert.equal(Math.round(v.armorEHP), Math.round((1900 + 500) * (1 + (80 + 70) / 100)));
  assert.equal(v.cost, 3125);
});
test('cooldown reduction is capped at 40%', () => {
  const cd = model.pool.filter((i) => i.cdr > 0).slice(0, 6);
  assert.ok(model.evaluate(cd).cdr <= 0.4);
});
test('search returns legal, non-dominated builds under the gold cap', () => {
  const front = N.run({ model, size: 6, maxGold: 15000, keys, pop: 80, gens: 40, seed: 3 });
  assert.ok(front.length > 5);
  for (const b of front) { assert.equal(b.idx.length, 6); assert.ok(legal(b.idx)); assert.ok(b.v.cost <= 15000); }
});
test('weights steer the ranking', () => {
  const front = N.run({ model, size: 6, maxGold: 20000, keys, pop: 120, gens: 60, seed: 5 });
  const zero = Object.fromEntries(keys.map((k) => [k, 0]));
  const ap = N.rank(model, front, { ...zero, ap: 100 }, 1, 6, 20000)[0];
  const tank = N.rank(model, front, { ...zero, armorEHP: 100 }, 1, 6, 20000)[0];
  assert.ok(ap.v.ap > tank.v.ap && tank.v.armorEHP > ap.v.armorEHP);
});
test('unreachable gold cap yields no builds', () => {
  assert.equal(N.run({ model, size: 6, maxGold: 500, keys, pop: 40, gens: 5, seed: 1 }).length, 0);
});
