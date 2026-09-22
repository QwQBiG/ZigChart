import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { sampleBar } from '../web/src/data/sample-feed.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = (start, count) => Array.from({ length: count }, (_, i) => sampleBar(start + i));
async function create(data) {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(20, 20, 7);
  core.configureOscillators(14, 12, 26, 9, 3);
  core.apply('replace', data);
  return core;
}
const revise = (bar, shift) => ({ ...bar, open: bar.open + shift, high: bar.high + shift,
  low: bar.low + shift, close: bar.close + shift, volume: bar.volume + 3 });

test('historical corrections match a full rebuild through every indicator seed and mature recurrence', async () => {
  const data = bars(0, 180);
  const core = await create(data);
  for (const indices of [[0, 4], [14, 19, 25, 33], [58, 110], [179]]) {
    const changed = indices.map(index => data[index] = revise(data[index], 1700));
    core.apply('correct', changed);
    const rebuilt = await create(data);
    core.setView(0, 180); rebuilt.setView(0, 180);
    assert.deepEqual(core.frame(1400, 800), rebuilt.frame(1400, 800));
    for (let i = 0; i < data.length; i++) assert.deepEqual(core.inspect(i), rebuilt.inspect(i));
  }
});

test('corrections reject all invalid targets atomically and leave ordinary upserts strict', async () => {
  const data = bars(100, 50);
  const core = await create(data);
  const before = core.frame(900, 600);
  const changed = revise(data[2], 1000);
  const invalid = [
    [changed, sampleBar(151)], [sampleBar(99), changed],
    [changed, { ...data[4], time: data[4].time + 1 }],
    [changed, { ...data[4], volume: NaN }],
    [changed, changed], [data[3], changed],
  ];
  for (const batch of invalid) {
    assert.throws(() => core.apply('correct', batch));
    assert.deepEqual(core.frame(900, 600), before);
    assert.equal(core.count, data.length);
    assert.equal(core.inspect(2).close, data[2].close);
  }
  assert.throws(() => core.apply('upsert', [changed]), /order/);
  core.apply('correct', []);
  core.apply('correct', data);
  assert.deepEqual(core.frame(900, 600), before);
  const empty = await create([]);
  assert.throws(() => empty.apply('correct', [sampleBar(0)]), /not loaded/);
  empty.apply('correct', []);
  assert.equal(empty.count, 0);
});

test('corrections after prepend preserve shared viewport, pane weights, drawing anchors and locked ranges', async () => {
  const core = await create(bars(100, 100));
  core.apply('prepend', bars(0, 100));
  core.setView(60, 100); core.pan(3);
  core.setPaneWeights([3, 1, 2, 1]);
  const before = core.frame(1000, 800);
  const anchor = { time: sampleBar(95).time, price: sampleBar(95).close };
  const shape = [{ kind: 'horizontal', a: anchor, b: anchor }];
  const drawing = core.projectDrawings(shape, 1000, 800);
  core.apply('correct', [revise(sampleBar(10), 50000), revise(sampleBar(95), -50000)]);
  const after = core.frame(1000, 800);
  assert.equal(core.scaleIsAuto, false);
  assert.deepEqual(after.meta, before.meta);
  assert.deepEqual(after.panes, before.panes);
  assert.deepEqual(core.getPaneWeights(), [3, 1, 2, 1]);
  assert.deepEqual(core.projectDrawings(shape, 1000, 800), drawing);
  assert.notDeepEqual(after.oscillators, before.oscillators);
});

test('automatic price conversion invalidates cached ranges without moving time or following state', async () => {
  const data = bars(0, 120);
  const core = await create(data);
  const before = core.frame(900, 600);
  data[115] = revise(data[115], 50000);
  core.apply('correct', [data[115]]);
  const rebuilt = await create(data);
  assert.equal(core.priceToY(data[115].high, 900, 600), rebuilt.priceToY(data[115].high, 900, 600));
  assert.deepEqual(core.frame(900, 600), rebuilt.frame(900, 600));
  assert.equal(core.frame(900, 600).meta[8], before.meta[8]);
  assert.equal(core.scaleIsAuto, true);
  core.apply('upsert', [sampleBar(120)]);
  assert.equal(core.frame(900, 600).meta[8], before.meta[8] + 1);
});
