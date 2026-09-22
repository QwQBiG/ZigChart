import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const modes = ['normal', 'logarithmic', 'percentage', 'indexed'];
const near = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
const bars = Array.from({ length: 100 }, (_, i) => ({
  time: (i + 1) * 60000, open: 1000 + i * 5, high: 1010 + i * 5,
  low: 995 + i * 5, close: 1005 + i * 5, volume: i + 1,
}));
async function create() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars); core.configureIndicators(3, 3, 7);
  core.resizePlot(900); core.setView(20.75, 30);
  return core;
}

test('real Wasm: modes keep one frame contract for candles, studies, ticks and drawings', async () => {
  const core = await create();
  const original = core.frame(900, 600);
  for (const [requestedMode, mode] of modes.entries()) {
    for (const inverted of [false, true]) {
      core.configurePriceScale(mode, inverted);
      const frame = core.frame(900, 600);
      assert.equal(frame.meta.length, 13);
      assert.equal(frame.rows.length % 17, 0);
      assert.deepEqual(frame.meta.slice(2), original.meta.slice(2));
      assert.deepEqual(frame.priceAxis, { requestedMode, effectiveMode: requestedMode, inverted, base: bars[21].close });
      const row = frame.rows.slice(17, 34);
      for (const [value, y] of [[row[2], row[10]], [row[5], row[13]], [row[7], row[15]], [row[8], row[16]]]) {
        near(core.priceToY(value, 900, 600), y);
        near(core.priceAtY(y, 900, 600), value);
      }
      const anchor = { time: row[1], price: row[5] };
      const geometry = core.projectDrawings([{ kind: 'horizontal', a: anchor, b: anchor }], 900, 600)[0];
      assert.equal(geometry.valid, true);
      near(geometry.y1, row[13]);
      assert.equal(core.drawingPoint(row[9], row[13], 900, 600).price, row[5]);
      assert.ok(frame.priceTicks.length >= 3 && frame.priceTicks.length <= 48);
      for (let i = 0; i < frame.priceTicks.length; i += 3) {
        const [price, y, value] = frame.priceTicks.slice(i, i + 3);
        near(core.priceToY(price, 900, 600), y);
        const relative = (price - frame.priceAxis.base) / Math.abs(frame.priceAxis.base) * 100;
        near(value, mode === 'percentage' ? relative : mode === 'indexed' ? relative + 100 : price);
      }
    }
  }
  assert.equal(core.count, bars.length);
  assert.equal(core.inspect(30).close, bars[30].close);
});

test('real Wasm: mode validation is atomic and copied axis batches survive later calls', async () => {
  const core = await create();
  core.configurePriceScale('percentage', true);
  const retained = core.frame(900, 600);
  const saved = { axis: { ...retained.priceAxis }, ticks: retained.priceTicks.slice(), rows: retained.rows.slice() };
  for (const mode of ['bogus', 'constructor', '__proto__', null]) assert.throws(() => core.configurePriceScale(mode, false));
  assert.throws(() => core.configurePriceScale('normal', 1));
  assert.deepEqual(core.frame(900, 600), retained);
  core.configurePriceScale('logarithmic', false); core.scalePrice(2, 0.25); core.frame(600, 500);
  core.priceToY(100, 600, 500); core.priceAtY(250, 600, 500);
  assert.deepEqual(retained.priceAxis, saved.axis);
  assert.deepEqual(retained.priceTicks, saved.ticks);
  assert.deepEqual(retained.rows, saved.rows);
  assert.ok(Number.isNaN(core.priceToY(100, 0, 500)));
  assert.ok(Number.isNaN(core.priceAtY(NaN, 600, 500)));
});

test('real Wasm: positive log padding, zero-base fallback and signed relative labels are explicit', async () => {
  const core = await ChartCore.create(bytes);
  const bar = { time: 60000, open: 1, high: 1e12, low: 1, close: 1, volume: 1 };
  core.apply('replace', [bar]); core.configurePriceScale('logarithmic', false);
  let frame = core.frame(900, 600);
  assert.equal(frame.priceAxis.effectiveMode, 1);
  assert.ok(frame.meta[0] > 0 && frame.meta[0] < 1 && frame.meta[1] > 1e12);
  const negative = { time: bar.time, price: -1 };
  assert.equal(core.projectDrawings([{ kind: 'horizontal', a: negative, b: negative }], 900, 600)[0].valid, false);
  core.apply('replace', [{ ...bar, open: 0, low: 0, close: 0 }]);
  for (const mode of ['logarithmic', 'percentage', 'indexed']) {
    core.configurePriceScale(mode, false);
    assert.equal(core.frame(900, 600).priceAxis.effectiveMode, 0);
  }
  core.apply('replace', [{ ...bar, open: -100, high: -90, low: -110, close: -100 }]);
  core.configurePriceScale('percentage', false);
  frame = core.frame(900, 600);
  assert.equal(frame.priceAxis.base, -100);
  assert.equal(frame.priceAxis.effectiveMode, 2);
  assert.ok(core.priceToY(-90, 900, 600) < core.priceToY(-100, 900, 600));
  assert.ok([...frame.priceTicks].every(Number.isFinite));
});

test('real Wasm: inverted logarithmic manual scaling keeps its anchor and reset keeps the mode', async () => {
  const core = await create();
  core.configurePriceScale('logarithmic', true);
  const before = core.frame(900, 600);
  const y = before.meta[3] + 0.2 * (before.meta[4] - before.meta[3]);
  const price = core.priceAtY(y, 900, 600);
  core.scalePrice(2, 0.2);
  near(core.priceToY(price, 900, 600), y);
  const locked = core.frame(900, 600);
  core.pan(5); core.resizePlot(600);
  assert.deepEqual(core.frame(600, 600).meta.slice(0, 3), locked.meta.slice(0, 3));
  core.resetScale();
  assert.equal(core.scaleIsAuto, true);
  assert.deepEqual(core.frame(600, 600).priceAxis, { requestedMode: 1, effectiveMode: 1, inverted: true, base: bars[26].close });
});
