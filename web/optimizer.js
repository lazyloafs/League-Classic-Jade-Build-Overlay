'use strict';
// Optimizer tab: sliders -> NSGA-II in a Web Worker -> ranked builds. Uses helpers from app.js (h, api, items, itemMap...).
(function () {
  const OBJ = JadeModel.OBJECTIVES;
  const PRESETS = [
    ['Armor tank', { magicEHP: 10, armorEHP: 100, dpsCrit: 0, dpsNoCrit: 15, ap: 0, cdr: 0 }],
    ['Magic tank', { magicEHP: 100, armorEHP: 10, dpsCrit: 0, dpsNoCrit: 15, ap: 0, cdr: 0 }],
    ['AD carry', { magicEHP: 10, armorEHP: 10, dpsCrit: 100, dpsNoCrit: 0, ap: 0, cdr: 0 }],
    ['Auto-attacker (no crit)', { magicEHP: 10, armorEHP: 10, dpsCrit: 0, dpsNoCrit: 100, ap: 0, cdr: 0 }],
    ['AP mage', { magicEHP: 15, armorEHP: 15, dpsCrit: 0, dpsNoCrit: 0, ap: 100, cdr: 60 }],
  ];
  const w = Object.fromEntries(OBJ.map((o) => [o.key, 0]));
  Object.assign(w, PRESETS[0][1]);
  let worker = null, seq = 0, ranAt = null, ready = false, opened = false;
  const fmt = (k, v) => k === 'cdr' ? Math.round(v * 100) + '%' : Math.round(v).toLocaleString('en-US');
  const activeKey = () => OBJ.filter((o) => w[o.key] > 0).map((o) => o.key).join();
  const size = () => +$('#optSize').value;
  const maxGold = () => Math.max(1000, +$('#optGold').value || 20000);

  function buildSliders() {
    const box = $('#optSliders'); box.replaceChildren();
    for (const o of OBJ) {
      const val = h('span', { class: 'val', text: String(w[o.key]) });
      const input = h('input', { type: 'range', min: 0, max: 100, step: 1, value: w[o.key], 'aria-label': o.label, id: 'opt-' + o.key });
      input.addEventListener('input', () => { w[o.key] = +input.value; val.textContent = input.value; onWeights(); });
      box.append(h('div', { class: 'slider', title: o.hint }, h('label', { for: 'opt-' + o.key }, h('span', {}, o.label, h('small', { text: o.hint })), val), input));
    }
  }
  function setWeights(p) { Object.assign(w, p); buildSliders(); onWeights(true); }

  function startRun() {
    if (worker) worker.terminate();
    ranAt = activeKey(); ready = false;
    if (!ranAt) { $('#optStatus').textContent = 'Move a slider above 0 to start.'; $('#optResults').replaceChildren(); return; }
    $('#optStatus').textContent = 'Searching…'; $('#optBar').style.width = '0%';
    worker = new Worker('optimizer-worker.js');
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') $('#optBar').style.width = Math.round(m.p * 100) + '%';
      else if (m.type === 'front') { ready = true; $('#optBar').style.width = '100%'; requestRank(); }
      else if (m.type === 'ranked' && m.seq === seq) showResults(m);
    };
    worker.onerror = (e) => { $('#optStatus').textContent = 'Search failed: ' + (e.message || 'worker error'); };
    const keys = ranAt.split(',');
    worker.postMessage({ type: 'run', items, keys, size: size(), maxGold: maxGold(), pop: 240, gens: 200, seed: Math.floor(Math.random() * 1e9) });
  }
  function requestRank() { if (worker && ready) worker.postMessage({ type: 'rank', weights: { ...w }, topN: 5, seq: ++seq }); }

  const debStart = debounce(startRun, 500), debRank = debounce(requestRank, 120);
  function onWeights(now) {
    if (activeKey() !== ranAt) { ready = false; now ? startRun() : debStart(); } else debRank();
  }

  function showResults(m) {
    const box = $('#optResults');
    if (!m.builds.length) { box.replaceChildren(h('div', { class: 'empty', text: 'No build fits under that gold cap. Raise Max gold.' })); $('#optStatus').textContent = ''; return; }
    $('#optStatus').textContent = 'Searched ' + m.front + ' Pareto-optimal builds, showing the top ' + m.builds.length + '.';
    box.replaceChildren(...m.builds.map((b, i) => {
      const its = b.ids.map((id) => itemMap.get(id)).sort((x, y) => x.cost - y.cost);
      const icons = its.map((it) => { const img = h('img', { src: it.icon, alt: it.name }); hoverable(img, it); return img; });
      const metrics = OBJ.map((o) => h('div', { class: 'metric' + (w[o.key] > 0 ? ' on' : '') }, h('div', { class: 'k', text: o.label }), h('div', { class: 'n', text: fmt(o.key, b.v[o.key]) })));
      metrics.push(h('div', { class: 'metric' }, h('div', { class: 'k', text: 'Gold' }), h('div', { class: 'n', text: fmt('gold', b.v.cost) })));
      return h('div', { class: 'result' },
        h('div', { class: 'head' }, h('span', { class: 'rk', text: '#' + (i + 1) }), h('div', { class: 'icons' }, icons),
          h('button', { class: 'btn primary', text: 'Save as build', onclick: (e) => saveBuild(its, e.target) })),
        h('div', { class: 'names', text: its.map((x) => x.name).join(' · ') }),
        h('div', { class: 'metrics' }, metrics));
    }));
  }

  async function saveBuild(its, btn) {
    btn.disabled = true;
    try {
      const champ = $('#champFilter').value || (champions[0] && champions[0].name) || '';
      const id = 'build-' + Date.now().toString(36);
      const label = OBJ.filter((o) => w[o.key] > 0).map((o) => o.label).join(' + ');
      const b = await api('/api/builds/' + id, 'PUT', { name: 'Optimizer: ' + label.slice(0, 60), champion: champ, notes: 'Found by the Optimizer tab (NSGA-II). Sliders: ' + OBJ.map((o) => o.label + ' ' + w[o.key]).join(', '),
        steps: its.map((it) => ({ itemId: it.id, count: 1, note: '' })) });
      builds.push(b); showTab('builds'); selectBuild(id);
    } catch (e) { btn.disabled = false; btn.textContent = 'Save failed'; }
  }

  window.openOptimizer = function () {
    if (opened) return; opened = true;
    buildSliders();
    $('#optPresets').replaceChildren(...PRESETS.map(([n, p]) => h('button', { class: 'chip', text: n, onclick: () => setWeights(p) })));
    $('#optRun').onclick = startRun; $('#optSize').onchange = startRun; $('#optGold').onchange = startRun;
    startRun();
  };
})();
