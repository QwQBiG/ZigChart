import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { donchianValuesAt } from '../web/src/features/analysis/values.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (i, close = 1000 + i * i % 97) => ({ time: (i + 1) * 60_000,
  open: close, high: close + (i * 7 % 13), low: close - (i * 11 % 17), close, volume: 100 });
const source = (start, count) => Array.from({ length: count }, (_, i) => bar(start + i));

function verify(core, bars, period = 7) {
  core.setView(0, bars.length);
  const frame = core.frame(1500, 600);
  assert.equal(frame.donchian.length, frame.rows.length / 17 * 6);
  for (let i = 0; i < bars.length; i++) {
    const actual = donchianValuesAt(frame, i);
    if (i < period - 1) { assert.ok(Object.values(actual).every(Number.isNaN)); continue; }
    const window = bars.slice(i + 1 - period, i + 1);
    const upper = Math.max(...window.map(item => item.high));
    const lower = Math.min(...window.map(item => item.low));
    const middle = (upper + lower) / 2;
    for (const [column, key, expected] of [[0, 'middle', middle], [1, 'upper', upper], [2, 'lower', lower]]) {
      assert.equal(actual[key], expected, `${key} at ${i}`);
      assert.ok(Math.abs(frame.donchian[i * 6 + column + 3] - core.priceToY(expected, 1500, 600)) < 1e-7);
    }
  }
  assert.equal(donchianValuesAt(frame, -1), null);
  assert.equal(donchianValuesAt(frame, bars.length), null);
  return frame;
}

test('Donchian Wasm rows match inclusive extrema through updates and own copied memory', async () => {
  const core = await ChartCore.create(bytes);
  let data = source(10, 40);
  core.configureDonchian(7, true); core.apply('replace', data); verify(core, data);
  const revised = { ...bar(49), high: 1900 };
  core.apply('upsert', [revised, bar(50)]); data = [...data.slice(0, -1), revised, bar(50)]; verify(core, data);
  const earlier = source(0, 10); core.apply('prepend', earlier); data = [...earlier, ...data];
  const copied = verify(core, data), saved = copied.donchian.slice();
  data[20] = { ...data[20], low: 400 }; core.apply('correct', [data[20]]); verify(core, data);
  assert.deepEqual(copied.donchian, saved);
  core.configureDonchian(7, false); assert.equal(core.frame(1500, 600).donchian, undefined);
  core.configureDonchian(1, true); verify(core, data, 1);
});

test('Donchian configuration and price bounds preserve the shared viewport and panes', async () => {
  const core = await ChartCore.create(bytes);
  const data = source(0, 100).map((item, i) => i === 79 ? { ...item, high: 4000, low: -5 } : item);
  core.apply('replace', data); core.configureIndicators(20, 20, 4); core.setView(80, 10);
  core.configurePriceScale('logarithmic', false);
  const before = core.frame(800, 600);
  assert.equal(before.priceAxis.effectiveMode, 1);
  core.maximizePane(0); core.configureDonchian(20, true);
  const enabled = core.frame(800, 600);
  assert.equal(enabled.priceAxis.effectiveMode, 0);
  assert.ok(enabled.meta[1] > before.meta[1]);
  assert.equal(core.maximizedPane, 0);
  assert.deepEqual(enabled.meta.slice(8), before.meta.slice(8));
  for (const args of [[0, true], [501, true], [2.5, true], [20, 1]]) {
    assert.throws(() => core.configureDonchian(...args), /Invalid Donchian/);
    assert.deepEqual(core.frame(800, 600), enabled);
  }
  core.configureDonchian(20, false);
  assert.equal(core.frame(800, 600).priceAxis.effectiveMode, 1);
});
