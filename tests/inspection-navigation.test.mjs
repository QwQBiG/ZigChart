import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { InspectionController } from '../web/src/features/inspection/controller.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bars = (count, start = 0) => Array.from({ length: count }, (_, offset) => {
  const i = start + offset, open = 10_000 + i * i * 3;
  return { time: Date.UTC(2026, 0, 1) + (i + Math.floor(i / 10) * 2) * 60_000,
    open, high: open + 12, low: open - 6, close: open + 4, volume: 1000 + i };
});
async function loaded(data = bars(80)) {
  const core = await ChartCore.create(bytes); core.apply('replace', data); return core;
}
function controllerFor(core) {
  let frame = core.frame(900, 600);
  const calls = { start: 0, cancel: 0, history: 0, paint: [] };
  const controller = new InspectionController({
    getCore: () => core, getFrame: () => frame,
    onStart: () => calls.start++, cancelNavigation: () => calls.cancel++, loadHistory: () => calls.history++,
    paint: level => { calls.paint.push(level); if (level === 'full') frame = core.frame(900, 600); },
  });
  return { controller, calls, selection: () => controller.resolve(frame),
    refresh: () => { controller.ensureVisible(); frame = core.frame(900, 600); return controller.resolve(frame); } };
}

test('bridge time lookup follows exact UTC anchors across gaps, prepends and corrections', async () => {
  const data = bars(30, 10), core = await loaded(data), anchor = data[4].time;
  assert.equal(core.indexAtTime(anchor), 4);
  assert.equal(core.indexAtTime(bars(1, 19)[0].time + 60_000), -1);
  const snapshot = core.inspect(4);
  core.apply('prepend', bars(10));
  assert.equal(core.indexAtTime(anchor), 14);
  const corrected = { ...data[4], close: data[4].high };
  core.apply('correct', [corrected]);
  assert.equal(core.indexAtTime(anchor), 14);
  assert.equal(core.inspect(14).close, corrected.close);
  assert.equal(snapshot.close, data[4].close);
  for (const time of [anchor + 0.5, -1, NaN, Infinity, 8.64e15 + 1, String(anchor), null]) {
    assert.equal(core.indexAtTime(time), -1);
  }
});

test('bridge reveal minimally pans the shared viewport and keeps existing scale and pane state', async () => {
  const core = await loaded();
  core.configureIndicators(3, 5, 7); core.configureOscillators(3, 2, 4, 2, 3);
  core.setPaneOrder([1, 0, 3, 2]); core.setPaneWeights([4, 3, 2, 1]); core.maximizePane(3);
  core.setView(30, 20);
  const before = core.frame(900, 600);
  assert.equal(core.revealBar(40), 0); assert.equal(core.scaleIsAuto, true);
  assert.deepEqual(core.frame(900, 600), before);
  assert.equal(core.revealBar(10), 1); assert.equal(core.scaleIsAuto, false);
  const left = core.frame(900, 600);
  assert.equal(left.meta[8], 8.5); assert.equal(left.meta[9], 20);
  assert.deepEqual(left.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.deepEqual(left.panes, before.panes); assert.equal(core.maximizedPane, 3);
  assert.equal(core.revealBar(60), 1);
  const right = core.frame(900, 600);
  assert.equal(right.meta[8], 42.5); assert.equal(right.meta[9], 20);
  assert.deepEqual(right.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.equal(core.revealBar(60), 0);
  for (const index of [-1, 80, 0.5, NaN, Infinity, '10', null]) assert.equal(core.revealBar(index), -1);
  assert.deepEqual(core.frame(900, 600), right);
  core.setView(0, 10);
  assert.equal(core.revealBar(0), 0); assert.equal(core.scaleIsAuto, true);
});

test('inspection keys navigate actual loaded bars and request history only toward older data', async () => {
  const core = await loaded(); core.setView(20, 30);
  const { controller, selection, calls } = controllerFor(core);
  assert.equal(controller.key('ArrowRight'), false);
  assert.equal(controller.start(core.inspect(30).time), true); assert.equal(calls.start, 1);
  for (const [key, index] of [['ArrowLeft', 29], ['ArrowRight', 30], ['PageUp', 20], ['PageDown', 30], ['Home', 0], ['End', 79]]) {
    assert.equal(controller.key(key), true); assert.equal(selection().bar.index, index);
    assert.equal(selection().bar.time, core.inspect(index).time);
  }
  assert.equal(calls.cancel, 6); assert.equal(calls.history, 3);
  assert.equal(core.frame(900, 600).meta[9], 30);
  assert.equal(controller.key('ArrowRight'), true); assert.equal(selection().bar.index, 79);
  const count = calls.paint.length;
  assert.equal(controller.key('F2'), false); assert.equal(calls.paint.length, count);
  assert.equal(controller.key('Escape'), true); assert.equal(controller.active, false);
  assert.equal(selection(), null); assert.equal(controller.key('Home'), false);
});

test('inspection preserves UTC selection after prepend and corrections, then retires missing anchors', async () => {
  const data = bars(40, 10), core = await loaded(data), fixture = controllerFor(core);
  const anchor = data[8].time;
  fixture.controller.start(anchor);
  core.apply('prepend', bars(10));
  let selected = fixture.refresh();
  assert.equal(selected.bar.time, anchor); assert.equal(selected.bar.index, 18);
  const correction = { ...data[8], close: data[8].low };
  core.apply('correct', [correction]); selected = fixture.refresh();
  assert.equal(selected.bar.time, anchor); assert.equal(selected.value, correction.close);
  core.apply('replace', bars(10, 100));
  assert.equal(fixture.refresh(), null); assert.equal(fixture.controller.active, false);
});

test('copied inspection frames keep values indices and geometry consistent through correction and prepend', async () => {
  const data = bars(40, 10), core = await loaded(data);
  core.configureIndicators(3, 5, 3);
  core.setView(4, 20);
  const { controller, selection, refresh } = controllerFor(core), anchor = data[8].time;
  controller.start(anchor);
  const original = selection(), oldFrame = original.frame;
  const corrected = { ...data[8], open: data[8].low, high: data[8].high + 3,
    low: data[8].low - 4, close: data[8].high, volume: data[8].volume + 600 };
  core.apply('correct', [corrected]);
  assert.notEqual(core.inspect(8).close, original.value);
  assert.deepEqual(controller.resolve(oldFrame), original);
  const revised = refresh();
  assert.equal(revised.bar.time, anchor); assert.equal(revised.value, corrected.close);
  assert.deepEqual(revised.bar, core.inspect(8));
  assert.notEqual(revised.bar.ma, original.bar.ma); assert.notEqual(revised.bar.ema, original.bar.ema);
  core.apply('prepend', bars(10));
  assert.equal(core.indexAtTime(anchor), 18);
  assert.deepEqual(controller.resolve(oldFrame), original);
  assert.deepEqual(controller.resolve(revised.frame), revised);
  const current = refresh();
  assert.equal(current.bar.time, anchor); assert.equal(current.bar.index, 18);
  assert.equal(current.value, corrected.close); assert.deepEqual(current.bar, core.inspect(18));
  assert.equal(current.x, revised.x);
});

test('pane navigation follows visible pane order and retains explicit oscillator warmup', async () => {
  const core = await loaded();
  core.configureIndicators(20, 20, 4); core.configureOscillators(14, 12, 26, 9, 3);
  core.setView(0, 20);
  const { controller, selection, refresh } = controllerFor(core);
  controller.start(core.inspect(2).time);
  assert.equal(selection().paneId, 0); assert.equal(selection().pointVisible, true);
  controller.key('ArrowDown');
  assert.equal(selection().paneId, 1); assert.equal(selection().value, 1002);
  assert.equal(selection().pointVisible, true);
  for (const pane of [2, 3]) {
    controller.key('ArrowDown');
    assert.equal(selection().paneId, pane); assert.equal(selection().value, null);
    assert.equal(selection().pointVisible, false);
    assert.ok(Number.isFinite(selection().y)); assert.equal(selection().bar.index, 2);
  }
  core.setPaneOrder([3, 1, 0, 2]); refresh();
  controller.key('ArrowDown'); assert.equal(selection().paneId, 1);
  controller.key('ArrowUp'); assert.equal(selection().paneId, 3);
  core.maximizePane(2); refresh();
  assert.equal(selection().paneId, 2);
  controller.key('ArrowUp'); controller.key('ArrowDown'); assert.equal(selection().paneId, 2);
  core.configureOscillators(14, 12, 26, 9, 2); refresh();
  assert.equal(selection().paneId, 3); assert.equal(controller.active, true);
  controller.key('End');
  assert.equal(selection().bar.index, 79); assert.ok(Number.isFinite(selection().value));
});

test('clipped inspection markers retain real values and become visible after explicit price refitting', async () => {
  const core = await loaded(); core.setView(0, 10); core.pan(1);
  const locked = core.frame(900, 600).meta.slice(0, 3);
  const { controller, selection, refresh } = controllerFor(core);
  controller.start(core.inspect(60).time);
  const clipped = selection(), pane = clipped.frame.panes.find(item => item.id === 0);
  assert.equal(clipped.pointVisible, false);
  assert.equal(clipped.value, core.inspect(60).close);
  assert.equal(clipped.y, pane.contentTop);
  assert.deepEqual(clipped.frame.meta.slice(0, 3), locked);
  core.resetScale();
  const fitted = refresh();
  assert.equal(fitted.pointVisible, true); assert.equal(fitted.value, clipped.value);
  assert.equal(fitted.bar.time, clipped.bar.time);
});
