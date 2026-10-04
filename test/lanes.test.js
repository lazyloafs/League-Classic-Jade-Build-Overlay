'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../server/lanes');
const { parseGame } = require('../server/poller');

const same = (a, b) => L.norm(a) === L.norm(b);
const B = (id, champion, lane, updated = '2026-01-01') => ({ id, champion, lane, updated });
const builds = [B('amumu-any', 'Amumu', ''), B('amumu-jg', 'Amumu', 'JUNGLE'), B('amumu-top', 'Amumu', 'TOP', '2026-02-01'), B('ashe', 'Ashe', 'BOTTOM')];
const pick = (sel, champ, lane) => L.pickBuild(builds, sel, champ, lane, same);

test('normalizeLane accepts game positions and common names', () => {
  assert.equal(L.normalizeLane('MIDDLE'), 'MIDDLE');
  assert.equal(L.normalizeLane('utility'), 'UTILITY');
  assert.equal(L.normalizeLane('mid'), 'MIDDLE');
  assert.equal(L.normalizeLane('bot'), 'BOTTOM');
  assert.equal(L.normalizeLane('NONE'), '');
  assert.equal(L.normalizeLane(undefined), '');
});
test('detectLane: position wins, Smite means jungle, otherwise nothing', () => {
  assert.deepEqual(L.detectLane({ position: 'TOP' }), { lane: 'TOP', source: 'api' });
  const smite = { position: 'NONE', summonerSpells: { summonerSpellOne: { displayName: 'Smite' }, summonerSpellTwo: { displayName: 'Flash' } } };
  assert.deepEqual(L.detectLane(smite), { lane: 'JUNGLE', source: 'spell' });
  assert.equal(L.detectLane({ position: 'NONE', summonerSpells: { summonerSpellOne: { displayName: 'Fortify' }, summonerSpellTwo: { displayName: 'Rally' } } }), null);
});
test('parseGame carries the detected lane (real Jade sample reports NONE)', () => {
  const g = parseGame(require('../data/sample-game.json'));
  assert.equal(g.position, 'NONE');
  assert.equal(g.detectedLane, null);
});
test('pickBuild uses the build for the lane', () => {
  assert.equal(pick({}, 'Amumu', 'JUNGLE').build.id, 'amumu-jg');
  assert.equal(pick({}, 'Amumu', 'TOP').build.id, 'amumu-top');
});
test('pickBuild falls back to the any-lane build, flagging a lane miss only when it had to use another lane', () => {
  const r = pick({}, 'Amumu', 'MIDDLE');
  assert.equal(r.build.id, 'amumu-any'); assert.equal(r.laneMatch, true);
  const only = L.pickBuild([B('a', 'Ashe', 'BOTTOM')], {}, 'Ashe', 'TOP', same);
  assert.equal(only.build.id, 'a'); assert.equal(only.laneMatch, false);
});
test('a saved selection beats a newer build for that lane', () => {
  assert.equal(pick({ [L.selKey('Amumu', 'TOP')]: 'amumu-top' }, 'Amumu', 'TOP').build.id, 'amumu-top');
  const two = [B('t1', 'Amumu', 'TOP', '2026-03-01'), B('t2', 'Amumu', 'TOP', '2026-01-01')];
  assert.equal(L.pickBuild(two, {}, 'Amumu', 'TOP', same).build.id, 't1');
  assert.equal(L.pickBuild(two, { [L.selKey('Amumu', 'TOP')]: 't2' }, 'Amumu', 'TOP', same).build.id, 't2');
});
test('older one-build-per-champion selections still work', () => {
  assert.equal(pick({ amumu: 'amumu-jg' }, 'Amumu', '').build.id, 'amumu-jg');
});
test('no lane known uses the any-lane build', () => {
  assert.equal(pick({}, 'Amumu', '').build.id, 'amumu-any');
  assert.equal(pick({}, 'Nobody', 'TOP').build, null);
});
test('lanesFor and nextLane cycle through lanes that have builds', () => {
  const opts = L.lanesFor(builds, 'Amumu', same);
  assert.deepEqual(opts, ['', 'TOP', 'JUNGLE']);
  assert.equal(L.nextLane('', opts), 'TOP');
  assert.equal(L.nextLane('JUNGLE', opts), '');
  assert.equal(L.nextLane('MIDDLE', opts), '');
  assert.equal(L.nextLane('TOP', []), '');
});
