import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = Array.from({ length: 1000 }, (_, index) => ({
  time: (index + 1) * 60000, open: 1000 + index, high: 1005 + index,
  low: 995 + index, close: 1001 + index, volume: 100,
}));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const create = async () => { const core = await ChartCore.create(bytes); core.configureIndicators(20, 20, 7); core.apply('replace', bars); return core; };

test('viewport density respects six CSS pixels per slot and both zoom bounds', async () => {
  const core = await create();
  core.setView(20, 2000);
  assert.equal(core.frame(600, 500).meta[9], 2000);
  core.resizePlot(600);
  core.setView(20, 2000);
  core.zoom(0.00001, 0.5);
  const frame = core.frame(600, 500);
  assert.equal(frame.meta[9], 100);
  close(frame.rows[26] - frame.rows[9], 6);
  assert.ok(frame.meta[7] < 6);
  core.zoom(100000, 0.5);
  assert.equal(core.frame(600, 500).meta[9], 10);
});

test('zoom attempts at either bound preserve the locked price and volume ranges', async () => {
  for (const span of [10, 100]) {
    const core = await create();
    core.resizePlot(600);
    core.setView(1000 - 0.5 - span * 0.8, span);
    core.pan(-1);
    const before = core.frame(600, 500).meta;
    core.apply('upsert', [{ ...bars.at(-1), high: 1000000, volume: 900000 }]);
    core.zoom(span === 10 ? 100 : 0.001, 0.5);
    assert.deepEqual(core.frame(600, 500).meta.slice(0, 3), before.slice(0, 3));
    core.zoom(span === 10 ? 0.5 : 2, 1);
    assert.ok(core.frame(600, 500).meta[1] > 1000000);
  }
});

test('plot resize preserves latest position or historical midpoint without refitting', async () => {
  const core = await create();
  core.resizePlot(1200);
  core.setView(800, 200);
  core.follow();
  core.pan(-5);
  let before = core.frame(1200, 500).meta;
  const latestFraction = (999.5 - before[8]) / before[9];
  core.resizePlot(360);
  let after = core.frame(360, 500).meta;
  close((999.5 - after[8]) / after[9], latestFraction);
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  core.resizePlot(1200);
  assert.equal(core.frame(1200, 500).meta[9], 60);
  core.setView(200, 180);
  core.pan(1);
  before = core.frame(1200, 500).meta;
  core.resizePlot(300);
  after = core.frame(300, 500).meta;
  close(after[8] + after[9] / 2, before[8] + before[9] / 2);
  assert.deepEqual(after.slice(0, 3), before.slice(0, 3));
  for (const width of [0, -1, NaN, Infinity]) core.resizePlot(width);
  assert.deepEqual(core.frame(300, 500).meta, after);
});

test('pane split moves one boundary while retaining the shared horizontal view and range', async () => {
  const core = await create();
  core.resizePlot(600);
  core.pan(-1);
  const before = core.frame(600, 500);
  for (const [requested, expected] of [[0.5, 0.5], [-1, 0.3], [2, 0.85]]) {
    core.setPaneSplit(requested);
    const frame = core.frame(600, 500);
    close((frame.meta[4] + frame.meta[5]) / 2, expected * 500);
    assert.deepEqual(frame.meta.slice(0, 3), before.meta.slice(0, 3));
    assert.deepEqual(frame.meta.slice(7), before.meta.slice(7));
    assert.ok(frame.meta[3] < frame.meta[4] && frame.meta[4] < frame.meta[5] && frame.meta[5] < frame.meta[6]);
    for (let i = 9; i < frame.rows.length; i += 17) assert.equal(frame.rows[i], before.rows[i]);
  }
  const valid = core.frame(600, 500);
  core.setPaneSplit(NaN);
  core.setPaneSplit(Infinity);
  assert.deepEqual(core.frame(600, 500), valid);
});

test('resized pane geometry keeps drawings, candles, volume and hit slots aligned', async () => {
  const core = await create();
  core.resizePlot(480);
  core.setView(880, 80);
  core.setPaneSplit(0.5);
  const frame = core.frame(480, 600);
  for (let offset = 0; offset < frame.rows.length; offset += 17) {
    const row = frame.rows.slice(offset, offset + 17);
    const anchor = { time: row[1], price: row[5] };
    const [drawing] = core.projectDrawings([{ kind: 'horizontal', a: anchor, b: anchor }], 480, 600);
    close(drawing.x1, row[9]);
    close(drawing.y1, row[13]);
    assert.equal(core.hit(row[9], 480), row[0]);
    assert.ok(row[14] >= frame.meta[5] && row[14] <= frame.meta[6]);
  }
});
