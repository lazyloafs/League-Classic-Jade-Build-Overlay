'use strict';
// Jade build editor. Plain JS, no build step.

const $ = (s, el = document) => el.querySelector(s);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}
async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(path + ' ' + r.status);
  return r.json();
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

let items = [], itemMap = new Map(), champions = [], builds = [], selections = {};
let cur = null;               // build being edited
let typeChip = 'all';           // single choice: all / consumables / boots / tier
const statChips = new Set();    // multi choice: stat tags
let matchAll = true;            // true: item must have every selected stat; false: any of them
let mock = null;
let live = null;              // last state from /api/stream
const tier = new Map();

const LANES = [['', 'Any lane'], ['TOP', 'Top'], ['JUNGLE', 'Jungle'], ['MIDDLE', 'Mid'], ['BOTTOM', 'Bot'], ['UTILITY', 'Support']];
const laneLabel = (l) => (LANES.find((x) => x[0] === (l || '')) || LANES[0])[1];
const selKey = (champion, lane) => norm(champion) + '|' + (lane || 'any');
const inOverlay = (b) => selections[selKey(b.champion, b.lane)] === b.id || (!b.lane && selections[norm(b.champion)] === b.id);

const TYPE_CHIPS = [['all', 'All'], ['Consumable', 'Consumables'], ['Boots', 'Boots'], ['t0', 'Basic'], ['t1', 'Epic'], ['t2', 'Legendary']];
const STAT_CHIPS = [
  ['Damage', 'Attack Dmg'], ['SpellDamage', 'Ability Power'], ['AttackSpeed', 'Atk Speed'], ['CriticalStrike', 'Crit'],
  ['LifeSteal', 'Life Steal'], ['SpellVamp', 'Spell Vamp'], ['OnHit', 'On-Hit'], ['ArmorPenetration', 'Armor Pen'],
  ['MagicPenetration', 'Magic Pen'], ['Health', 'Health'], ['HealthRegen', 'Health Regen'], ['Armor', 'Armor'],
  ['SpellBlock', 'Magic Resist'], ['Tenacity', 'Tenacity'], ['Mana', 'Mana'], ['ManaRegen', 'Mana Regen'],
  ['CooldownReduction', 'CDR'], ['NonbootsMovement', 'Move Speed'], ['Aura', 'Aura'], ['Slow', 'Slow'],
  ['Active', 'Active'], ['Vision', 'Vision'], ['Jungle', 'Jungle'], ['Lane', 'Lane'], ['GoldPer', 'Gold Income'],
];

function computeTiers() {
  const t = (id) => {
    if (tier.has(id)) return tier.get(id);
    const it = itemMap.get(id);
    const v = !it || !it.recipe.length ? 0 : 1 + Math.max(...it.recipe.map(t));
    tier.set(id, v);
    return v;
  };
  items.forEach((i) => t(i.id));
}

// ---------- tooltip ----------
const tip = $('#tip');
function showTip(it, evt) {
  tip.replaceChildren(h('div', { class: 't', text: it.name + ' — ' + it.cost + 'g' }));
  if (it.description) tip.append(h('div', { class: 'd', text: it.description.slice(0, 460) }));
  if (it.recipe.length) {
    tip.append(h('div', { class: 'r' }, 'Builds from (+' + (it.combineCost || 0) + 'g to combine):',
      h('div', { class: 'rec' }, it.recipe.map((id) => { const c = itemMap.get(id); return c ? h('img', { src: c.icon, alt: c.name, title: c.name }) : null; }))));
  }
  const into = (it.into || []).map((id) => itemMap.get(id)).filter(Boolean);
  if (into.length) tip.append(h('div', { class: 'r', text: 'Builds into: ' + into.map((i) => i.name).join(', ') }));
  tip.hidden = false;
  moveTip(evt);
}
function moveTip(evt) {
  const pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
const hideTip = () => { tip.hidden = true; };
function hoverable(el, it) {
  el.addEventListener('mouseenter', (e) => showTip(it, e));
  el.addEventListener('mousemove', moveTip);
  el.addEventListener('mouseleave', hideTip);
  return el;
}

// ---------- builds list ----------
function renderChampSelects() {
  const names = champions.map((c) => c.name);
  const fill = (sel, withAll, value) => {
    sel.replaceChildren(...(withAll ? [h('option', { value: '', text: 'All champions' })] : []), ...names.map((n) => h('option', { value: n, text: n })));
    if (value != null) sel.value = value;
  };
  fill($('#champFilter'), true, '');
  fill($('#buildChamp'), false, names[0]);
  fill($('#mockChamp'), false, mock && mock.champion);
  for (const sel of [$('#buildLane'), $('#dupLane'), $('#mockLane')]) {
    const keep = sel.id === 'dupLane';
    sel.replaceChildren(...(keep ? [h('option', { value: 'keep', text: 'Keep each build’s lane' })] : []), ...LANES.map(([v, t]) => h('option', { value: v, text: sel.id === 'mockLane' && !v ? 'None reported' : t })));
  }
  $('#mockLane').value = (mock && mock.lane) || '';
}

function renderBuildList() {
  const f = $('#champFilter').value;
  const list = builds.filter((b) => !f || norm(b.champion) === norm(f));
  const ul = $('#buildList');
  ul.replaceChildren(...list.map((b) => {
    const li = h('li', { class: cur && cur.id === b.id ? 'sel' : '', onclick: () => selectBuild(b.id) },
      inOverlay(b) ? h('span', { class: 'badge', text: 'In overlay' }) : null,
      h('div', { class: 'n', text: b.name }),
      h('div', { class: 'm' }, b.champion + ' · ', b.lane ? h('span', { class: 'lane', text: laneLabel(b.lane) + ' · ' }) : null, b.steps.length + ' steps'));
    return li;
  }));
  if (!list.length) ul.append(h('li', { class: 'empty small', text: 'No builds yet.' }));
}

function selectBuild(id) {
  cur = JSON.parse(JSON.stringify(builds.find((b) => b.id === id) || null));
  renderBuildList();
  renderEditor();
}

async function newBuild() {
  const f = $('#champFilter').value || (champions[0] && champions[0].name) || '';
  const name = 'New build';
  const id = 'build-' + Date.now().toString(36);
  const b = await api('/api/builds/' + id, 'PUT', { name, champion: f, steps: [], notes: '' });
  builds.push(b);
  selectBuild(id);
  $('#buildName').focus();
  $('#buildName').select();
}

// ---------- editor ----------
function total() {
  return cur.steps.reduce((s, st) => s + ((itemMap.get(st.itemId) || {}).cost || 0) * st.count, 0);
}

function renderEditor() {
  $('#editorEmpty').hidden = !!cur;
  $('#editorBody').hidden = !cur;
  if (!cur) return;
  $('#buildName').value = cur.name;
  $('#buildChamp').value = cur.champion;
  $('#buildLane').value = cur.lane || '';
  $('#buildNotes').value = cur.notes || '';
  const c = champions.find((x) => x.name === cur.champion);
  const img = $('#champIcon');
  if (c && c.icon) img.src = c.icon; else img.removeAttribute('src');
  renderSteps();
}

let dragFrom = -1;
function renderSteps() {
  const ol = $('#steps');
  ol.replaceChildren(...cur.steps.map((st, i) => {
    const it = itemMap.get(st.itemId);
    if (!it) return h('li', { class: 'step' }, h('span'), h('span'), h('div', { text: 'Unknown item ' + st.itemId }), h('span'));
    const noteInput = h('input', { class: 'input note', placeholder: 'Note (e.g. "back after first clear")', value: st.note || '', maxlength: 120 });
    noteInput.addEventListener('input', () => { st.note = noteInput.value; scheduleSave(); });
    const li = h('li', { class: 'step', draggable: 'true' },
      hoverable(h('img', { src: it.icon, alt: it.name }), it),
      h('div', {},
        h('div', { class: 'nm', text: it.name }),
        h('div', { class: 'sub', text: it.cost + 'g' + (it.recipe.length ? ' · combine ' + it.combineCost + 'g' : '') }),
        noteInput),
      h('div', { class: 'ctrl' },
        h('button', { title: 'Fewer', onclick: () => bump(i, -1) }, '−'),
        h('span', { class: 'cnt', text: '×' + st.count }),
        h('button', { title: 'More', onclick: () => bump(i, 1) }, '+'),
        h('button', { title: 'Move up', onclick: () => move(i, i - 1) }, '▲'),
        h('button', { title: 'Move down', onclick: () => move(i, i + 1) }, '▼'),
        h('button', { title: 'Remove', onclick: () => { cur.steps.splice(i, 1); changed(); } }, '✕')));
    li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragFrom = -1; });
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('over'); });
    li.addEventListener('dragleave', () => li.classList.remove('over'));
    li.addEventListener('drop', (e) => { e.preventDefault(); li.classList.remove('over'); if (dragFrom >= 0) move(dragFrom, i); });
    return li;
  }));
  $('#stepsEmpty').hidden = cur.steps.length > 0;
  $('#totalCost').textContent = total().toLocaleString();
  $('#stepCount').textContent = cur.steps.reduce((s, x) => s + x.count, 0);
}

function move(from, to) {
  if (to < 0 || to >= cur.steps.length || from === to) return;
  const [s] = cur.steps.splice(from, 1);
  cur.steps.splice(to, 0, s);
  changed();
}
function bump(i, d) {
  const s = cur.steps[i];
  s.count = Math.max(1, Math.min(20, s.count + d));
  changed();
}
function addStep(id) {
  if (!cur) { $('#saveState').textContent = ''; return; }
  const it = itemMap.get(id);
  const last = cur.steps[cur.steps.length - 1];
  const stack = it.tags.includes('Consumable');
  const existing = stack && cur.steps.find((s) => s.itemId === id);
  if (existing) existing.count = Math.min(20, existing.count + 1);
  else cur.steps.push({ itemId: id, count: 1, note: '' });
  changed();
}

function changed() {
  renderSteps();
  scheduleSave();
}

const save = async () => {
  if (!cur) return;
  const b = await api('/api/builds/' + cur.id, 'PUT', cur);
  const i = builds.findIndex((x) => x.id === b.id);
  if (i >= 0) builds[i] = b; else builds.push(b);
  $('#saveState').textContent = 'Saved ✓';
  renderBuildList();
};
const debouncedSave = debounce(() => save().catch((e) => { $('#saveState').textContent = 'Save failed'; console.error(e); }), 500);
function scheduleSave() { $('#saveState').textContent = 'Saving…'; debouncedSave(); }

// ---------- duplicate to other champions / lanes ----------
const dupPick = new Set();
function openDuplicate() {
  if (!cur) return;
  dupPick.clear();
  $('#dupName').textContent = cur.name;
  $('#dupSearch').value = '';
  $('#dupLane').value = 'keep';
  renderDupList();
  $('#dupDialog').showModal();
}
function renderDupList() {
  const q = norm($('#dupSearch').value);
  $('#dupList').replaceChildren(...champions.filter((c) => !q || norm(c.name).includes(q)).map((c) => {
    const box = h('input', { type: 'checkbox', checked: dupPick.has(c.name) });
    box.onchange = () => { box.checked ? dupPick.add(c.name) : dupPick.delete(c.name); $('#dupCount').textContent = dupPick.size + ' selected'; };
    return h('label', {}, box, c.name + (c.name === cur.champion ? ' (this one)' : ''));
  }));
  $('#dupCount').textContent = dupPick.size + ' selected';
}
async function duplicateBuild() {
  if (!cur || !dupPick.size) { $('#dupCount').textContent = 'Pick at least one champion.'; return; }
  await save();   // include any edits still waiting to save
  const lane = $('#dupLane').value === 'keep' ? (cur.lane || '') : $('#dupLane').value;
  let n = 0, first = null;
  for (const champion of [...dupPick]) {
    const sameChamp = norm(champion) === norm(cur.champion);
    // Same champion on another lane: name it after the lane so the copy is easy to tell apart.
    const suffix = !sameChamp ? '' : lane === (cur.lane || '') ? ' (copy)' : lane ? ' (' + laneLabel(lane) + ')' : ' (any lane)';
    const id = 'build-' + Date.now().toString(36) + (n++).toString(36);
    const b = await api('/api/builds/' + id, 'PUT', { name: cur.name + suffix, champion, lane, notes: cur.notes || '',
      steps: cur.steps.map((s) => ({ itemId: s.itemId, count: s.count, note: s.note || '' })) });
    builds.push(b);
    first = first || b;
  }
  $('#dupDialog').close();
  const f = $('#champFilter');
  if (f.value && [...dupPick].some((c) => norm(c) !== norm(f.value))) f.value = '';   // make sure the new copies are visible in the list
  selectBuild(first.id);   // open the first copy so it's obvious what was made
  $('#saveState').textContent = n === 1 ? 'Copy created ✓ (now editing it)' : n + ' copies created ✓ (editing the first)';
}

// ---------- item catalog ----------
function filterItems() {
  const q = $('#search').value.trim().toLowerCase();
  return items
    .filter((i) => {
      if (q && !i.name.toLowerCase().includes(q)) return false;
      if (typeChip === 't0' && !(tier.get(i.id) === 0 && !i.tags.includes('Consumable'))) return false;
      if (typeChip === 't1' && tier.get(i.id) !== 1) return false;
      if (typeChip === 't2' && !(tier.get(i.id) >= 2)) return false;
      if ((typeChip === 'Consumable' || typeChip === 'Boots') && !i.tags.includes(typeChip)) return false;
      if (statChips.size) {
        const sel = [...statChips];
        return matchAll ? sel.every((s) => i.tags.includes(s)) : sel.some((s) => i.tags.includes(s));
      }
      return true;
    })
    .sort((a, b) => tier.get(a.id) - tier.get(b.id) || a.cost - b.cost || a.name.localeCompare(b.name));
}
function renderGrid() {
  const list = filterItems();
  $('#grid').replaceChildren(...list.map((it) =>
    hoverable(h('button', { title: '', 'aria-label': it.name, onclick: () => addStep(it.id) },
      h('img', { src: it.icon, alt: it.name, loading: 'lazy' }), h('span', { class: 'c', text: it.cost })), it)));
  if (!list.length) $('#grid').append(h('div', { class: 'empty small', text: 'No items match. Try “match any” or clear a stat.' }));
  const count = $('#resultCount');
  if (count) count.textContent = list.length + ' item' + (list.length === 1 ? '' : 's');
}
function refilter() { renderChips(); renderGrid(); }
function renderChips() {
  const typeRow = h('div', { class: 'chiprow' }, TYPE_CHIPS.map(([k, label]) =>
    h('button', { class: 'chip' + (typeChip === k ? ' on' : ''), onclick: () => { typeChip = k; refilter(); } }, label)));

  const statRow = h('div', { class: 'chiprow' }, STAT_CHIPS.map(([k, label]) =>
    h('button', {
      class: 'chip stat' + (statChips.has(k) ? ' on' : ''),
      'aria-pressed': statChips.has(k) ? 'true' : 'false',
      title: 'Click to add or remove this stat',
      onclick: () => { statChips.has(k) ? statChips.delete(k) : statChips.add(k); refilter(); },
    }, label)));

  const controls = h('div', { class: 'chiprow ctl' },
    h('span', { class: 'lbl', text: 'Stats:' }),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Match mode' },
      h('button', { class: matchAll ? 'on' : '', title: 'Items must have every selected stat', onclick: () => { matchAll = true; refilter(); } }, 'Match all'),
      h('button', { class: !matchAll ? 'on' : '', title: 'Items with at least one selected stat', onclick: () => { matchAll = false; refilter(); } }, 'Match any')),
    statChips.size ? h('button', { class: 'chip clear', onclick: () => { statChips.clear(); refilter(); } }, 'Clear stats (' + statChips.size + ')') : null,
    h('span', { id: 'resultCount', class: 'count' }));

  $('#chips').replaceChildren(typeRow, controls, statRow);
}

// ---------- test tab ----------
const pushMock = debounce(() => api('/api/mock', 'PUT', mock).catch(console.error), 150);
function renderMock() {
  $('#mockEnabled').checked = mock.enabled;
  $('#mockChamp').value = mock.champion;
  $('#mockLane').value = mock.lane || '';
  $('#mockGold').value = mock.gold;
  $('#mockGoldRange').value = Math.min(6000, mock.gold);
  $('#mockTime').value = mock.gameTime;
  $('#mockDead').checked = mock.isDead;
  $('#mockInv').replaceChildren(...mock.items.map((inv, i) => {
    const it = itemMap.get(inv.itemID);
    return h('span', { class: 'invchip' },
      it ? h('img', { src: it.icon, alt: '' }) : null,
      (it ? it.name : inv.itemID) + (inv.count > 1 ? ' ×' + inv.count : ''),
      h('button', { title: 'Remove', onclick: () => { mock.items.splice(i, 1); renderMock(); pushMock(); } }, '✕'));
  }));
}
function renderReadout() {
  const s = live;
  const out = $('#mockReadout');
  if (!s || !s.connected) { out.textContent = 'No game data.'; return; }
  const lines = [`Champion: ${s.champion}   Gold: ${s.gold}   Mode: ${s.mode}${s.autoShop ? '   (shop-ready)' : ''}`];
  lines.push('Lane: ' + (s.laneLabel ? s.laneLabel + (s.laneSource === 'manual' ? ' (picked by hand)' : ' (from the game)') : 'not reported' + (s.laneOptions && s.laneOptions.length > 1 ? ' (press F7 to switch)' : '')));
  if (!s.build) lines.push('Build: none for this champion — create one on the Builds tab.');
  else if (s.eval) {
    const e = s.eval;
    lines.push(`Build: ${s.build.name}  (${e.doneCount}/${e.total} done)`);
    if (e.complete) lines.push('Build complete!');
    else if (e.next) {
      lines.push(`Next: ${e.next.tree.name} — ${e.next.remaining}g remaining`);
      const g = e.suggestion;
      if (g.kind === 'full') lines.push(`Buy now: ${g.name} (${g.cost}g)`);
      else if (g.kind === 'component') lines.push(`Buy now: ${g.name} (${g.cost}g) toward ${e.next.tree.name}`);
      else lines.push(`Save up: ${g.need}g more`);
      if (e.queue.length) lines.push('Then: ' + e.queue.slice(0, 5).map((q) => q.tree.name).join(' → '));
    }
  }
  out.textContent = lines.join('\n');
}
function wireMock() {
  const set = (patch) => { Object.assign(mock, patch); renderMock(); pushMock(); };
  $('#mockEnabled').onchange = (e) => set({ enabled: e.target.checked });
  $('#mockChamp').onchange = (e) => set({ champion: e.target.value });
  $('#mockLane').onchange = (e) => set({ lane: e.target.value });
  $('#mockGold').oninput = (e) => set({ gold: Number(e.target.value) || 0 });
  $('#mockGoldRange').oninput = (e) => set({ gold: Number(e.target.value) });
  $('#mockTime').oninput = (e) => set({ gameTime: Number(e.target.value) || 0 });
  $('#mockDead').onchange = (e) => set({ isDead: e.target.checked });
  const add = () => {
    const name = $('#mockItemSearch').value.trim().toLowerCase();
    const it = items.find((i) => i.name.toLowerCase() === name);
    if (!it) return;
    const ex = mock.items.find((x) => x.itemID === it.id);
    if (ex) ex.count++; else mock.items.push({ itemID: it.id, count: 1 });
    $('#mockItemSearch').value = '';
    renderMock(); pushMock();
  };
  $('#mockAdd').onclick = add;
  $('#mockItemSearch').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $('#itemNames').replaceChildren(...items.map((i) => h('option', { value: i.name })));
}

// ---------- live status ----------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = (m) => {
    live = JSON.parse(m.data);
    const box = $('#status');
    box.className = 'status' + (live.connected ? (live.mock ? ' sim' : ' live') : '');
    $('#statusText').textContent = !live.connected ? 'Waiting for a match…'
      : live.mock ? 'Simulated game · ' + live.champion
      : 'In game · ' + live.champion + ' (' + live.mode + ')' + (live.laneLabel ? ' · ' + live.laneLabel : '');
    renderReadout();
  };
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  $('#view-builds').hidden = name !== 'builds';
  $('#view-test').hidden = name !== 'test';
  $('#view-optimize').hidden = name !== 'optimize';
  if (name === 'optimize' && window.openOptimizer) window.openOptimizer();
  location.hash = name;
}

// ---------- boot ----------
async function init() {
  [items, champions, builds, selections, mock] = await Promise.all([
    api('/api/items'), api('/api/champions').then((c) => c.champions || c), api('/api/builds'), api('/api/selections'), api('/api/mock'),
  ]);
  itemMap = new Map(items.map((i) => [i.id, i]));
  champions.sort((a, b) => a.name.localeCompare(b.name));
  computeTiers();
  renderChampSelects();
  renderChips();
  renderGrid();
  renderBuildList();
  renderEditor();
  renderMock();
  wireMock();
  connectStream();

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('#champFilter').onchange = renderBuildList;
  $('#newBuild').onclick = () => newBuild().catch(console.error);
  $('#search').oninput = renderGrid;
  $('#buildName').oninput = (e) => { cur.name = e.target.value; scheduleSave(); };
  $('#buildNotes').oninput = (e) => { cur.notes = e.target.value; scheduleSave(); };
  $('#buildLane').onchange = (e) => { cur.lane = e.target.value; scheduleSave(); renderBuildList(); };
  $('#dupBuild').onclick = () => openDuplicate();
  $('#dupSearch').oninput = renderDupList;
  $('#dupCancel').onclick = () => $('#dupDialog').close();
  $('#dupGo').onclick = () => duplicateBuild().catch((e) => { $('#dupCount').textContent = 'Failed: ' + e.message; });
  $('#buildChamp').onchange = (e) => {
    cur.champion = e.target.value;
    const c = champions.find((x) => x.name === cur.champion);
    if (c && c.icon) $('#champIcon').src = c.icon;
    scheduleSave();
  };
  $('#useBuild').onclick = async () => {
    await save();
    await api('/api/select', 'POST', { champion: cur.champion, lane: cur.lane || '', buildId: cur.id });
    selections = await api('/api/selections');
    renderBuildList();
    $('#saveState').textContent = 'In overlay ✓';
  };
  $('#deleteBuild').onclick = async () => {
    if (!confirm('Delete "' + cur.name + '"?')) return;
    await api('/api/builds/' + cur.id, 'DELETE');
    builds = builds.filter((b) => b.id !== cur.id);
    cur = null;
    selections = await api('/api/selections');
    renderBuildList();
    renderEditor();
  };
  showTab(location.hash === '#test' ? 'test' : location.hash === '#optimize' ? 'optimize' : 'builds');
}
init().catch((e) => { document.body.prepend(h('pre', { text: 'Failed to load: ' + e.message })); console.error(e); });
