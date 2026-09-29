'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { poll, parseGame } = require('./poller');
const { indexItems, evaluate } = require('./engine');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');       // bundled, read-only game data
const SEED_BUILDS_DIR = path.join(ROOT, 'builds'); // bundled example build(s)

const DEFAULT_CONFIG = {
  port: 17600,
  // Overlay strip as fractions of the game window (from the red box in the screenshot).
  overlay: { x: 0.0055, y: 0.084, w: 0.094, h: 0.63 },
  // Treat the first N seconds of a match as "at the shop" (you start in the fountain).
  autoShopSeconds: 120,
  hotkeys: { shop: 'F8', calibrate: 'F9', toggle: 'F10' },
};

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const safeId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(s);

function start(opts = {}) {
  // Writable state (builds, settings). In the packaged app this is the per-user app-data
  // folder, because the install folder is read-only; when run from source it's the project folder.
  const USER = opts.userDir || ROOT;
  const BUILDS_DIR = path.join(USER, 'builds');
  const CONFIG_PATH = path.join(USER, 'config.json');
  const SELECT_PATH = path.join(USER, 'selections.json');
  fs.mkdirSync(USER, { recursive: true });
  const firstRun = !fs.existsSync(CONFIG_PATH);

  const config = Object.assign({}, DEFAULT_CONFIG, readJson(CONFIG_PATH, {}));
  config.overlay = Object.assign({}, DEFAULT_CONFIG.overlay, config.overlay);
  config.hotkeys = Object.assign({}, DEFAULT_CONFIG.hotkeys, config.hotkeys);
  if (!fs.existsSync(CONFIG_PATH)) writeJson(CONFIG_PATH, config);
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
  if (USER !== ROOT && !fs.readdirSync(BUILDS_DIR).some((f) => f.endsWith('.json'))) {
    // First launch of the packaged app: copy in the example build so the overlay has something to show.
    for (const f of fs.existsSync(SEED_BUILDS_DIR) ? fs.readdirSync(SEED_BUILDS_DIR) : []) {
      if (f.endsWith('.json')) fs.copyFileSync(path.join(SEED_BUILDS_DIR, f), path.join(BUILDS_DIR, f));
    }
  }

  const items = readJson(path.join(DATA_DIR, 'jade-items.json'), { items: [] }).items;
  const champions = readJson(path.join(DATA_DIR, 'jade-champions.json'), { champions: [] }).champions;
  const itemMap = indexItems(items);
  let selections = readJson(SELECT_PATH, {});

  // ---- mock game (for testing without a match) ----
  const sample = readJson(path.join(DATA_DIR, 'sample-game.json'), null);
  const sampleParsed = sample ? parseGame(sample) : null;
  let mock = {
    enabled: !!opts.mock,
    champion: (sampleParsed && sampleParsed.champion) || 'Amumu',
    gold: (sampleParsed && sampleParsed.gold) || 475,
    isDead: false,
    gameTime: 22,
    items: (sampleParsed && sampleParsed.items.map((i) => ({ itemID: i.itemID, count: i.count }))) || [],
  };

  // ---- builds ----
  const listBuilds = () =>
    fs.readdirSync(BUILDS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(BUILDS_DIR, f), null))
      .filter(Boolean)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  function championMatches(buildChamp, gameChamp) {
    const a = norm(buildChamp), b = norm(gameChamp);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
  }

  function pickBuild(champion) {
    const builds = listBuilds();
    const chosen = selections[norm(champion)];
    if (chosen) {
      const b = builds.find((x) => x.id === chosen);
      if (b) return b;
    }
    return builds.find((b) => championMatches(b.champion, champion)) || null;
  }

  // ---- live state ----
  let state = { connected: false };
  const clients = new Set();

  async function tick() {
    const game = mock.enabled
      ? { connected: true, mode: 'JADE', gameTime: mock.gameTime, champion: mock.champion, gold: mock.gold, level: 1, isDead: mock.isDead, items: mock.items, mock: true }
      : await poll();
    const build = game.connected ? pickBuild(game.champion) : null;
    const next = {
      connected: game.connected,
      mock: !!game.mock,
      mode: game.mode,
      isJade: game.mode === 'JADE',
      champion: game.champion,
      gold: Math.floor(game.gold),
      isDead: game.isDead,
      gameTime: Math.floor(game.gameTime),
      autoShop: game.connected && (game.isDead || game.gameTime < config.autoShopSeconds),
      inventory: game.items,
      build: build ? { id: build.id, name: build.name } : null,
      eval: build ? evaluate({ build, inventory: game.items, gold: game.gold, items: itemMap }) : null,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(state);
    state = next;
    if (changed) broadcast();
  }
  function broadcast() {
    const payload = 'data: ' + JSON.stringify(state) + '\n\n';
    for (const res of clients) res.write(payload);
  }
  const timer = setInterval(() => tick().catch(() => {}), 1000);
  tick().catch(() => {});

  // ---- http ----
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/overlay', express.static(path.join(ROOT, 'overlay')));
  app.use(express.static(path.join(ROOT, 'web')));

  app.get('/api/items', (req, res) => res.json(items));
  app.get('/api/champions', (req, res) => res.json(champions));
  app.get('/api/config', (req, res) => res.json(config));
  app.put('/api/config', (req, res) => {
    const b = req.body || {};
    if (b.overlay) Object.assign(config.overlay, b.overlay);
    if (b.hotkeys) Object.assign(config.hotkeys, b.hotkeys);
    if (typeof b.autoShopSeconds === 'number') config.autoShopSeconds = b.autoShopSeconds;
    writeJson(CONFIG_PATH, config);
    res.json(config);
  });

  app.get('/api/builds', (req, res) => res.json(listBuilds()));
  app.get('/api/builds/:id', (req, res) => {
    if (!safeId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    const b = readJson(path.join(BUILDS_DIR, req.params.id + '.json'), null);
    b ? res.json(b) : res.status(404).json({ error: 'not found' });
  });
  app.put('/api/builds/:id', (req, res) => {
    const id = req.params.id;
    if (!safeId(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const steps = Array.isArray(b.steps) ? b.steps : [];
    const clean = {
      id,
      name: String(b.name || 'Untitled build').slice(0, 80),
      champion: String(b.champion || '').slice(0, 40),
      notes: String(b.notes || '').slice(0, 2000),
      steps: steps
        .filter((s) => itemMap.has(Number(s.itemId)))
        .map((s) => ({ itemId: Number(s.itemId), count: Math.max(1, Math.min(20, Number(s.count) || 1)), note: String(s.note || '').slice(0, 120) })),
      updated: new Date().toISOString(),
    };
    writeJson(path.join(BUILDS_DIR, id + '.json'), clean);
    tick().catch(() => {});
    res.json(clean);
  });
  app.delete('/api/builds/:id', (req, res) => {
    if (!safeId(req.params.id)) return res.status(400).json({ error: 'bad id' });
    try { fs.unlinkSync(path.join(BUILDS_DIR, req.params.id + '.json')); } catch (e) {}
    for (const k of Object.keys(selections)) if (selections[k] === req.params.id) delete selections[k];
    writeJson(SELECT_PATH, selections);
    tick().catch(() => {});
    res.json({ ok: true });
  });

  app.post('/api/select', (req, res) => {
    const { champion, buildId } = req.body || {};
    if (!champion) return res.status(400).json({ error: 'champion required' });
    if (buildId && !safeId(buildId)) return res.status(400).json({ error: 'bad id' });
    if (buildId) selections[norm(champion)] = buildId; else delete selections[norm(champion)];
    writeJson(SELECT_PATH, selections);
    tick().catch(() => {});
    res.json({ ok: true });
  });
  app.get('/api/selections', (req, res) => res.json(selections));

  app.get('/api/state', (req, res) => res.json(state));
  app.get('/api/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('data: ' + JSON.stringify(state) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  app.get('/api/mock', (req, res) => res.json(mock));
  app.put('/api/mock', (req, res) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') mock.enabled = b.enabled;
    if (typeof b.champion === 'string') mock.champion = b.champion;
    if (typeof b.gold === 'number') mock.gold = Math.max(0, Math.min(99999, b.gold));
    if (typeof b.isDead === 'boolean') mock.isDead = b.isDead;
    if (typeof b.gameTime === 'number') mock.gameTime = Math.max(0, b.gameTime);
    if (Array.isArray(b.items)) {
      mock.items = b.items
        .filter((i) => itemMap.has(Number(i.itemID)))
        .map((i) => ({ itemID: Number(i.itemID), count: Math.max(1, Math.min(20, Number(i.count) || 1)) }));
    }
    tick().then(() => res.json(mock)).catch(() => res.json(mock));
  });

  const port = opts.port || config.port;
  const server = app.listen(port, '127.0.0.1');
  server.on('listening', () => console.log('[jade] http://127.0.0.1:' + port + (mock.enabled ? '  (mock game)' : '')));
  server.on('error', (e) => console.error('[jade] server error:', e.message));

  return {
    port,
    userDir: USER,
    buildsDir: BUILDS_DIR,
    firstRun,
    config,
    saveConfig: () => writeJson(CONFIG_PATH, config),
    close: () => { clearInterval(timer); server.close(); for (const c of clients) c.end(); },
  };
}

module.exports = { start };

if (require.main === module) {
  start({ mock: process.argv.includes('--mock') });
}
