import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { parseLayout } from '../web/src/ui/layout-preferences.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const ids = frame => frame.panes.map(pane => pane.id);
const bars = Array.from({ length: 200 }, (_, i) => ({ time: (i + 1) * 60000,
  open: 100 + i, close: 102 + i, high: 105 + i, low: 98 + i, volume: 10 + i }));
async function fixture() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', bars); core.configureIndicators(20, 20, 4);
  core.configureOscillators(14, 12, 26, 9, 3); core.setView(80, 80); core.pan(-1);
  return core;
}

test('order preferences migrate and reject duplicate, missing and foreign IDs', () => {
  for (const version of [1, 2]) assert.deepEqual(parseLayout({ version }).paneOrder, [0, 1, 2, 3]);
  const input = { version: 3, paneOrder: [3, 0, 2, 1], paneWeights: [1, 2, 3, 4] };
  const saved = parseLayout(input); input.paneOrder[0] = 0;
  assert.deepEqual(saved.paneOrder, [3, 0, 2, 1]);
  for (const paneOrder of [[0, 1, 1, 3], [0, 1, 2], [0, 1, 2, 4], [0, 1, 2, '3']]) {
    assert.deepEqual(parseLayout({ version: 3, paneOrder }).paneOrder, [0, 1, 2, 3]);
  }
});

test('Wasm reorders real neighbors, skips absent panes, preserves view and resizes by identity', async () => {
  const core = await fixture(), before = core.frame(1000, 600), weights = core.getPaneWeights();
  core.movePane(0, 1);
  const moved = core.frame(1000, 600);
  assert.deepEqual(ids(moved), [1, 0, 2, 3]);
  assert.deepEqual(moved.meta.slice(8, 10), before.meta.slice(8, 10));
  assert.deepEqual(moved.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.equal(core.scaleIsAuto, false);
  assert.deepEqual(core.getPaneWeights(), weights);
  assert.ok(moved.meta[3] > moved.panes[1].top);
  const order = core.getPaneOrder();
  for (const invalid of [[0, 0, 2, 3], [0, 1, 2, NaN], [0, 1, 2, 4]]) assert.throws(() => core.setPaneOrder(invalid));
  assert.deepEqual(core.getPaneOrder(), order);
  core.resizePane(1, 20, 600);
  assert.ok(core.getPaneWeights()[1] > weights[1]);
  assert.equal(core.getPaneWeights()[2], weights[2]);
  assert.equal(core.getPaneWeights()[3], weights[3]);
  core.configureIndicators(20, 20, 0); core.configureOscillators(14, 12, 26, 9, 2);
  core.movePane(3, -1);
  assert.deepEqual(ids(core.frame(1000, 600)), [3, 0]);
  assert.deepEqual(order, [1, 0, 2, 3]);
  core.movePane(3, -1); assert.deepEqual(ids(core.frame(1000, 600)), [3, 0]);
  assert.throws(() => core.movePane(2, 1));
});

test('maximization hides price geometry, retains shared time and restores exact sizes and locks', async () => {
  const core = await fixture(); core.setPaneOrder([2, 0, 3, 1]);
  const before = core.frame(1000, 600), weights = core.getPaneWeights();
  core.maximizePane(2);
  const focused = core.frame(1000, 600);
  assert.deepEqual(ids(focused), [2]); assert.equal(focused.panes[0].bottom, 600);
  assert.deepEqual(focused.meta.slice(3, 5), new Float64Array(2));
  assert.equal(focused.priceTicks.length, 0); assert.ok(Number.isNaN(core.priceToY(200, 1000, 600)));
  assert.equal(core.drawingPoint(100, 100, 1000, 600), null);
  assert.deepEqual(focused.meta.slice(8, 10), before.meta.slice(8, 10));
  assert.throws(() => core.resizePane(2, 20, 600));
  core.maximizePane(-1);
  assert.deepEqual(core.frame(1000, 600).panes, before.panes);
  assert.deepEqual(core.getPaneWeights(), weights); assert.equal(core.scaleIsAuto, false);
  core.maximizePane(3); core.pan(-2);
  const during = core.frame(1000, 600);
  core.maximizePane(-1);
  assert.deepEqual(core.frame(1000, 600).meta.slice(8, 10), during.meta.slice(8, 10));
  core.maximizePane(2); core.configureOscillators(14, 12, 26, 9, 2);
  assert.equal(core.maximizedPane, -1); assert.deepEqual(ids(core.frame(1000, 600)), [0, 3, 1]);
  assert.throws(() => core.maximizePane(2)); assert.equal(core.maximizedPane, -1);
  core.maximizePane(1); core.configureIndicators(20, 20, 0); assert.equal(core.maximizedPane, -1);
});

test('adding an auxiliary study reveals panes even when another pane is maximized', async () => {
  for (const added of [1, 2, 3]) {
    for (const focused of [0, added === 2 ? 3 : 2]) {
      const core = await fixture();
      const configure = enabled => added === 1
        ? core.configureIndicators(20, 20, enabled ? 4 : 0)
        : core.configureOscillators(14, 12, 26, 9, enabled ? 3 : (added === 2 ? 2 : 1));
      configure(false);
      const order = focused === 0 ? [0, 1, 2, 3] : [3, 0, 2, 1];
      core.setPaneOrder(order); core.setPaneWeights([5, 2, 1, 3]);
      const weights = core.getPaneWeights(), before = core.frame(1000, 600);
      core.maximizePane(focused);
      assert.deepEqual(ids(core.frame(1000, 600)), [focused]);
      configure(true);
      const restored = core.frame(1000, 600);
      assert.equal(core.maximizedPane, -1);
      assert.deepEqual(ids(restored), order);
      assert.ok(restored.panes.every(pane => pane.bottom > pane.top));
      assert.deepEqual(restored.meta.slice(8, 10), before.meta.slice(8, 10));
      assert.deepEqual(core.getPaneWeights(), weights);
      assert.deepEqual(core.getPaneOrder(), order);
    }
  }
});

test('parameter, overlay and unchanged configurations preserve pane maximization', async () => {
  const core = await fixture(); core.maximizePane(2);
  core.configureIndicators(20, 20, 4);
  core.configureOscillators(14, 12, 26, 9, 3);
  assert.equal(core.maximizedPane, 2);
  core.configureIndicators(10, 30, 7);
  core.configureOscillators(21, 10, 30, 12, 3);
  assert.equal(core.maximizedPane, 2);
  assert.deepEqual(ids(core.frame(1000, 600)), [2]);
  // Removing another pane must not disturb the focused study either.
  core.configureIndicators(10, 30, 3);
  core.configureOscillators(21, 10, 30, 12, 1);
  assert.equal(core.maximizedPane, 2);
});
