import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { instrument, sampleBar } from '../web/src/data/sample-feed.ts';
import { timeAxisTicks } from '../web/src/chart/time-axis.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = (start, count) => Array.from({ length: count }, (_, i) => sampleBar(start + i));
const ticks = (frame) => timeAxisTicks(frame, instrument.intervalMs);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7);

test('real Wasm: fractional panning moves UTC tick labels with their unchanged candles', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(0, 1000));
  core.setView(200, 120);
  const before = core.frame(800, 500);
  core.pan(0.375);
  const after = core.frame(800, 500);
  assert.equal(after.meta[9], before.meta[9]);
  const previous = new Map(ticks(before).map(tick => [tick.time, tick.x]));
  const common = ticks(after).filter(tick => previous.has(tick.time));
  assert.ok(common.length >= 5);
  for (const tick of common) {
    close(tick.x - previous.get(tick.time), -0.375 / 120 * 800);
    assert.equal(tick.time % (15 * instrument.intervalMs), 0);
  }
});

test('real Wasm: prepending an arbitrary history page preserves every visible tick', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(1000, 500));
  core.setView(100.25, 120);
  const before = ticks(core.frame(800, 500));
  assert.ok(before.length >= 5);
  core.apply('prepend', bars(743, 257));
  assert.deepEqual(ticks(core.frame(800, 500)), before);
});

test('real Wasm: centered future space keeps tick density and contains no future labels', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(0, 1000));
  const defaultFrame = core.frame(800, 500);
  const defaultTicks = ticks(defaultFrame);
  core.pan(10000);
  const centered = core.frame(800, 500);
  const centeredTicks = ticks(centered);
  assert.equal(centered.rows.at(-8), 400);
  assert.ok(centered.rows.length < defaultFrame.rows.length);
  const before = new Map(defaultTicks.map(tick => [tick.time, tick.x]));
  const shared = centeredTicks.filter(tick => before.has(tick.time));
  assert.ok(shared.length >= 3);
  for (const tick of shared) close(tick.x - before.get(tick.time), -240);
  for (const tick of centeredTicks) {
    assert.ok(tick.x <= 400);
    assert.ok(tick.time <= sampleBar(999).time);
    assert.equal(tick.time % (15 * instrument.intervalMs), 0);
  }
});

test('real Wasm: zoom and plot width intentionally change UTC tick density', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(0, 1000));
  core.setView(200, 120);
  const wide = ticks(core.frame(800, 500));
  const narrow = ticks(core.frame(400, 500));
  core.zoom(2, 0.5);
  const zoomed = ticks(core.frame(800, 500));
  for (const [selected, minutes] of [[wide, 15], [narrow, 30], [zoomed, 10]]) {
    assert.ok(selected.length >= 3);
    for (let i = 1; i < selected.length; i++) {
      assert.equal(selected[i].time - selected[i - 1].time, minutes * instrument.intervalMs);
      assert.ok(selected[i].x - selected[i - 1].x >= 100 - 1e-7);
    }
  }
});

test('real Wasm: missing slots and shifted bar starts never create synthetic timestamps', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 500).filter((_, index) => index !== 225)
    .map(bar => ({ ...bar, time: bar.time + 30_000 }));
  core.apply('replace', data);
  core.setView(200, 120);
  const frame = core.frame(800, 500);
  const selected = ticks(frame);
  assert.ok(selected.length >= 5);
  const actualTimes = new Set(data.map(bar => bar.time));
  for (const tick of selected) {
    assert.ok(actualTimes.has(tick.time));
    assert.equal(tick.time % instrument.intervalMs, 30_000);
  }
  assert.ok(!selected.some(tick => tick.time === sampleBar(225).time + 30_000));
});

test('time label sampling safely handles empty data and invalid metadata', async () => {
  const core = await ChartCore.create(bytes);
  assert.deepEqual(ticks(core.frame(800, 500)), []);
  core.apply('replace', bars(0, 200));
  const frame = core.frame(800, 500);
  for (const interval of [0, -1, NaN, Infinity, 0.5]) {
    assert.deepEqual(timeAxisTicks(frame, interval), []);
  }
  for (const [index, value] of [[9, 0], [9, NaN], [11, 0], [11, Infinity]]) {
    const meta = frame.meta.slice();
    meta[index] = value;
    assert.deepEqual(ticks({ rows: frame.rows, meta }), []);
  }
  assert.deepEqual(ticks({ rows: new Float64Array(1), meta: frame.meta }), []);
});

test('calendar month ticks keep real month starts across leap years and panning', async () => {
  const core = await ChartCore.create(bytes);
  const months = Array.from({ length: 60 }, (_, i) => ({ ...sampleBar(i), time: Date.UTC(2022, i, 1) }));
  core.apply('replace', months);
  core.setView(10, 24);
  const before = timeAxisTicks(core.frame(800, 500), '1M');
  core.pan(.25);
  const after = timeAxisTicks(core.frame(800, 500), '1M');
  const previous = new Map(before.map(tick => [tick.time, tick.x]));
  const common = after.filter(tick => previous.has(tick.time));
  assert.ok(common.length >= 3);
  for (const tick of common) {
    assert.equal(new Date(tick.time).getUTCDate(), 1);
    close(tick.x - previous.get(tick.time), -.25 / 24 * 800);
  }
});

test('weekly labels stay anchored to Monday after non-round historical prepend', async () => {
  const core = await ChartCore.create(bytes);
  const weeks = Array.from({ length: 150 }, (_, i) => ({ ...sampleBar(i), time: Date.UTC(2022, 0, 3) + i * 7 * 86400000 }));
  core.apply('replace', weeks.slice(17));
  core.setView(30.25, 60);
  const before = timeAxisTicks(core.frame(800, 500), '1w');
  assert.ok(before.length >= 3);
  core.apply('prepend', weeks.slice(0, 17));
  const after = timeAxisTicks(core.frame(800, 500), '1w');
  assert.deepEqual(after, before);
  assert.ok(after.every(tick => new Date(tick.time).getUTCDay() === 1));
});
