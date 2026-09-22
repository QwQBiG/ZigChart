import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (index, close = 100 + index * index % 79) => ({ time: (index + 1) * 60000,
  open: close, high: close + 1, low: close - 1, close, volume: 100 + index });
const source = (start, count) => Array.from({ length: count }, (_, i) => bar(start + i));
const close = (actual, expected) => Number.isNaN(expected) ? assert.ok(Number.isNaN(actual)) :
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function verify(core, data, maPeriod, emaPeriod) {
  let ema = NaN;
  for (let i = 0; i < data.length; i++) {
    const average = period => data.slice(i + 1 - period, i + 1).reduce((sum, item) => sum + item.close, 0) / period;
    const ma = i + 1 < maPeriod ? NaN : average(maPeriod);
    if (i + 1 === emaPeriod) ema = average(emaPeriod);
    else if (i + 1 > emaPeriod) ema += 2 / (emaPeriod + 1) * (data[i].close - ema);
    close(core.inspect(i).ma, ma); close(core.inspect(i).ema, ema);
  }
}

test('fresh charts show candles only; hidden averages cannot expand the price range', async () => {
  const core = await ChartCore.create(bytes);
  const data = Array.from({ length: 100 }, (_, i) => bar(i, i < 90 ? 10000 : 100));
  core.apply('replace', data); core.setView(90, 10);
  const candles = core.frame(600, 500);
  assert.equal(candles.meta[4], 490);
  assert.equal(candles.meta[5], candles.meta[6]);
  assert.ok(candles.meta[1] < 110);
  const values = core.inspect(95);
  for (const mask of [1, 2]) {
    core.configureIndicators(20, 20, mask);
    assert.ok(core.frame(600, 500).meta[1] > 9000);
    assert.deepEqual(core.inspect(95), values);
  }
  core.configureIndicators(20, 20, 4);
  const volume = core.frame(600, 500);
  assert.ok(volume.meta[5] < volume.meta[6]);
  assert.ok(volume.meta[4] < candles.meta[4]);
  assert.deepEqual(volume.meta.slice(8), candles.meta.slice(8));
  assert.deepEqual(volume.meta.slice(0, 2), candles.meta.slice(0, 2));
  for (let i = 9; i < candles.rows.length; i += 17) assert.equal(volume.rows[i], candles.rows[i]);
  core.configureIndicators(20, 20, 0);
  assert.deepEqual(core.frame(600, 500), candles);
});

test('independent MA and EMA seeds remain correct after revisions, prepends and parameter changes', async () => {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(3, 5, 3);
  let data = source(10, 25);
  core.apply('replace', data); verify(core, data, 3, 5);
  const revision = bar(34, 450);
  core.apply('upsert', [revision, ...source(35, 2)]);
  data = [...data.slice(0, -1), revision, ...source(35, 2)];
  verify(core, data, 3, 5);
  core.apply('prepend', source(0, 10)); data = [...source(0, 10), ...data];
  verify(core, data, 3, 5);
  const ema = data.map((_, i) => core.inspect(i).ema);
  core.configureIndicators(7, 5, 3); verify(core, data, 7, 5);
  assert.deepEqual(data.map((_, i) => core.inspect(i).ema), ema);
  core.configureIndicators(7, 9, 3); verify(core, data, 7, 9);
});

test('invalid and no-op configurations preserve locked transforms and the horizontal viewport', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', source(0, 200)); core.pan(-1);
  core.apply('upsert', [bar(199, 1000000)]);
  const locked = core.frame(600, 500);
  core.configureIndicators(20, 20, 0);
  assert.deepEqual(core.frame(600, 500), locked);
  for (const args of [[0, 20, 0], [501, 20, 0], [20, 2.5, 0], [20, NaN, 0],
    [20, 20, -1], [20, 20, 8], [20, 20, 1.5], [20, 20, 4294967297], ['20', 20, 0]]) {
    assert.throws(() => core.configureIndicators(...args), /Invalid indicator/);
    assert.deepEqual(core.frame(600, 500), locked);
  }
  core.configureIndicators(20, 20, 1);
  const refit = core.frame(600, 500);
  assert.ok(refit.meta[1] > 1000000);
  assert.deepEqual(refit.meta.slice(8), locked.meta.slice(8));
  const { instance } = await WebAssembly.instantiate(bytes, {});
  assert.equal(instance.exports.configure_indicators(2.5, 20, 0), 1);
  assert.equal(instance.exports.configure_indicators(20, 20, 4294967297), 1);
});

test('periods one and five hundred handle seed boundaries and incremental updates', async () => {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(1, 500, 3);
  const data = source(0, 499);
  core.apply('replace', data);
  close(core.inspect(498).ma, data[498].close);
  assert.ok(Number.isNaN(core.inspect(498).ema));
  core.apply('upsert', source(499, 2)); data.push(...source(499, 2));
  verify(core, data, 1, 500);
  core.configureIndicators(500, 1, 3); verify(core, data, 500, 1);
});
