'use strict';
importScripts('model.js', 'nsga2.js');
let model = null, state = null;
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'run') {
    model = JadeModel.create(m.items);
    const front = JadeNSGA.run({ model, size: m.size, maxGold: m.maxGold, keys: m.keys, pop: m.pop, gens: m.gens, seed: m.seed,
      onProgress: (p) => postMessage({ type: 'progress', p }) });
    state = { front, size: m.size, maxGold: m.maxGold, keys: m.keys };
    postMessage({ type: 'front', count: front.length });
  } else if (m.type === 'rank' && state) {
    const top = JadeNSGA.rank(model, state.front, m.weights, m.topN, state.size, state.maxGold);
    postMessage({ type: 'ranked', seq: m.seq, front: state.front.length,
      builds: top.map((b) => ({ ids: b.idx.map((i) => model.pool[i].id), v: b.v, score: b.score })) });
  }
};
