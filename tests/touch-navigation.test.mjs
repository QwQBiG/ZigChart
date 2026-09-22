import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { createTouchNavigation } from '../web/src/chart/touch-navigation.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = Array.from({ length: 500 }, (_, i) => ({ time: 1_700_000_000_000 + i * 60000,
  open: 1000 + i, high: 1020 + i, low: 980 + i, close: 1010 + i, volume: 100 + i }));
const p = (x, y = 100) => ({ x, y });
async function setup() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars); core.resizePlot(1000); core.setView(100, 100);
  core.configureIndicators(20, 20, 4); core.configureOscillators(14, 12, 26, 9, 3);
  const captures = new Set(), state = { width: 1000, height: 600, begins: 0, paints: 0 };
  const canvas = { hasPointerCapture: id => captures.has(id), setPointerCapture: id => captures.add(id),
    releasePointerCapture: id => captures.delete(id) };
  const controls = createTouchNavigation({ canvas, getCore: () => core,
    getSize: () => ({ width: state.width, height: state.height }),
    onBegin: () => state.begins++, requestPaint: () => state.paints++ });
  const frame = () => core.frame(1000, 600);
  return { core, controls, captures, state, frame };
}

test('touch pinch batches both contacts and moves their anchor on the actual shared Wasm viewport', async () => {
  const { core, controls: c, captures, state, frame } = await setup();
  assert.equal(c.down(1, p(100)), false); assert.equal(c.down(2, p(300)), true);
  assert.equal(state.begins, 1); assert.deepEqual([...captures], [1, 2]);
  c.move(1, p(50)); c.move(2, p(450));
  assert.equal(frame().meta[9], 100); // Pointer events alone do not mutate the core.
  assert.equal(c.flush(), true); assert.equal(c.flush(), false);
  const after = frame();
  assert.equal(after.meta[9], 50); assert.equal(after.meta[8], 107.5);
  assert.equal(after.meta[8] + .25 * after.meta[9], 120);
  assert.equal(after.panes.length, 4);
  c.move(1, p(70)); c.move(2, p(470)); c.flush();
  assert.equal(frame().meta[8], 106.5); assert.equal(core.scaleIsAuto, false);
  c.end(1, false); assert.equal(c.active, true);
  assert.equal(c.move(2, p(800)), true); assert.equal(c.flush(), false);
  assert.equal(frame().meta[8], 106.5);
  c.end(2, false); assert.equal(c.active, false); assert.equal(captures.size, 0);
});

test('touch excludes axes, ignores small movement, and safely handles close contacts and cancellation', async () => {
  const { controls: c, captures, frame } = await setup();
  for (const point of [p(-1), p(1000), p(100, 600), p(NaN)]) assert.equal(c.down(1, point), false);
  c.down(1, p(100)); c.down(2, p(300));
  c.move(1, p(99)); c.move(2, p(301)); assert.equal(c.flush(), false);
  assert.equal(frame().meta[9], 100);
  c.move(1, p(200)); c.move(2, p(201)); assert.equal(c.flush(), false);
  c.move(2, p(300)); assert.equal(c.flush(), false); // Rebase from degenerate separation.
  c.move(2, p(400)); c.cancel();
  assert.equal(c.flush(), false); assert.equal(c.active, false); assert.equal(captures.size, 0);
  assert.equal(frame().meta[9], 100);
  assert.equal(c.end(1, true), false);
});

test('third contacts drain without jumps, release flushes pending moves, and resize discards stale input', async () => {
  const { controls: c, state, captures, frame } = await setup();
  c.down(1, p(100)); c.down(2, p(300)); c.move(2, p(500));
  c.end(2, false); assert.equal(frame().meta[9], 50);
  c.end(1, false);
  c.down(1, p(100)); c.down(2, p(300)); c.down(3, p(500));
  c.move(1, p(50)); assert.equal(c.flush(), false);
  c.end(1, false); c.end(2, true); assert.equal(c.active, true);
  c.end(3, false); assert.equal(c.active, false);
  c.down(1, p(100)); c.down(2, p(300)); c.move(2, p(500));
  state.width = 900;
  assert.equal(c.flush(), false); assert.equal(frame().meta[9], 50);
  assert.equal(c.active, false); assert.equal(captures.size, 0);
});
