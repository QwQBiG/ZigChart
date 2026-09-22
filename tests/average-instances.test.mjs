import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { addAverage, createIndicatorState, parseIndicatorState, setIndicatorEnabled, updateStudy } from '../web/src/features/analysis/model.ts';
import { averageValuesAt } from '../web/src/features/analysis/values.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (i, close = 100 + i * i % 79) => ({ time: (i + 1) * 60000, open: close, high: close + 1, low: close - 1, close, volume: 100 });
const source = (start, count) => Array.from({ length: count }, (_, i) => bar(start + i));
const configs = [{ slot: 0, kind: 'ma', period: 3 }, { slot: 5, kind: 'ema', period: 7 }];

test('average instances migrate, retain independent identities and enforce bounded membership', () => {
  let state = createIndicatorState();
  const legacy = { ...state, version: 2 }; delete legacy.averages;
  assert.deepEqual(parseIndicatorState(legacy), state);
  state = addAverage(addAverage(state, 'ma'), 'ma');
  state = addAverage(addAverage(state, 'ema'), 'ema');
  const first = state.averages[0].id, second = state.averages[1].id;
  const edited = updateStudy(state, first, { period: 7, color: '#123456', width: 4 });
  assert.equal(state.averages[0].period, 20);
  assert.equal(edited.averages[0].period, 7);
  assert.deepEqual(edited.ema, state.ema);
  const removed = setIndicatorEnabled(edited, first, false);
  assert.deepEqual(removed.averages.map(item => item.id), [second]);
  assert.equal(updateStudy(removed, first, { period: 10 }), null);
  state = removed;
  for (let i = 0; i < 8; i++) state = addAverage(state, 'ma');
  assert.equal(state.averages.length, 6);
  assert.equal(addAverage(state, 'ema'), state);
  assert.deepEqual(parseIndicatorState(JSON.parse(JSON.stringify(state))), state);
  assert.equal(parseIndicatorState({ ...state, averages: [...state.averages, state.averages[0]] }), null);
  assert.equal(parseIndicatorState({ ...state, averages: [state.averages[0], state.averages[0]] }), null);
  assert.equal(updateStudy(state, second, { period: 501 }), null);
  assert.equal(updateStudy(state, second, { kind: 'rsi' }), null);
});

function verify(core, bars) {
  core.setView(0, bars.length);
  const frame = core.frame(1000, 600);
  let ema = NaN;
  for (let i = 0; i < bars.length; i++) {
    const mean = period => bars.slice(i + 1 - period, i + 1).reduce((sum, item) => sum + item.close, 0) / period;
    const ma = i < 2 ? NaN : mean(3);
    if (i === 6) ema = mean(7);
    if (i > 6) ema += (bars[i].close - ema) / 4;
    const values = averageValuesAt(frame, i);
    for (const [slot, expected] of [[0, ma], [5, ema]]) {
      if (Number.isNaN(expected)) assert.ok(Number.isNaN(values[slot]));
      else {
        assert.ok(Math.abs(values[slot] - expected) < 1e-9);
        assert.ok(Math.abs(frame.averages[i * 12 + slot * 2 + 1] - core.priceToY(expected, 1000, 600)) < 1e-8);
      }
    }
    assert.ok(values.slice(1, 5).every(Number.isNaN));
  }
  return frame;
}

test('Wasm multi-average batches match independent formulas across updates and retain copied frames', async () => {
  const core = await ChartCore.create(bytes);
  core.configureAverages(configs);
  let data = source(10, 25);
  core.apply('replace', data); verify(core, data);
  const revision = bar(34, 450);
  core.apply('upsert', [revision, bar(35)]); data = [...data.slice(0, -1), revision, bar(35)];
  verify(core, data);
  core.apply('prepend', source(0, 10)); data = [...source(0, 10), ...data];
  const copied = verify(core, data), saved = copied.averages.slice();
  data[20] = bar(20, -20); core.apply('correct', [data[20]]); verify(core, data);
  assert.deepEqual(copied.averages, saved);
  core.pan(1); const locked = core.frame(1000, 600);
  core.configureAverages(configs); assert.deepEqual(core.frame(1000, 600), locked);
  for (const invalid of [[...configs, configs[0]], [{ slot: 6, kind: 'ma', period: 3 }], [{ slot: 0, kind: 'ma', period: NaN }]]) {
    assert.throws(() => core.configureAverages(invalid), /Invalid average/);
    assert.deepEqual(core.frame(1000, 600), locked);
  }
  core.configureAverages([]); assert.equal(core.frame(1000, 600).averages, undefined);
});

test('extra averages participate in auto fitting and logarithmic eligibility without creating panes', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', Array.from({ length: 100 }, (_, i) => bar(i, i < 90 ? -10000 : 100)));
  core.setView(90, 10); core.configurePriceScale('logarithmic', false);
  const candles = core.frame(600, 500);
  assert.equal(candles.priceAxis.effectiveMode, 1);
  core.configureAverages([{ slot: 2, kind: 'ma', period: 20 }]);
  const study = core.frame(600, 500);
  assert.ok(study.meta[0] < -4000);
  assert.equal(study.priceAxis.effectiveMode, 0);
  assert.equal(study.panes.length, 1);
  assert.deepEqual(study.meta.slice(8), candles.meta.slice(8));
  core.configureAverages([]);
  assert.deepEqual(core.frame(600, 500), candles);
});
