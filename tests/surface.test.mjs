import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasSurface } from '../web/src/chart/surface.ts';

function fixture() {
  let width = 800, height = 500, ratio = 1, reads = 0;
  const writes = [], transforms = [];
  let backingWidth = 300, backingHeight = 150;
  const canvas = {
    style: { width: '', height: '' },
    get width() { return backingWidth; }, set width(value) { writes.push(['width', value]); backingWidth = value; },
    get height() { return backingHeight; }, set height(value) { writes.push(['height', value]); backingHeight = value; },
  };
  const surface = createCanvasSurface(canvas, { setTransform: (...args) => transforms.push(args) },
    { getBoundingClientRect() { reads++; return { width, height }; } }, () => ratio);
  return { surface, canvas, writes, transforms, get reads() { return reads; },
    resize(w, h) { width = w; height = h; surface.invalidate(); },
    observe(w, h) { width = w; height = h; return surface.observeSize(w, h); },
    scale(value) { ratio = value; } };
}

test('continuous narrowing and widening reuse storage while updating the logical viewport', () => {
  const f = fixture();
  f.surface.commit(); f.writes.length = 0;
  f.resize(700, 500); f.resize(620, 500); f.resize(600, 500);
  assert.equal(f.canvas.width, 896);
  assert.deepEqual(f.writes, []);
  assert.deepEqual(f.surface.commit(), { width: 600, height: 500, dpr: 1, resized: true });
  assert.deepEqual(f.writes, []);
  assert.equal(f.reads, 2);
  for (const width of [620, 650, 750, 850, 600]) {
    f.resize(width, 500);
    assert.equal(f.surface.commit().width, width);
  }
  assert.deepEqual(f.writes, []);
  assert.equal(f.canvas.style.width, '896px');
});

test('capacity growth commits in the drawing callback and keeps physical pixels unscaled', () => {
  const f = fixture();
  f.surface.commit(); f.writes.length = 0;
  f.resize(910, 500);
  assert.deepEqual(f.writes, []);
  assert.equal(f.surface.commit().width, 910);
  assert.deepEqual(f.writes, [['width', 1024]]);
  assert.equal(f.canvas.style.width, '1024px');
  f.writes.length = 0;
  f.scale(1.68);
  assert.equal(f.surface.commit().dpr, 1.68);
  assert.deepEqual(f.writes, [['width', 1721], ['height', 861]]);
  assert.equal(parseFloat(f.canvas.style.width), f.canvas.width / 1.68);
  assert.equal(parseFloat(f.canvas.style.height), f.canvas.height / 1.68);
  assert.deepEqual(f.transforms.at(-1), [1.68, 0, 0, 1.68, 0, 0]);
});

test('observer echoes do not schedule work but changed sizes and DPR still commit', () => {
  const f = fixture();
  f.surface.commit(); f.writes.length = 0;
  f.resize(800, 500);
  assert.equal(f.surface.commit().resized, false);
  assert.deepEqual(f.writes, []);
  const reads = f.reads;
  assert.equal(f.observe(800, 500), false);
  assert.equal(f.surface.observeSize(800.004, 499.997), false);
  assert.equal(f.surface.commit().resized, false);
  assert.equal(f.reads, reads);
  assert.equal(f.observe(780, 500), true);
  assert.equal(f.surface.commit().width, 780);
  assert.equal(f.observe(780, 500), false);
  f.scale(2);
  assert.equal(f.observe(780, 500), true);
  assert.equal(f.surface.commit().dpr, 2);
  assert.deepEqual(f.writes, [['width', 1792], ['height', 1024]]);
  assert.deepEqual(f.transforms.at(-1), [2, 0, 0, 2, 0, 0]);
  assert.equal(f.observe(780, 500), false);
  assert.equal(f.surface.observeSize(NaN, 500), false);
});
