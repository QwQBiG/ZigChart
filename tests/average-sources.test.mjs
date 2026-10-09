import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { INDICATOR_SOURCES } from '../web/src/chart/indicator-source.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const prices = [[10, 19, 4, 15], [17, 24, 13, 21], [-4, 5, -9, 2], [6, 16, 1, 12], [-5, 0, -13, -8], [18, 32, 12, 28]];
const samples = {
  close: [15, 21, 2, 12, -8, 28], open: [10, 17, -4, 6, -5, 18],
  high: [19, 24, 5, 16, 0, 32], low: [4, 13, -9, 1, -13, 12],
  hl2: [11.5, 18.5, -2, 8.5, -6.5, 22], hlc3: [38 / 3, 58 / 3, -2 / 3, 29 / 3, -7, 24],
  ohlc4: [12, 18.75, -1.5, 8.75, -6.5, 22.5], hlcc4: [13.25, 19.75, 0, 10.25, -7.25, 25],
};
const bars = (count, start = 0) => Array.from({ length: count }, (_, offset) => {
  const i = start + offset, [open, high, low, close] = prices[i % prices.length].map(value => value + Math.floor(i / 6) * 50);
  return { time: (i + 1) * 60_000, open, high, low, close, volume: 100 + i };
});
const near = (actual, expected) => Number.isNaN(expected) ? assert.ok(Number.isNaN(actual))
  : assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function expected(values, period, exponential = false) {
  let previous;
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    const mean = values.slice(i - period + 1, i + 1).reduce((sum, value) => sum + value, 0) / period;
    previous = exponential && i >= period ? previous * (1 - 2 / (period + 1)) + values[i] * 2 / (period + 1) : mean;
    return previous;
  });
}

test('all eight sources use documented prices without rounding derived values', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(6));
  for (const source of INDICATOR_SOURCES) {
    core.configureIndicators(2, 3, 3, source, source);
    const ma = expected(samples[source], 2), ema = expected(samples[source], 3, true);
    for (let i = 0; i < 6; i++) { near(core.inspect(i).ma, ma[i]); near(core.inspect(i).ema, ema[i]); }
    core.configureIndicators(1, 1, 3, source, source);
    for (let i = 0; i < 6; i++) { near(core.inspect(i).ma, samples[source][i]); near(core.inspect(i).ema, samples[source][i]); }
  }
});

test('independent sources revise from changed OHLC fields and survive history prepends', async () => {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(3, 4, 3, 'open', 'high');
  core.configureAverages([{ slot: 0, kind: 'ma', period: 2, source: 'low' }, { slot: 5, kind: 'ema', period: 5, source: 'hlcc4' }]);
  let data = bars(20, 10);
  function verify() {
    const ma = expected(data.map(bar => bar.open), 3), ema = expected(data.map(bar => bar.high), 4, true);
    const low = expected(data.map(bar => bar.low), 2);
    const weighted = expected(data.map(bar => (bar.high + bar.low + 2 * bar.close) / 4), 5, true);
    for (let i = 0; i < data.length; i++) { near(core.inspect(i).ma, ma[i]); near(core.inspect(i).ema, ema[i]); }
    const frame = core.frame(900, 600);
    for (let row = 0; row < frame.rows.length / 17; row++) {
      const i = frame.rows[row * 17]; near(frame.averages[row * 12], low[i]); near(frame.averages[row * 12 + 10], weighted[i]);
    }
  }
  core.apply('replace', data); verify();
  const revision = { ...data.at(-1), open: data.at(-1).open - 2, high: data.at(-1).high + 11, low: data.at(-1).low - 4 };
  core.apply('upsert', [revision, ...bars(2, 30)]); data = [...data.slice(0, -1), revision, ...bars(2, 30)]; verify();
  core.setView(5, 10); core.pan(-1);
  const corrected = { ...data[5], open: data[5].low, high: data[5].high + 19, low: data[5].low - 3 };
  core.apply('correct', [corrected]); data[5] = corrected; verify(); assert.equal(core.scaleIsAuto, false);
  core.apply('prepend', bars(10)); data = [...bars(10), ...data]; verify();
});

test('source validation is atomic and only effective source changes refit the price scale', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars(100)); core.configureIndicators(3, 4, 7, 'high', 'low');
  core.configureAverages([{ slot: 2, kind: 'ma', period: 7, source: 'ohlc4' }]);
  core.setView(20, 40); core.pan(-1);
  const before = core.frame(900, 600);
  core.configureIndicators(3, 4, 7, 'high', 'low');
  core.configureAverages([{ slot: 2, kind: 'ma', period: 7, source: 'ohlc4' }]);
  assert.deepEqual(core.frame(900, 600), before); assert.equal(core.scaleIsAuto, false);
  for (const source of [null, 1, NaN, 'Close', 'volume', {}, '']) {
    assert.throws(() => core.configureIndicators(6, 8, 0, 'open', source), /Invalid indicator/);
    assert.throws(() => core.configureAverages([{ slot: 0, kind: 'ma', period: 1, source: 'open' },
      { slot: 2, kind: 'ema', period: 5, source }]), /Invalid average/);
    assert.deepEqual(core.frame(900, 600), before);
  }
  core.maximizePane(1);
  const focused = core.frame(900, 600);
  core.configureIndicators(3, 4, 7, 'hl2', 'low');
  assert.equal(core.scaleIsAuto, true);
  assert.deepEqual(core.frame(900, 600).meta.slice(8), focused.meta.slice(8));
  const geometry = panes => panes.map(({ id, top, bottom, contentTop, contentBottom }) => ({ id, top, bottom, contentTop, contentBottom }));
  assert.deepEqual(geometry(core.frame(900, 600).panes), geometry(focused.panes));
});

test('additive source configuration preserves legacy close APIs and output layouts', async () => {
  const { instance } = await WebAssembly.instantiate(bytes, {}), wasm = instance.exports;
  const data = bars(6), raw = new Float64Array(wasm.memory.buffer, wasm.input_ptr(), data.length * 6);
  data.forEach((bar, i) => raw.set([bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume], i * 6));
  assert.equal(wasm.abi_version(), 1); assert.equal(wasm.apply(0, data.length), 0);
  const inspect = () => Array.from(new Float64Array(wasm.memory.buffer, wasm.inspect(5), 9));
  assert.equal(wasm.configure_indicators_v2(2, 3, 3, 2, 3), 0);
  const before = inspect();
  for (const invalid of [NaN, Infinity, -1, 1.5, 8, 4294967296]) {
    assert.equal(wasm.configure_indicators_v2(7, 8, 0, 0, invalid), 1);
    assert.deepEqual(inspect(), before);
  }
  assert.equal(wasm.configure_indicators(2, 3, 3), 0);
  near(inspect()[7], expected(samples.close, 2)[5]); near(inspect()[8], expected(samples.close, 3, true)[5]);
  const extras = new Float64Array(wasm.memory.buffer, wasm.overlay_input_v2_ptr(), 18);
  for (let slot = 0; slot < 6; slot++) extras.set([0, 20, 0], slot * 3);
  extras.set([1, 1, 2], 0); assert.equal(wasm.configure_overlays_v2(), 0);
  const rows = wasm.frame(900, 600);
  near(new Float64Array(wasm.memory.buffer, wasm.overlay_frame_ptr(), rows * 12)[0], samples.high[0]);
  extras.set([2, 3, 0], 0); extras[17] = 8;
  assert.equal(wasm.configure_overlays_v2(), 1); wasm.frame(900, 600);
  near(new Float64Array(wasm.memory.buffer, wasm.overlay_frame_ptr(), rows * 12)[0], samples.high[0]);
  const legacy = new Float64Array(wasm.memory.buffer, wasm.overlay_input_ptr(), 12);
  for (let slot = 0; slot < 6; slot++) legacy.set([0, 20], slot * 2);
  legacy.set([1, 1], 0); assert.equal(wasm.configure_overlays(), 0); wasm.frame(900, 600);
  near(new Float64Array(wasm.memory.buffer, wasm.overlay_frame_ptr(), rows * 12)[0], samples.close[0]);
});
