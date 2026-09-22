import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { DRAWING_KINDS, isSingleAnchor } from '../web/src/chart/drawing-types.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = Array.from({ length: 300 }, (_, i) => ({ time: 1000 + i * 60000, open: 100, high: 120, low: 90, close: 110, volume: 10 }));
const text = (index = 120, price = 110) => ({ kind: 'text', a: { time: bars[index].time, price }, b: { time: 0, price: 0 } });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
async function setup() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars); core.setView(80, 100);
  return core;
}

test('text geometry: one anchor uses the shared price transform and reordered price pane', async () => {
  const core = await setup(), shape = text();
  assert.equal(DRAWING_KINDS.text, 8); assert.equal(isSingleAnchor('text'), true);
  core.configureIndicators(20, 20, 4); core.movePane(0, 1);
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) for (const inverted of [false, true]) {
    core.configurePriceScale(mode, inverted);
    const frame = core.frame(1000, 600), [projected] = core.projectDrawings([shape], 1000, 600);
    assert.ok(projected.valid); assert.equal(projected.stroke, null);
    close(projected.x1, projected.x2); close(projected.y1, projected.y2);
    close(projected.y1, core.priceToY(shape.a.price, 1000, 600));
    assert.ok(projected.y1 >= frame.meta[3] && projected.y1 <= frame.meta[4]);
    assert.deepEqual(core.hitDrawings([shape], 1000, 600, projected.x1 + 30, projected.y1 + 10, 0, [{ width: 80, height: 25 }]), { index: 0, handle: 0 });
    assert.equal(core.hitDrawings([shape], 1000, 600, projected.x1, frame.meta[3] - 1, 6, [{ width: 100, height: 65536 }]), null);
  }
  core.configurePriceScale('logarithmic', false);
  assert.equal(core.projectDrawings([text(120, 0)], 1000, 600)[0].valid, false);
  core.maximizePane(1);
  assert.equal(core.projectDrawings([shape], 1000, 600)[0].valid, false);
  assert.equal(core.hitDrawings([shape], 1000, 600, 300, 300, 6, [{ width: 65536, height: 65536 }]), null);
});

test('text hit: box bodies, tolerance and topmost order agree, missing bounds never reuse old boxes', async () => {
  const core = await setup(), shape = text();
  const [g] = core.projectDrawings([shape], 1000, 600), size = { width: 100, height: 40 };
  const hit = (x, y, bounds = [size], shapes = [shape], tolerance = 6) => core.hitDrawings(shapes, 1000, 600, x, y, tolerance, bounds);
  assert.deepEqual(hit(g.x1, g.y1), { index: 0, handle: 1 });
  assert.deepEqual(hit(g.x1 + 50, g.y1 + 20), { index: 0, handle: 0 });
  assert.deepEqual(hit(g.x1 + 105, g.y1 + 20), { index: 0, handle: 0 });
  assert.equal(hit(g.x1 + 107, g.y1 + 20), null);
  assert.deepEqual(hit(g.x1 + 50, g.y1 + 20, [size, size], [shape, shape]), { index: 1, handle: 0 });
  assert.deepEqual(hit(g.x1 + 50, g.y1 + 20, [size], [shape, shape]), { index: 0, handle: 0 });
  assert.equal(core.hitDrawings([shape], 1000, 600, g.x1 + 50, g.y1 + 20), null);
  for (const invalid of [null, undefined, { width: 0, height: 40 }, { width: 100, height: -1 },
    { width: NaN, height: 40 }, { width: 100, height: Infinity }, { width: 65537, height: 40 }]) {
    assert.equal(hit(g.x1 + 50, g.y1 + 20, [invalid]), null);
    assert.deepEqual(hit(g.x1, g.y1, [invalid]), { index: 0, handle: 1 });
  }
  assert.deepEqual(hit(990, g.y1 + 30, [{ width: 65536, height: 65536 }]), { index: 0, handle: 0 });
  assert.equal(hit(1000, g.y1 + 30, [{ width: 65536, height: 65536 }]), null);
  const line = { ...shape, kind: 'horizontal' };
  assert.deepEqual(hit(g.x1 + 50, g.y1, [size, null], [shape, line]), { index: 1, handle: 0 });
});

test('text geometry: copied results survive hit calls and a partially offscreen box stays selectable', async () => {
  const core = await setup(), shape = text(78);
  const [g] = core.projectDrawings([shape], 1000, 600);
  assert.ok(g.x1 < 0);
  const saved = structuredClone(g);
  const hit = core.hitDrawings([shape], 1000, 600, 25, g.y1 + 20, 6, [{ width: 100, height: 40 }]);
  assert.deepEqual(hit, { index: 0, handle: 0 });
  core.projectDrawings([text(150, 100)], 800, 400);
  core.hitDrawings([text(150), text(150)], 1000, 600, 705, g.y1, 6, [{ width: 100, height: 40 }, { width: 100, height: 40 }]);
  core.frame(800, 400);
  assert.deepEqual(g, saved); assert.deepEqual(hit, { index: 0, handle: 0 });
  const batch = Array(256).fill(shape), bounds = Array(256).fill(null);
  bounds[255] = { width: 100, height: 40 };
  assert.equal(core.projectDrawings(batch, 1000, 600).length, 256);
  assert.deepEqual(core.hitDrawings(batch, 1000, 600, 25, g.y1 + 20, 6, bounds), { index: 255, handle: 0 });
  assert.equal(core.hitDrawings(batch, 1000, 600, 25, g.y1 + 20), null);
  assert.throws(() => core.hitDrawings(Array(257).fill(shape), 1000, 600, 20, 20), /capacity/);
});

test('text shift: blank-space starts use rounded slots and the shared inverse price transform', async () => {
  const core = await setup();
  core.setView(259.5, 50);
  const a = text(298).a;
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) for (const inverted of [false, true]) {
    core.configurePriceScale(mode, inverted);
    const [g] = core.projectDrawings([text(298)], 1000, 600), frame = core.frame(1000, 600);
    const from = { x: 900, y: g.y1 + 10 }, to = { x: 860, y: g.y1 + 30 };
    assert.equal(core.drawingPoint(from.x, from.y, 1000, 600), null);
    const result = core.shiftDrawingAnchor(a, from, to, 1000, 600);
    assert.deepEqual(result, { time: bars[296].time, price: Math.round(core.priceAtY(g.y1 + 20, 1000, 600)), index: 296 });
    assert.equal(core.shiftDrawingAnchor(a, from, { ...from, x: 960 }, 1000, 600), null);
    for (const bad of [{ x: NaN, y: 100 }, { x: -1, y: 100 }, { x: 1000, y: 100 }, { x: 200, y: frame.meta[4] + 1 }]) {
      assert.equal(core.shiftDrawingAnchor(a, bad, to, 1000, 600), null);
      assert.equal(core.shiftDrawingAnchor(a, from, bad, 1000, 600), null);
    }
    const current = core.frame(1000, 600);
    assert.deepEqual(current.meta, frame.meta);
    assert.deepEqual(current.priceAxis, frame.priceAxis);
  }
  core.configurePriceScale('normal', false);
  const from = { x: 900, y: 300 }, to = { x: 870, y: 300 };
  const before = core.shiftDrawingAnchor(a, from, to, 1000, 600);
  assert.equal(before.index, 296); // Negative half-slot ties round away from zero.
  core.apply('prepend', [{ ...bars[0], time: 0 }]);
  assert.deepEqual(core.shiftDrawingAnchor(a, from, to, 1000, 600), { ...before, index: 297 });
  assert.deepEqual(before, { time: bars[296].time, price: a.price, index: 296 });
  assert.equal(core.shiftDrawingAnchor({ ...a, time: a.time + 1 }, from, to, 1000, 600), null);
  core.configurePriceScale('logarithmic', false);
  assert.equal(core.shiftDrawingAnchor({ ...a, price: 0 }, from, to, 1000, 600), null);
});
