'use strict';
// Reads the local League Live Client Data API (only exists while a match is running).
const https = require('https');

const BASE = 'https://127.0.0.1:2999/liveclientdata';
// The game serves a self-signed certificate on localhost only.
const agent = new https.Agent({ rejectUnauthorized: false });

function fetchJson(url, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, timeout }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Reduce the big allgamedata payload to what we need.
function parseGame(raw) {
  const ap = raw.activePlayer || {};
  const players = raw.allPlayers || [];
  const me =
    players.find((p) => (ap.riotId && p.riotId === ap.riotId) || (ap.summonerName && p.summonerName === ap.summonerName)) ||
    players[0] ||
    {};
  const gd = raw.gameData || {};
  return {
    connected: true,
    mode: gd.gameMode || null,
    gameTime: gd.gameTime || 0,
    champion: me.championName || null,
    gold: ap.currentGold || 0,
    level: ap.level || 1,
    isDead: !!me.isDead,
    items: me.items || [],
  };
}

async function poll() {
  try {
    const raw = await fetchJson(BASE + '/allgamedata');
    return parseGame(raw);
  } catch (e) {
    return { connected: false, mode: null, gameTime: 0, champion: null, gold: 0, level: 0, isDead: false, items: [] };
  }
}

module.exports = { poll, parseGame };
