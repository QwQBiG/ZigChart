import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { createFibonacciStyle } from '../web/src/features/drawings/fibonacci-model.ts';
import { DrawingDocument } from '../web/src/features/drawings/document.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const data = Array.from({ length: 300 }, (_, i) => ({ time: 1_700_000_000_000 + i * 60_000,
  open: 20000, high: 41000, low: 9000, close: 21000, volume: 100 }));
const shape = () => ({ id: 'fib-1', kind: 'fibonacci', a: { time: data[105].time, price: 10000 },
  b: { time: data[155].time, price: 40000 }, color: '#4f8cff', width: 2, locked: false, fibonacci: createFibonacciStyle() });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
async function fixture() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', data); core.setView(80, 100);
  return core;
}

test('Fibonacci Wasm preserves raw ratios across transforms and copies projected buffers', async () => {
  const core = await fixture(), drawing = shape();
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) {
    for (const inverted of [false, true]) {
      core.configurePriceScale(mode, inverted);
      for (const logarithmic of [false, true]) {
        drawing.fibonacci.logarithmic = logarithmic;
        const [g] = core.projectDrawings([drawing], 1000, 600), midpoint = g.levels.find(l => l.ratio === .5);
        assert.ok(g.valid); assert.equal(g.levels.length, 7);
        near(midpoint.price, logarithmic && mode === 'logarithmic' ? 20000 : 25000);
        near(midpoint.y, core.priceToY(midpoint.price, 1000, 600));
        const saved = structuredClone(g);
        core.projectDrawings([{ ...drawing, a: drawing.b, b: drawing.a }], 1000, 600);
        assert.deepEqual(g, saved);
      }
    }
  }
  drawing.fibonacci.reverse = true;
  drawing.fibonacci.logarithmic = false;
  const [reversed] = core.projectDrawings([drawing], 1000, 600);
  assert.equal(reversed.levels[0].price, 10000);
  assert.equal(reversed.levels.at(-1).price, 40000);
});

test('Fibonacci Wasm uses visible levels and topmost order for hits, and hides with price pane', async () => {
  const core = await fixture(), drawing = shape();
  Object.assign(drawing.fibonacci, { extendRight: true, trend: false });
  const [g] = core.projectDrawings([drawing], 1000, 600), level = g.levels[3];
  assert.equal(level.x2, 1000);
  assert.deepEqual(core.hitDrawings([drawing, drawing], 1000, 600, 900, level.y, 2), { index: 1, handle: 0 });
  drawing.fibonacci.levels[3].enabled = false;
  assert.equal(core.projectDrawings([drawing], 1000, 600)[0].levels.length, 6);
  assert.equal(core.hitDrawings([drawing], 1000, 600, 900, level.y, 2), null);
  drawing.fibonacci.levels[3].ratio = Infinity;
  assert.throws(() => core.projectDrawings([drawing], 1000, 600), /Fibonacci|fibonacci/);
  drawing.fibonacci.levels[3].ratio = .5;
  core.configureIndicators(20, 20, 4); core.maximizePane(1);
  assert.equal(core.projectDrawings([drawing], 1000, 600)[0].valid, false);
});

test('Fibonacci objects isolate styles, persist, undo, reject invalid edits and protect locked anchors', () => {
  const document = new DrawingDocument('ZIG/USD', 100), drawing = shape();
  assert.ok(document.add(drawing));
  const modified = structuredClone(document.selection);
  modified.fibonacci.levels[1].ratio = .25; modified.fibonacci.levels[1].color = '#123456';
  modified.fibonacci.extendRight = true; modified.locked = true;
  assert.ok(document.update(modified));
  assert.equal(drawing.fibonacci.levels[1].ratio, .236);
  assert.equal(document.update({ ...modified, b: modified.a }), false);
  assert.equal(document.removeSelected(), false);
  document.undo(); assert.equal(document.selection.fibonacci.levels[1].ratio, .236);
  document.redo(); assert.deepEqual(document.selection, modified);
  const restored = new DrawingDocument('ZIG/USD', 100);
  assert.ok(restored.restore(document.serialize(), ['1m', '5m']));
  assert.deepEqual(restored.items, [modified]); assert.equal(restored.canUndo, false);
  restored.switchPeriod('5m'); assert.deepEqual(restored.items, []);
  restored.switchPeriod('1m'); assert.deepEqual(restored.items, [modified]);
  for (const value of [NaN, Infinity, -10.01, 10.01]) {
    const invalid = structuredClone(modified); invalid.fibonacci.levels[0].ratio = value;
    assert.equal(document.update(invalid), false);
  }
  const oversized = structuredClone(modified);
  oversized.fibonacci.levels = Array.from({ length: 25 }, () => ({ ratio: 1, color: '#999999', enabled: true }));
  assert.equal(document.update(oversized), false);
});
