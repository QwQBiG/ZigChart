import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (time, volume = 1) => ({ time, open: 100, high: 130, low: 90, close: 120, volume });
const anchor = (time, price) => ({ time, price });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const stats = ({ priceChange, percentChange, barDistance, elapsedMs, volume, barCount }) =>
  ({ priceChange, percentChange, barDistance, elapsedMs, volume, barCount });

test('Wasm measurement uses signed price/time changes, inclusive loaded bars and nullable zero bases', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', [bar(1000, 1), bar(3000, 2), bar(10000, 3)]);
  const forward = core.measure(anchor(1000, 100), anchor(10000, 120), 900, 600);
  assert.deepEqual(stats(forward), { priceChange: 20, percentChange: 20, barDistance: 2, elapsedMs: 9000, volume: 6, barCount: 3 });
  const saved = structuredClone(forward), reverse = core.measure(anchor(10000, 120), anchor(1000, 100), 900, 600);
  assert.equal(reverse.priceChange, -20); approx(reverse.percentChange, -100 / 6);
  assert.equal(reverse.barDistance, -2); assert.equal(reverse.elapsedMs, -9000); assert.equal(reverse.volume, 6);
  assert.deepEqual(forward, saved, 'Results must not retain the shared Wasm buffer');
  assert.deepEqual(stats(core.measure(anchor(3000, 0), anchor(3000, 10), 900, 600)),
    { priceChange: 10, percentChange: null, barDistance: 0, elapsedMs: 0, volume: 2, barCount: 1 });
  assert.equal(core.measure(anchor(1000, -100), anchor(3000, -50), 900, 600).percentChange, 50);
});

test('measurement shares drawing coordinates in every scale, inverted and reordered price panes', async () => {
  const core = await ChartCore.create(bytes);
  const data = Array.from({ length: 100 }, (_, i) => bar(i * 60000, i + 1));
  core.apply('replace', data); core.configureIndicators(20, 20, 4); core.setPaneOrder([1, 0, 2, 3]);
  core.setView(10, 80); core.pan(1);
  const a = anchor(data[20].time, 100), b = anchor(data[70].time, 125);
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) {
    for (const inverted of [false, true]) {
      core.configurePriceScale(mode, inverted);
      const before = core.frame(900, 600), measurement = core.measure(a, b, 900, 600);
      const [drawing] = core.projectDrawings([{ kind: 'trend', a, b }], 900, 600);
      for (const key of ['x1', 'y1', 'x2', 'y2']) assert.equal(measurement[key], drawing[key]);
      assert.deepEqual(core.frame(900, 600), before); assert.equal(core.scaleIsAuto, false);
    }
  }
  core.configurePriceScale('logarithmic', false);
  assert.equal(core.measure(anchor(a.time, 0), b, 900, 600), null);
  core.maximizePane(1); assert.equal(core.measure(a, b, 900, 600), null);
  core.maximizePane(-1); assert.ok(core.measure(a, b, 900, 600));
});

test('measurement anchors survive prepends and recompute inclusive volume after corrections', async () => {
  const core = await ChartCore.create(bytes), data = Array.from({ length: 200 }, (_, i) => bar(10000 + i * 60000, i + 1));
  core.apply('replace', data.slice(50)); core.setView(10, 100); core.pan(1);
  const a = anchor(data[80].time, 100), b = anchor(data[100].time, 120), before = core.measure(a, b, 900, 600);
  core.apply('prepend', data.slice(0, 50));
  assert.deepEqual(core.measure(a, b, 900, 600), before);
  core.apply('correct', [{ ...data[90], volume: 1000 }]);
  assert.equal(core.measure(a, b, 900, 600).volume, before.volume + 1000 - data[90].volume);
  core.apply('replace', data.slice(101)); assert.equal(core.measure(a, b, 900, 600), null);
});

test('measurement rejects unprojectable anchors and only returns exact safe integer volumes', async () => {
  const core = await ChartCore.create(bytes), data = Array.from({ length: 9008 }, (_, i) => bar(i, 1e12));
  data[9007].volume = 199254740991; core.apply('replace', data);
  const a = anchor(0, -1e12), b = anchor(9007, 1e12);
  assert.equal(core.measure(a, b, 900, 600).volume, Number.MAX_SAFE_INTEGER);
  core.apply('upsert', [{ ...data[9007], volume: data[9007].volume + 1 }]);
  const overflow = core.measure(a, b, 900, 600);
  assert.equal(overflow.volume, null); assert.equal(overflow.priceChange, 2e12); assert.equal(overflow.barCount, 9008);
  for (const invalid of [null, anchor(9008, 100), anchor(0.5, 100), anchor(0, 0.5), anchor(0, NaN), anchor(0, 1e12 + 1), anchor('0', 100)]) {
    assert.equal(core.measure(invalid, b, 900, 600), null);
  }
  assert.equal(core.measure(a, b, 0, 600), null); assert.equal(core.measure(a, b, 900, Infinity), null);
});
