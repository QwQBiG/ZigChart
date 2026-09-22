import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = Array.from({ length: 500 }, (_, i) => ({
  time: (i + 1) * 60000, open: i - 250, high: i - 230, low: i - 260, close: i - 240, volume: i + 1,
}));

test('manual price scaling preserves time, volume and drawing anchors; reset refits in place', async () => {
  const core = await ChartCore.create(bytes);
  core.configureIndicators(20, 20, 7);
  core.apply('replace', bars); core.resizePlot(900); core.setView(200, 100);
  const before = core.frame(900, 600);
  const object = [{ kind: 'horizontal', a: { time: bars[230].time, price: bars[230].close }, b: { time: bars[230].time, price: bars[230].close } }];
  const projectedBefore = core.projectDrawings(object, 900, 600)[0];
  assert.equal(core.scaleIsAuto, true);
  core.scalePrice(2, 0.5);
  const manual = core.frame(900, 600);
  assert.equal(core.scaleIsAuto, false);
  assert.equal(manual.meta[1] - manual.meta[0], (before.meta[1] - before.meta[0]) / 2);
  assert.deepEqual(manual.meta.slice(2), before.meta.slice(2));
  const projectedAfter = core.projectDrawings(object, 900, 600)[0];
  assert.equal(projectedAfter.x1, projectedBefore.x1);
  const midpointY = (before.meta[3] + before.meta[4]) / 2;
  assert.ok(Math.abs(projectedAfter.y1 - (midpointY + (projectedBefore.y1 - midpointY) * 2)) < 1e-8);
  core.pan(5); core.resizePlot(600);
  assert.deepEqual(core.frame(600, 600).meta.slice(0, 3), manual.meta.slice(0, 3));
  const horizontal = core.frame(600, 600).meta.slice(8, 10);
  core.resetScale();
  assert.equal(core.scaleIsAuto, true);
  assert.deepEqual(core.frame(600, 600).meta.slice(8, 10), horizontal);
});

test('invalid price scaling stays automatic and normal zoom/follow restore automatic fitting', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars);
  for (const factor of [0, -1, NaN, Infinity, 1]) core.scalePrice(factor, 0.5);
  core.scalePrice(2, NaN);
  assert.equal(core.scaleIsAuto, true);
  core.scalePrice(2, 0.5); core.zoom(2, 0.5);
  assert.equal(core.scaleIsAuto, true);
  core.scalePrice(2, 0.5); core.follow();
  assert.equal(core.scaleIsAuto, true);
});
