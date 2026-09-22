import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const config = [14, 12, 26, 9, 3];
const data = Array.from({ length: 1100 }, (_, index) => {
  const close = 4000000 + Math.round(Math.sin(index / 13) * 900 + index * 3);
  return { time: (index + 1) * 60000, open: close - 7, high: close + 10, low: close - 10, close, volume: index + 1 };
});
const near = (actual, expected) => Number.isNaN(expected) ? assert.ok(Number.isNaN(actual)) :
  assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} differs from ${expected}`);
async function create(input = data, settings = config) {
  const core = await ChartCore.create(bytes);
  core.configureOscillators(...settings); core.configureIndicators(20, 20, 7);
  core.apply('replace', input); core.resizePlot(12000); core.setView(0, 2000);
  return core;
}

function ema(input, period) {
  const output = input.map(() => NaN);
  if (input.length < period) return output;
  let value = input.slice(0, period).reduce((sum, sample) => sum + sample, 0) / period;
  output[period - 1] = value;
  for (let i = period; i < input.length; i++) {
    value += (input[i] - value) * (2 / (period + 1)); output[i] = value;
  }
  return output;
}

function reference(input, [rsiPeriod, fastPeriod, slowPeriod, signalPeriod]) {
  const closes = input.map(bar => bar.close);
  const rsi = input.map(() => NaN);
  const changes = closes.slice(1).map((close, i) => close - closes[i]);
  let gain = changes.slice(0, rsiPeriod).reduce((sum, value) => sum + Math.max(value, 0), 0) / rsiPeriod;
  let loss = changes.slice(0, rsiPeriod).reduce((sum, value) => sum + Math.max(-value, 0), 0) / rsiPeriod;
  for (let i = rsiPeriod; i < input.length; i++) {
    if (i > rsiPeriod) {
      gain = (gain * (rsiPeriod - 1) + Math.max(changes[i - 1], 0)) / rsiPeriod;
      loss = (loss * (rsiPeriod - 1) + Math.max(-changes[i - 1], 0)) / rsiPeriod;
    }
    rsi[i] = gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  const fast = ema(closes, fastPeriod), slow = ema(closes, slowPeriod);
  const macd = fast.map((value, i) => value - slow[i]);
  const signal = Array(slowPeriod - 1).fill(NaN).concat(ema(macd.slice(slowPeriod - 1), signalPeriod));
  return rsi.map((value, i) => [value, macd[i], signal[i], macd[i] - signal[i]]);
}

function check(core, input, settings = config) {
  core.setView(0, 2000);
  const frame = core.frame(12000, 720), expected = reference(input, settings);
  for (let row = 0; row < frame.rows.length / 17; row++) {
    const index = frame.rows[row * 17];
    for (let field = 0; field < 4; field++) near(frame.oscillators[row * 8 + field], expected[index][field]);
  }
  return frame;
}

test('real Wasm oscillator values match independent full-series references across seed boundaries', async () => {
  for (const settings of [config, [1, 1, 2, 1, 3], [500, 499, 500, 500, 3]]) {
    const core = await create(data, settings);
    check(core, data, settings);
  }
});

test('current-bar revisions, appends, prepends and re-enabling agree with a full rebuild', async () => {
  const input = data.slice(0, 100);
  const core = await create(input), rebuilt = await create(input);
  for (let i = 0; i < 16; i++) {
    input[99] = { ...input[99], close: input[99].open + (i % 2 ? 15 : -12), high: input[99].open + 20, low: input[99].open - 20 };
    core.apply('upsert', [input[99]]); rebuilt.apply('replace', input);
    assert.deepEqual(check(core, input).oscillators, check(rebuilt, input).oscillators);
  }
  core.apply('upsert', data.slice(100, 125)); input.push(...data.slice(100, 125)); check(core, input);
  const history = await create(data.slice(50, 180));
  history.apply('prepend', data.slice(0, 50)); check(history, data.slice(0, 180));
  history.configureOscillators(14, 12, 26, 9, 0);
  history.apply('upsert', data.slice(180, 190));
  assert.ok([...history.frame(12000, 720).oscillators].every(Number.isNaN));
  history.configureOscillators(...config); check(history, data.slice(0, 190));
  history.configureOscillators(7, 5, 13, 4, 3); check(history, data.slice(0, 190), [7, 5, 13, 4]);
});

test('oscillator configuration rejection is atomic and output copies survive later Wasm calls', async () => {
  const core = await create();
  const before = core.frame(12000, 720), copy = before.oscillators.slice();
  for (const invalid of [[0, 12, 26, 9, 3], [14, 26, 12, 9, 3], [14, 12, 26, 501, 3], [14, 12, 26, 9, 4], ['14', 12, 26, 9, 3]]) {
    assert.throws(() => core.configureOscillators(...invalid), /Invalid oscillator/);
    assert.deepEqual(core.frame(12000, 720), before);
  }
  core.configureOscillators(2, 2, 3, 2, 3); core.frame(900, 500);
  assert.deepEqual(before.oscillators, copy);
});

test('all four panes share row slots while auxiliary axes ignore price inversion and transformations', async () => {
  const core = await create(data.slice(0, 300));
  core.resizePlot(900); core.setView(120, 100);
  const frame = core.frame(900, 720);
  assert.deepEqual(frame.panes.map(pane => pane.id), [0, 1, 2, 3]);
  assert.equal(frame.oscillators.length, frame.rows.length / 17 * 8);
  assert.equal(frame.panes[1].contentTop, frame.meta[5]);
  assert.equal(frame.panes[1].contentBottom, frame.meta[6]);
  assert.deepEqual([frame.panes[2].min, frame.panes[2].max], [0, 100]);
  assert.ok(frame.panes[3].min < 0 && frame.panes[3].max > 0);
  for (let i = 0; i < frame.rows.length / 17; i++) {
    assert.equal(core.hit(frame.rows[i * 17 + 9], 900), frame.rows[i * 17]);
    for (let field = 0; field < 4; field++) {
      const id = field === 0 ? 2 : 3, value = frame.oscillators[i * 8 + field], y = frame.oscillators[i * 8 + field + 4];
      near(core.paneValueToY(id, value, 900, 720), y);
      near(core.paneValueAtY(id, y, 900, 720), value);
    }
  }
  const ticks = [];
  for (let i = 0; i < frame.paneTicks.length; i += 3) {
    const [id, value, y] = frame.paneTicks.slice(i, i + 3);
    near(core.paneValueToY(id, value, 900, 720), y); ticks.push([id, value]);
  }
  assert.ok(ticks.some(([id, value]) => id === 3 && value === 0));
  core.configurePriceScale('logarithmic', true);
  const inverted = core.frame(900, 720);
  assert.deepEqual(inverted.oscillators, frame.oscillators);
  assert.deepEqual(inverted.panes.slice(1), frame.panes.slice(1));
  assert.ok(Number.isNaN(core.paneValueAtY(9, 200, 900, 720)));
});

test('pane weights resize adjacent active windows, fit small heights and retain hidden preferences', async () => {
  const core = await create(data.slice(0, 150));
  const original = core.frame(900, 720);
  const weights = core.getPaneWeights();
  for (const invalid of [[], [1, 2, 3], [1, 2, 3, 0], [1, 2, NaN, 3], [1, 2, 3, Infinity]]) {
    assert.throws(() => core.setPaneWeights(invalid)); assert.deepEqual(core.getPaneWeights(), weights);
  }
  core.resizePane(1, 30, 720);
  const resized = core.frame(900, 720);
  near(resized.panes[0].bottom, original.panes[0].bottom);
  near(resized.panes[1].bottom, original.panes[1].bottom + 30);
  near(resized.panes[2].bottom, original.panes[2].bottom);
  assert.equal(core.getPaneWeights()[0], weights[0]); assert.equal(core.getPaneWeights()[3], weights[3]);
  const small = core.frame(900, 80);
  for (const pane of small.panes) near(pane.bottom - pane.top, 20);
  const rsiTicks = [];
  for (let i = 0; i < small.paneTicks.length; i += 3) if (small.paneTicks[i] === 2) rsiTicks.push(small.paneTicks[i + 1]);
  assert.deepEqual(rsiTicks, [0, 100]);
  const retained = core.getPaneWeights();
  core.configureIndicators(20, 20, 3); core.configureOscillators(14, 12, 26, 9, 2);
  assert.deepEqual(core.frame(900, 720).panes.map(pane => pane.id), [0, 3]);
  core.resizePane(0, -50, 720);
  assert.equal(core.getPaneWeights()[1], retained[1]); assert.equal(core.getPaneWeights()[2], retained[2]);
  assert.throws(() => core.resizePane(1, 30, 720));
  assert.ok(Number.isNaN(core.paneValueToY(2, 50, 900, 720)));
});

test('MACD ranges lock with the first pan and survive history, live updates and geometry changes', async () => {
  const core = await create(data.slice(50, 300));
  core.resizePlot(900); core.setView(130, 100);
  const range = frame => [frame.panes.find(pane => pane.id === 3).min, frame.panes.find(pane => pane.id === 3).max];
  const initial = core.frame(900, 720), retainedTicks = initial.paneTicks.slice();
  core.pan(3); const locked = core.frame(900, 720);
  assert.deepEqual(range(locked), range(initial));
  core.apply('prepend', data.slice(0, 50)); core.apply('upsert', data.slice(300, 305));
  core.resizePane(2, 20, 720); core.configurePriceScale('percentage', true);
  assert.deepEqual(range(core.frame(900, 720)), range(locked));
  core.configureOscillators(...config); core.zoom(1, 0.5);
  assert.deepEqual(range(core.frame(900, 720)), range(locked));
  core.zoom(2, 0.5);
  assert.equal(core.scaleIsAuto, true);
  assert.notDeepEqual(range(core.frame(900, 720)), range(locked));
  assert.deepEqual(initial.paneTicks, retainedTicks);
});

test('cached axes are invalidated by geometry, indicator, price mode and data mutations', async () => {
  const input = data.slice(0, 150), core = await create(input);
  core.resizePlot(900); core.setView(50, 100);
  const initial = core.frame(900, 720);
  core.resizePane(1, 30, 720);
  const moved = core.paneValueToY(2, 50, 900, 720);
  assert.notEqual(moved, (initial.panes[2].contentTop + initial.panes[2].contentBottom) / 2);
  const resized = core.frame(900, 720), rsi = resized.panes[2];
  near(moved, (rsi.contentTop + rsi.contentBottom) / 2);
  near(core.paneValueAtY(2, moved, 900, 720), 50);
  core.configurePriceScale('normal', true);
  const flipped = core.priceToY(input[100].close, 900, 720);
  const inverted = core.frame(900, 720);
  near(flipped, inverted.rows[(100 - inverted.rows[0]) * 17 + 13]);
  const oldZero = core.paneValueToY(3, 0, 900, 720);
  input[149] = { ...input[149], close: 4500000, high: 4500010 };
  core.apply('upsert', [input[149]]);
  const newZero = core.paneValueToY(3, 0, 900, 720);
  assert.notEqual(newZero, oldZero);
  core.frame(900, 720); near(core.paneValueAtY(3, newZero, 900, 720), 0);
  core.configureOscillators(14, 12, 26, 9, 1);
  assert.ok(Number.isNaN(core.paneValueToY(3, 0, 900, 720)));
  const expanded = core.paneValueToY(2, 50, 900, 720);
  const withoutMacd = core.frame(900, 720).panes[2];
  near(expanded, (withoutMacd.contentTop + withoutMacd.contentBottom) / 2);
});

test('cached projection keys survive drawing metadata calls and reject different viewport dimensions', async () => {
  const core = await create(data.slice(0, 150));
  core.resizePlot(900); core.setView(50, 100); core.frame(900, 720);
  const y = core.paneValueToY(2, 30, 900, 720);
  const priceY = core.priceToY(data[100].close, 900, 720);
  core.drawingPoint(400, 50, 700, 450);
  near(core.paneValueToY(2, 30, 900, 720), y);
  near(core.priceToY(data[100].close, 900, 720), priceY);
  const shorter = core.paneValueToY(2, 30, 700, 450);
  assert.notEqual(shorter, y);
  core.frame(700, 450); near(core.paneValueAtY(2, shorter, 700, 450), 30);
  core.setPaneWeights([1, 1, 1, 1]);
  const relayout = core.paneValueToY(2, 30, 700, 450);
  core.frame(700, 450); near(core.paneValueAtY(2, relayout, 700, 450), 30);
});
