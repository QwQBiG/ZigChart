import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (index, close) => ({ time: index * 60000, open: close, high: close + 1, low: close - 1, close, volume: 100 });
function expectedEma(data, period) {
  let value = NaN;
  if (data.length >= period) {
    value = data.slice(0, period).reduce((sum, item) => sum + item.close, 0) / period;
    for (let i = period; i < data.length; i++) value += 2 / (period + 1) * (data[i].close - value);
  }
  return value;
}

test('Wasm EMA repeated revisions preserve seed and prior-bar state at periods 1, 20 and 500', async () => {
  for (const period of [1, 20, 500]) {
    const core = await ChartCore.create(bytes);
    core.configureIndicators(20, period, 3);
    const data = Array.from({ length: Math.max(1, period - 1) }, (_, i) => bar(i, 700 + i * 47 % 177));
    core.apply('replace', data);
    for (let stage = 0; stage < 3; stage++) {
      for (let revision = 0; revision < 32; revision++) {
        data[data.length - 1] = bar(data.length - 1, revision % 2 ? 999999999999 : -999999999999);
        core.apply('upsert', [data.at(-1)]);
        assert.equal(core.inspect(data.length - 1).ema, expectedEma(data, period));
      }
      const next = bar(data.length, 500);
      data.push(next);
      core.apply('upsert', [next]);
    }
  }
});
