'use strict';
// Next-item engine. Pure functions, no I/O.
//
// Given a build (ordered steps), the player's inventory and gold, work out for every
// step what is already owned, what it still costs, and what to buy next.
// Progress is never stored: it is recomputed from the inventory on every tick.

function indexItems(list) {
  const m = new Map();
  for (const i of list) m.set(i.id, i);
  return m;
}

function poolFromInventory(inv) {
  const pool = new Map();
  for (const it of inv || []) {
    const id = Number(it.itemID);
    pool.set(id, (pool.get(id) || 0) + (Number(it.count) || 1));
  }
  return pool;
}

function makeNode(item, owned, remaining, children, combine) {
  return {
    id: item.id,
    name: item.name,
    icon: item.icon,
    cost: item.cost,
    owned,
    remaining,
    combine: combine || 0,
    children,
  };
}

// Resolve one item against the pool of owned items. Owned copies are consumed from the
// pool so the same component is never counted twice across steps.
function resolve(id, items, pool) {
  const item = items.get(id);
  if (!item) {
    return { id, name: 'Unknown item ' + id, icon: null, cost: 0, owned: false, remaining: 0, combine: 0, children: [], unknown: true };
  }
  const have = pool.get(id) || 0;
  if (have > 0) {
    pool.set(id, have - 1);
    return makeNode(item, true, 0, []);
  }
  if (!item.recipe || item.recipe.length === 0) {
    return makeNode(item, false, item.cost, []);
  }
  const children = item.recipe.map((r) => resolve(r, items, pool));
  const componentsCost = item.recipe.reduce((s, r) => s + (items.get(r) ? items.get(r).cost : 0), 0);
  const combine = Math.max(0, item.cost - componentsCost);
  const remaining = combine + children.reduce((s, c) => s + c.remaining, 0);
  return makeNode(item, false, remaining, children, combine);
}

// What should the player buy right now with `gold`?
function suggest(tree, gold) {
  if (tree.remaining <= gold) {
    return { kind: 'full', id: tree.id, name: tree.name, icon: tree.icon, cost: tree.remaining };
  }
  let best = null;
  (function walk(n) {
    for (const c of n.children) {
      if (c.owned) continue;
      if (c.remaining > 0 && c.remaining <= gold && (!best || c.remaining > best.cost)) {
        best = { kind: 'component', id: c.id, name: c.name, icon: c.icon, cost: c.remaining };
      }
      walk(c);
    }
  })(tree);
  if (best) return best;
  return { kind: 'save', need: tree.remaining - gold };
}

function expandSteps(build) {
  const out = [];
  for (const s of (build && build.steps) || []) {
    const n = Math.max(1, Math.min(20, Number(s.count) || 1));
    for (let i = 0; i < n; i++) out.push({ itemId: Number(s.itemId), note: s.note || '' });
  }
  return out;
}

function evaluate({ build, inventory, gold, items }) {
  const pool = poolFromInventory(inventory);
  const steps = expandSteps(build);
  const evaluated = steps.map((s, index) => {
    const tree = resolve(s.itemId, items, pool);
    return { index, itemId: s.itemId, note: s.note, done: tree.owned, remaining: tree.remaining, tree };
  });
  const nextIdx = evaluated.findIndex((s) => !s.done);
  const next = nextIdx === -1 ? null : evaluated[nextIdx];
  const queue = nextIdx === -1 ? [] : evaluated.slice(nextIdx + 1).filter((s) => !s.done);
  const doneCount = evaluated.filter((s) => s.done).length;
  return {
    total: evaluated.length,
    doneCount,
    complete: evaluated.length > 0 && nextIdx === -1,
    next,
    suggestion: next ? suggest(next.tree, gold || 0) : null,
    queue,
    steps: evaluated.map((s) => ({ index: s.index, itemId: s.itemId, done: s.done, remaining: s.remaining })),
  };
}

module.exports = { indexItems, poolFromInventory, resolve, suggest, evaluate, expandSteps };
