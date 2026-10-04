'use strict';
// Overlay strip renderer. Runs inside Electron (window.jadeBridge exists) or in a plain
// browser tab for testing (?embed=1).

const bridge = window.jadeBridge || null;
const embed = new URLSearchParams(location.search).has('embed');
const strip = document.getElementById('strip');

let state = null;
let manualShop = false;
let calibrating = false;
let pinned = null;         // { name, until }
let toastText = '';
let toastUntil = 0;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}

function copyName(name) {
  if (bridge) bridge.copy(name);
  else if (navigator.clipboard) navigator.clipboard.writeText(name).catch(() => {});
  pinned = { name, until: Date.now() + 8000 };
  toastText = 'Copied “' + name + '” — paste it in the shop search';
  toastUntil = Date.now() + 3500;
  render();
  setTimeout(render, 3600);
  setTimeout(render, 8100);
}

const fmt = (v) => Math.round(v).toLocaleString();

// "Gold needed" block: what is still missing, and your gold against the item's cost.
// `remaining` already subtracts components you own; `tree.cost` is the full price.
function goldNeeded(n, have) {
  const need = Math.max(0, n.remaining - have);
  const partsOwned = n.remaining < n.tree.cost;
  return h('div', { class: 'gn ' + (need ? 'short' : 'ok') },
    h('div', { class: 'gn-lbl', text: 'GOLD NEEDED' }),
    h('div', { class: 'gn-val', text: need ? fmt(need) + 'g' : '✓ Enough' }),
    h('div', { class: 'gn-sub', text: fmt(have) + ' / ' + fmt(n.remaining) + 'g' }),
    partsOwned ? h('div', { class: 'gn-tot', text: fmt(n.tree.cost) + 'g total · owned parts −' + fmt(n.tree.cost - n.remaining) }) : null);
}

const shopReady = () => !!state && state.connected && (state.autoShop || manualShop);
const isPinned = (name) => pinned && pinned.name === name && Date.now() < pinned.until;

// Lane tag next to the build name. Click it (or press the lane hotkey) to switch lane builds when the game doesn't report the lane.
function laneChip() {
  const locked = state.laneSource === 'api' || state.laneSource === 'spell';
  const many = (state.laneOptions || []).length > 1;
  const text = state.laneLabel || 'Any lane';
  const note = locked ? ' (auto)' : '';
  const title = locked ? 'Lane detected from the game' : many ? 'Click to switch lane build' : 'Add lane builds in the web app';
  return h('span', {
    class: 'lane' + (state.laneLabel ? ' set' : '') + (!locked && many ? ' clickable' : ''),
    title,
    onclick: !locked && many ? () => fetch('/api/lane/cycle', { method: 'POST' }).catch(() => {}) : null,
    text: text + note,
  });
}

function render() {
  strip.classList.toggle('calibrating', calibrating);
  strip.classList.toggle('dim', !state || !state.connected);
  const kids = [];

  if (!state || !state.connected) {
    kids.push(h('div', { class: 'hdr' }, h('div', { class: 'champ', text: 'Jade' })));
    kids.push(h('div', { class: 'banner' }, 'Waiting for a ', h('b', { text: 'League Classic' }), ' match…'));
    return paint(kids);
  }

  kids.push(h('div', { class: 'hdr' },
    h('div', { class: 'champ', text: state.champion || '—' }),
    h('div', { class: 'gold', text: state.gold.toLocaleString() }),
    h('div', { class: 'bld' }, laneChip(), state.build ? state.build.name : 'No build')));

  if (!state.isJade) {
    kids.push(h('div', { class: 'banner' }, 'This isn’t League Classic (mode: ', h('b', { text: state.mode || '?' }), ').'));
  }

  if (state.build && state.lane && !state.laneMatch) {
    kids.push(h('div', { class: 'banner' }, 'No ', h('b', { text: state.laneLabel }), ' build for this champion yet. Showing the closest one.'));
  }
  const e = state.eval;
  if (!state.build) {
    kids.push(h('div', { class: 'banner' }, 'No build for ', h('b', { text: state.champion || 'this champion' }), '. Make one in the web app.'));
  } else if (e && e.complete) {
    kids.push(h('div', { class: 'banner done', text: '✓ Build complete' }));
  } else if (e && e.next) {
    const clickable = shopReady();
    const n = e.next;
    const sug = e.suggestion;
    const afford = sug.kind === 'full';
    const target = sug.kind === 'save' ? n.tree.name : sug.name;
    const pct = Math.max(0, Math.min(100, Math.round((state.gold / Math.max(1, n.remaining)) * 100)));

    let sugEl;
    if (sug.kind === 'full') sugEl = h('div', { class: 'sug' }, 'Ready: ', h('b', { text: 'buy now (' + sug.cost + 'g)' }));
    else if (sug.kind === 'component') sugEl = h('div', { class: 'sug' }, 'Buy ', h('b', { text: sug.name }), ' (' + sug.cost + 'g)');
    else sugEl = null; // the "Gold needed" block already says how much is missing

    const card = h('div', {
      class: 'card' + (afford ? ' afford' : '') + (clickable ? ' clickable' : '') + (isPinned(target) ? ' pinned' : ''),
      title: clickable ? 'Click to copy “' + target + '”' : 'Go to the shop to buy',
      onclick: clickable ? () => copyName(target) : null,
    },
      h('div', { class: 'lbl', text: 'NEXT' }),
      n.tree.icon ? h('img', { class: 'big', src: n.tree.icon, alt: '' }) : null,
      h('div', { class: 'nm', text: n.tree.name }),
      goldNeeded(n, state.gold),
      h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })),
      n.tree.children.length
        ? h('div', { class: 'parts' }, n.tree.children.map((c) => h('img', { class: c.owned ? 'own' : '', src: c.icon, alt: c.name, title: c.name + (c.owned ? ' (owned)' : ' — ' + c.remaining + 'g') })))
        : null,
      sugEl);
    kids.push(card);

    if (e.queue.length) {
      kids.push(h('div', { class: 'then', text: 'THEN' }));
      kids.push(h('div', { class: 'queue' }, e.queue.slice(0, 9).map((q) =>
        h('div', {
          class: 'tile' + (clickable ? ' clickable' : '') + (isPinned(q.tree.name) ? ' pinned' : ''),
          title: q.tree.name + ' — ' + q.remaining + 'g' + (clickable ? ' (click to copy)' : ''),
          onclick: clickable ? () => copyName(q.tree.name) : null,
        }, q.tree.icon ? h('img', { src: q.tree.icon, alt: q.tree.name }) : null, h('span', { text: q.remaining + 'g' })))));
    }
  }

  if (calibrating) kids.push(h('div', { class: 'help', text: 'Alt+Arrows move · Alt+Shift+Arrows resize · press the calibrate key to save' }));

  const total = e ? e.total : 0;
  kids.push(h('div', { class: 'foot' },
    h('span', { text: e ? e.doneCount + '/' + total : '' }),
    shopReady() ? h('span', { class: 'pill', text: manualShop ? 'SHOP (manual)' : 'SHOP' }) : h('span')));

  if (Date.now() < toastUntil) kids.push(h('div', { class: 'toast', text: toastText }));
  paint(kids);
}

function paint(kids) {
  strip.replaceChildren(...kids);
  // A re-render can remove the element under the mouse without firing mouseout.
  if (bridge) bridge.setInteractive(calibrating || !!document.querySelector('.clickable:hover'));
}

// ---- input ----
if (bridge) {
  document.addEventListener('mouseover', (ev) => { if (ev.target.closest && ev.target.closest('.clickable')) bridge.setInteractive(true); });
  document.addEventListener('mouseout', (ev) => {
    if (calibrating) return;
    if (ev.target.closest && ev.target.closest('.clickable') && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.clickable'))) bridge.setInteractive(false);
  });
  bridge.onToggleShop(() => { manualShop = !manualShop; render(); });
  bridge.onCalibrate((on) => { calibrating = !!on; render(); });
} else if (embed) {
  // In the browser preview, press S to toggle manual shop mode.
  document.addEventListener('keydown', (ev) => { if (ev.key === 's' || ev.key === 'S') { manualShop = !manualShop; render(); } });
}

// ---- data ----
const es = new EventSource('/api/stream');
es.onmessage = (m) => { state = JSON.parse(m.data); render(); };
es.onerror = () => { state = null; render(); };
render();
