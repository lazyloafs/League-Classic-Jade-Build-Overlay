'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { indexItems, evaluate, suggest, resolve, poolFromInventory } = require('../server/engine');

const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'jade-items.json'), 'utf8')).items;
const items = indexItems(list);
const byName = (n) => list.find((i) => i.name === n);

const SHEEN = byName('Sheen');
const WARMOGS = byName("Warmog's Armor");
const SUNFIRE = byName('Sunfire Cape');
const BELT = byName("Giant's Belt");

const inv = (...ids) => ids.map((id) => ({ itemID: id, count: 1 }));
const build = (...steps) => ({ steps: steps.map((s) => (typeof s === 'number' ? { itemId: s } : s)) });

test('data sanity: every recipe part exists and combine cost is not negative', () => {
  for (const i of list) {
    for (const r of i.recipe) assert.ok(items.has(r), i.name + ' -> ' + r);
    if (i.recipe.length) {
      const c = i.cost - i.recipe.reduce((s, r) => s + items.get(r).cost, 0);
      assert.ok(c >= 0, i.name + ' combine ' + c);
    }
  }
});

test('nothing owned: remaining equals full item cost', () => {
  const r = evaluate({ build: build(SHEEN.id), inventory: [], gold: 0, items });
  assert.strictEqual(r.next.remaining, SHEEN.cost);
  assert.strictEqual(r.doneCount, 0);
});

test('owning one component reduces the remaining cost by its price', () => {
  const part = items.get(SHEEN.recipe[0]);
  const r = evaluate({ build: build(SHEEN.id), inventory: inv(part.id), gold: 0, items });
  assert.strictEqual(r.next.remaining, SHEEN.cost - part.cost);
});

test('owning all components leaves only the combine cost', () => {
  const r = evaluate({ build: build(SHEEN.id), inventory: inv(...SHEEN.recipe), gold: 0, items });
  assert.strictEqual(r.next.remaining, SHEEN.combineCost);
});

test('finished item is done and next moves to the following step', () => {
  const r = evaluate({ build: build(SHEEN.id, WARMOGS.id), inventory: inv(SHEEN.id), gold: 0, items });
  assert.strictEqual(r.doneCount, 1);
  assert.strictEqual(r.next.itemId, WARMOGS.id);
});

test('one component is not counted for two steps', () => {
  // Warmog's and Sunfire Cape both need a Giant's Belt; we own one.
  const r = evaluate({ build: build(WARMOGS.id, SUNFIRE.id), inventory: inv(BELT.id), gold: 0, items });
  const warmogs = r.next;
  assert.strictEqual(warmogs.remaining, WARMOGS.cost - BELT.cost);
  const sunfire = r.queue[0];
  assert.strictEqual(sunfire.remaining, SUNFIRE.cost); // belt already used by Warmog's
});

test('step count expands into repeated steps', () => {
  const potion = byName('Total Biscuit of Rejuvenation');
  const r = evaluate({ build: build({ itemId: potion.id, count: 3 }), inventory: [{ itemID: potion.id, count: 2 }], gold: 0, items });
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.doneCount, 2);
});

test('suggest: full item when gold covers the remaining cost', () => {
  const r = evaluate({ build: build(SHEEN.id), inventory: [], gold: SHEEN.cost, items });
  assert.strictEqual(r.suggestion.kind, 'full');
  assert.strictEqual(r.suggestion.cost, SHEEN.cost);
});

test('suggest: biggest affordable component when the full item is too expensive', () => {
  const parts = SHEEN.recipe.map((id) => items.get(id));
  const gold = Math.max(...parts.map((p) => p.cost));
  const r = evaluate({ build: build(SHEEN.id), inventory: [], gold, items });
  assert.strictEqual(r.suggestion.kind, 'component');
  assert.strictEqual(r.suggestion.cost, gold);
});

test('suggest: save up when nothing is affordable', () => {
  const r = evaluate({ build: build(SHEEN.id), inventory: [], gold: 10, items });
  assert.strictEqual(r.suggestion.kind, 'save');
  assert.strictEqual(r.suggestion.need, SHEEN.cost - 10);
});

test('complete build has no next item', () => {
  const r = evaluate({ build: build(SHEEN.id), inventory: inv(SHEEN.id), gold: 0, items });
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.next, null);
});

test('empty build is handled', () => {
  const r = evaluate({ build: build(), inventory: [], gold: 0, items });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.next, null);
  assert.strictEqual(r.complete, false);
});

test('resolve does not mutate a fresh pool between separate calls', () => {
  const pool = poolFromInventory(inv(BELT.id));
  resolve(WARMOGS.id, items, pool);
  assert.strictEqual(pool.get(BELT.id), 0);
});
