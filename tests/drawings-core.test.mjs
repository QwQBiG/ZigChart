import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { sampleBar } from '../web/src/data/sample-feed.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = (start, count) => Array.from({ length: count }, (_, index) => sampleBar(start + index));
const anchor = bar => ({ time: bar.time, price: bar.close });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('drawing Wasm: rays share transformed anchors and clipped strokes with hit testing', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 300);
  core.apply('replace', data); core.setView(80, 100);
  const a = anchor(data[105]), b = { time: data[155].time, price: a.price };
  for (const mode of ['normal', 'logarithmic', 'percentage', 'indexed']) {
    for (const inverted of [false, true]) {
      core.configurePriceScale(mode, inverted);
      const frame = core.frame(1000, 600);
      for (const kind of ['ray', 'extended', 'horizontalRay', 'vertical']) {
        const shape = { kind, a, b }, [g] = core.projectDrawings([shape], 1000, 600);
        assert.ok(g.valid && g.stroke);
        close(g.y1, core.priceToY(a.price, 1000, 600));
        if (kind === 'vertical') {
          close(g.stroke.x1, g.x1); close(g.stroke.x2, g.x1);
          close(g.stroke.y1, frame.meta[3]); close(g.stroke.y2, frame.meta[4]);
        } else {
          close(g.stroke.x1, kind === 'extended' ? 0 : g.x1); close(g.stroke.x2, 1000);
          assert.deepEqual(core.hitDrawings([shape], 1000, 600, 900, g.y1), { index: 0, handle: 0 });
          assert.equal(core.hitDrawings([shape], 1000, 600, 100, g.y1)?.handle ?? null, kind === 'extended' ? 0 : null);
        }
        assert.deepEqual(core.hitDrawings([shape], 1000, 600, g.x1, g.y1), { index: 0, handle: 1 });
      }
    }
  }
});

test('drawing Wasm: an extension stays selectable after both anchors leave the view', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 300);
  core.apply('replace', data); core.setView(80, 100);
  const price = data[120].close;
  const shape = { kind: 'ray', a: { time: data[105].time, price }, b: { time: data[115].time, price } };
  core.pan(50);
  const [g] = core.projectDrawings([shape], 1000, 600);
  assert.ok(g.x1 < 0 && g.x2 < 0 && g.stroke);
  close(g.stroke.x1, 0); close(g.stroke.x2, 1000);
  assert.deepEqual(core.hitDrawings([shape], 1000, 600, 500, g.y1), { index: 0, handle: 0 });
  const saved = structuredClone(g);
  core.projectDrawings([{ ...shape, a: shape.b, b: shape.a }], 1000, 600);
  assert.deepEqual(g, saved);
});

test('drawing Wasm: anchors follow candle transforms across pan, prepend and zoom', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(100, 300);
  core.apply('replace', data);
  core.setView(80, 100);
  const shape = { kind: 'trend', a: anchor(data[120]), b: anchor(data[150]) };
  const frame = core.frame(1000, 600);
  const first = core.projectDrawings([shape], 1000, 600)[0];
  assert.ok(first.valid);
  close(first.x1, frame.rows[40 * 17 + 9]);
  close(first.y1, frame.rows[40 * 17 + 13]);
  assert.deepEqual(core.drawingPoint(first.x1, first.y1, 1000, 600), { ...shape.a, index: 120 });
  core.pan(10);
  const shifted = core.projectDrawings([shape], 1000, 600)[0];
  close(shifted.x1, first.x1 - 100);
  close(shifted.y1, first.y1);
  core.apply('prepend', bars(0, 100));
  assert.deepEqual(core.projectDrawings([shape], 1000, 600)[0], shifted);
  core.zoom(2, 0.5);
  const zoomed = core.projectDrawings([shape], 1000, 600)[0];
  assert.deepEqual(core.drawingPoint(zoomed.x1, zoomed.y1, 1000, 600), { ...shape.a, index: 220 });
});

test('drawing Wasm: inverse rejects future space and volume; anchors require actual timestamps', async () => {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(20, 20, 4);
  const data = bars(0, 300);
  core.apply('replace', data);
  const frame = core.frame(1000, 600);
  assert.equal(core.drawingPoint(950, 200, 1000, 600), null);
  assert.equal(core.drawingPoint(700, frame.meta[5], 1000, 600), null);
  assert.equal(core.drawingPoint(NaN, 200, 1000, 600), null);
  assert.equal(core.drawingPoint(700, 200, 0, 600), null);
  const a = anchor(data[280]);
  const valid = { kind: 'rectangle', a, b: anchor(data[290]) };
  for (const invalid of [{ ...a, time: a.time + 1 }, { ...a, price: a.price + 0.5 }, { ...a, price: NaN }, { ...a, price: 1e12 + 1 }]) {
    assert.deepEqual(core.projectDrawings([{ ...valid, a: invalid }], 1000, 600), [{ valid: false, x1: 0, y1: 0, x2: 0, y2: 0, stroke: null }]);
  }
  assert.equal(core.projectDrawings([valid], 0, 600)[0].valid, false);
  assert.throws(() => core.projectDrawings([{ ...valid, kind: 'constructor' }], 1000, 600), /Invalid drawing/);
  assert.throws(() => core.projectDrawings([{ ...valid, a: { ...a, time: String(a.time) } }], 1000, 600), /numbers/);
  assert.throws(() => core.projectDrawings(new Array(1), 1000, 600), /Invalid drawing/);
});

test('drawing Wasm: translation uses actual retained slots across gaps and atomic bounds', async () => {
  const core = await ChartCore.create(bytes);
  const data = [100, 200, 999, 10000].map(time => ({ time, open: 10, high: 20, low: -20, close: 10, volume: 1 }));
  core.apply('replace', data);
  assert.deepEqual(core.translateAnchor({ time: 200, price: -5 }, 1, -3), { time: 999, price: -8, index: 2 });
  for (const [a, slots, delta] of [[{ time: 100, price: 1 }, -1, 0], [{ time: 10000, price: 1 }, 1, 0],
    [{ time: 201, price: 1 }, 0, 0], [{ time: 200, price: 1e12 }, 0, 1], [{ time: 200, price: 1 }, 0.2, 0],
    [{ time: 200, price: 1 }, 0, NaN]]) assert.equal(core.translateAnchor(a, slots, delta), null);
  assert.equal(core.count, 4);
});

test('drawing Wasm: handles, segments, rectangle edges and topmost hit order', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 300);
  core.apply('replace', data);
  core.setView(80, 100);
  const a = anchor(data[105]);
  const b = anchor(data[155]);
  const shape = { kind: 'trend', a, b };
  const [g] = core.projectDrawings([shape], 1000, 600);
  assert.deepEqual(core.hitDrawings([shape], 1000, 600, g.x1, g.y1), { index: 0, handle: 1 });
  assert.deepEqual(core.hitDrawings([shape], 1000, 600, g.x2, g.y2), { index: 0, handle: 2 });
  const mx = (g.x1 + g.x2) / 2;
  const my = (g.y1 + g.y2) / 2;
  assert.deepEqual(core.hitDrawings([shape, shape], 1000, 600, mx, my), { index: 1, handle: 0 });
  const rectangle = { ...shape, kind: 'rectangle' };
  assert.deepEqual(core.hitDrawings([rectangle], 1000, 600, mx, g.y1), { index: 0, handle: 0 });
  if (Math.abs(g.y1 - g.y2) > 12) assert.equal(core.hitDrawings([rectangle], 1000, 600, mx, my), null);
  const horizontal = { ...shape, kind: 'horizontal' };
  assert.deepEqual(core.hitDrawings([horizontal], 1000, 600, 950, g.y1), { index: 0, handle: 0 });
  assert.equal(core.hitDrawings([horizontal], 1000, 600, 950, g.y1 + 7), null);
  assert.equal(core.hitDrawings([horizontal], 1000, 600, 950, g.y1, -1), null);
});

test('drawing Wasm: returned geometry and anchors own their data across subsequent calls', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 300);
  core.apply('replace', data);
  core.setView(80, 100);
  const shape = { kind: 'trend', a: anchor(data[105]), b: anchor(data[155]) };
  const projected = core.projectDrawings([shape], 1000, 600);
  const point = core.drawingPoint(projected[0].x1, projected[0].y1, 1000, 600);
  const hit = core.hitDrawings([shape], 1000, 600, projected[0].x1, projected[0].y1);
  const saved = structuredClone({ projected, point, hit });
  core.pan(10);
  core.projectDrawings([{ ...shape, kind: 'rectangle' }], 500, 300);
  core.translateAnchor(shape.b, 1, 5);
  core.hitDrawings([shape, shape], 1000, 600, 50, 50);
  core.frame(900, 500);
  core.inspect(0);
  assert.deepEqual({ projected, point, hit }, saved);
});

test('drawing Wasm: fixed batch capacity and ABI bounds do not grow memory', async () => {
  const core = await ChartCore.create(bytes);
  const data = bars(0, 300);
  core.apply('replace', data);
  const shape = { kind: 'horizontal', a: anchor(data[290]), b: anchor(data[290]) };
  const projected = core.projectDrawings(Array(256).fill(shape), 1000, 600);
  assert.equal(projected.length, 256);
  assert.ok(projected.every(item => item.valid));
  assert.throws(() => core.projectDrawings(Array(257).fill(shape), 1000, 600), /capacity/);
  assert.throws(() => core.hitDrawings(Array(257).fill(shape), 1000, 600, 100, 100), /capacity/);
  assert.deepEqual(core.projectDrawings([], 1000, 600), []);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const raw = instance.exports;
  const byteLength = raw.memory.buffer.byteLength;
  assert.equal(raw.abi_version(), 1);
  assert.equal(raw.drawing_capacity(), 256);
  assert.equal(raw.drawing_project(257, 1000, 600), -1);
  assert.equal(raw.drawing_hit(257, 1000, 600, 100, 100, 6), 0);
  assert.equal(raw.drawing_point(100, 100, 1000, 600), 0);
  assert.equal(raw.memory.buffer.byteLength, byteLength);
});
