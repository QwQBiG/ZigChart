import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = Array.from({ length: 100 }, (_, i) => ({
  time: (i + 1) * 60_000, open: 1000 + i, high: 1020 + i, low: 980 + i, close: 1005 + i, volume: 100 + i,
}));

test('price references share every price transform without changing viewport, ranges or locks', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars); core.configureIndicators(20, 20, 4); core.setView(35, 40);
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) {
    for (const inverted of [false, true]) {
      core.configurePriceScale(mode, inverted); core.pan(1);
      const before = core.frame(800, 600);
      const lines = [{ price: 1050, axisLabel: true }, { price: 1051, axisLabel: true }, { price: 1e12, axisLabel: true }];
      const output = core.projectPriceLines(lines, 800, 600);
      assert.equal(output.length, 9);
      for (let i = 0; i < 2; i++) {
        assert.equal(output[i * 3], lines[i].price);
        assert.ok(Math.abs(output[i * 3 + 1] - core.priceToY(lines[i].price, 800, 600)) < 1e-8);
      }
      assert.ok(Math.abs(output[2] - output[5]) >= 22 - 1e-8);
      assert.ok(Number.isNaN(output[7]) && Number.isNaN(output[8]));
      assert.equal(core.scaleIsAuto, false);
      assert.deepEqual(core.frame(800, 600), before);
      const copied = output.slice(); core.projectPriceLines([{ price: 1052, axisLabel: false }], 800, 600);
      assert.deepEqual(output, copied);
      const reserved = core.projectPriceLines([{ price: 1050, axisLabel: true }], 800, 600, 1050);
      assert.ok(Number.isFinite(reserved[1]) && Number.isNaN(reserved[2]));
      assert.throws(() => core.projectPriceLines([], 800, 600, 1050.1), /Invalid reserved price/);
    }
  }
});

test('price reference validation is atomic; empty and maximized auxiliary panes have no projections', async () => {
  const core = await ChartCore.create(bytes);
  assert.ok(Number.isNaN(core.projectPriceLines([{ price: 1000, axisLabel: true }], 800, 600)[1]));
  core.apply('replace', bars); core.configureIndicators(20, 20, 4);
  const before = core.frame(800, 600);
  for (const lines of [[{ price: NaN, axisLabel: true }], [{ price: 1.1, axisLabel: true }],
    [{ price: 1e12 + 1, axisLabel: true }], [{ price: 1000, axisLabel: 1 }],
    Array.from({ length: 17 }, () => ({ price: 1000, axisLabel: true }))]) {
    assert.throws(() => core.projectPriceLines(lines, 800, 600));
    assert.deepEqual(core.frame(800, 600), before);
  }
  for (const [width, height] of [[0, 600], [800, -1], [Infinity, 600], [800, NaN]]) {
    assert.throws(() => core.projectPriceLines([{ price: 1000, axisLabel: true }], width, height));
  }
  core.maximizePane(1); core.frame(800, 600);
  const hidden = core.projectPriceLines([{ price: 1000, axisLabel: true }], 800, 600);
  assert.ok(Number.isNaN(hidden[1]) && Number.isNaN(hidden[2]));
  assert.equal(core.projectPriceLines([], 800, 600).length, 0);
});
