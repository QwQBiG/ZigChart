import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeScaleControls } from '../web/src/chart/time-scale-controls.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

class Canvas extends EventTarget {
  title = 'Chart hint';
  attributes = new Map();
  captures = new Set();
  classes = new Set();
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { left: 10, top: 20 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}
function emit(canvas, type, x = 200, y = 285, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: x + 10, clientY: y + 20, pointerId: 7, button: 0, isPrimary: true,
    deltaY: 0, deltaMode: 0 }, values);
  canvas.dispatchEvent(event);
  return event;
}
function setup(onFollow) {
  setLocale('en');
  const canvas = new Canvas(), calls = [];
  const core = { count: 500,
    zoom(factor, anchor) { calls.push(['zoom', factor, anchor]); },
    follow() { calls.push(['follow']); },
  };
  const meta = new Float64Array(13);
  meta[11] = 400; meta[12] = 270;
  const state = { allowed: true, frame: { meta, rows: [] } };
  let controls;
  controls = createTimeScaleControls({ canvas, getCore: () => core, getFrame: () => state.frame,
    getSize: () => ({ width: 500, height: 300 }), canStart: () => state.allowed,
    onBegin() { calls.push(['begin']); controls?.cancel(); }, onChange() { calls.push(['change']); },
    onFollow,
  });
  return { canvas, core, calls, controls, state, meta };
}

test('time axis excludes the plot, price axis and outside edges, including wheel events', () => {
  const { canvas, core, calls, controls, state } = setup();
  let downstream = 0;
  canvas.addEventListener('pointerdown', () => downstream++);
  for (const [x, y] of [[200, 269], [400, 285], [450, 285], [-1, 285], [200, 300]]) {
    assert.equal(emit(canvas, 'pointerdown', x, y).defaultPrevented, false);
    assert.equal(emit(canvas, 'wheel', x, y, { deltaY: -10 }).defaultPrevented, false);
  }
  assert.equal(downstream, 5);
  state.allowed = false;
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, false);
  assert.equal(emit(canvas, 'wheel', 200, 285, { deltaY: -10 }).defaultPrevented, false);
  state.allowed = true;
  core.count = 0;
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, false);
  core.count = 500;
  state.frame = null;
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, false);
  assert.deepEqual(calls, []);
  controls.dispose();
});

test('horizontal drag starts at four pixels, magnifies rightward and anchors the right edge', () => {
  const { canvas, calls, controls } = setup();
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, true);
  assert.equal(canvas.hasPointerCapture(7), true);
  emit(canvas, 'pointermove', 203, 10);
  emit(canvas, 'pointermove', 220, 285, { pointerId: 8 });
  assert.deepEqual(calls, [['begin']]);
  emit(canvas, 'pointermove', 204, 285);
  assert.deepEqual(calls.at(-2), ['zoom', Math.exp(.04), 1]);
  emit(canvas, 'pointermove', 194, 20);
  assert.deepEqual(calls.at(-2), ['zoom', Math.exp(-.1), 1]);
  emit(canvas, 'pointermove', 2000, 20);
  assert.deepEqual(calls.at(-2), ['zoom', Math.E, 1]);
  emit(canvas, 'pointerup', 2000, 20);
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.equal(canvas.classes.has('time-axis-hover'), false);
  const count = calls.length;
  emit(canvas, 'pointermove', 220, 285);
  assert.equal(calls.length, count);
  controls.dispose();
});

test('click-only gestures and secondary pointers do not zoom or steal an existing capture', () => {
  const { canvas, calls, controls } = setup();
  assert.equal(emit(canvas, 'pointerdown', 200, 285, { button: 2 }).defaultPrevented, false);
  assert.equal(emit(canvas, 'pointerdown', 200, 285, { isPrimary: false }).defaultPrevented, false);
  canvas.setPointerCapture(7);
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, false);
  canvas.releasePointerCapture(7);
  emit(canvas, 'pointerdown');
  emit(canvas, 'pointermove', 202, 100);
  emit(canvas, 'pointerup', 202, 285);
  assert.deepEqual(calls, [['begin']]);
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.equal(canvas.classes.has('time-axis-hover'), true);
  controls.dispose();
});

test('wheel uses CSS cursor position and normalizes pixel, line and page deltas', () => {
  const { canvas, calls, controls } = setup();
  for (const [deltaY, deltaMode] of [[-16, 0], [-1, 1], [-16 / 300, 2]]) {
    assert.equal(emit(canvas, 'wheel', 100, 285, { deltaY, deltaMode }).defaultPrevented, true);
    assert.deepEqual(calls.at(-2), ['zoom', Math.exp(.024), .25]);
  }
  emit(canvas, 'wheel', 300, 285, { deltaY: 10 });
  assert.deepEqual(calls.at(-2), ['zoom', Math.exp(-.015), .75]);
  emit(canvas, 'wheel', 0, 270, { deltaY: -100000 });
  assert.deepEqual(calls.at(-2), ['zoom', Math.E, 0]);
  const count = calls.length;
  for (const deltaY of [0, NaN, Infinity]) {
    assert.equal(emit(canvas, 'wheel', 200, 285, { deltaY }).defaultPrevented, false);
  }
  assert.equal(calls.length, count);
  controls.dispose();
});

test('double-click follows latest only on the time axis and while input is available', () => {
  const { canvas, calls, controls, state } = setup();
  assert.equal(emit(canvas, 'dblclick', 200, 269).defaultPrevented, false);
  assert.equal(emit(canvas, 'dblclick', 450, 285).defaultPrevented, false);
  state.allowed = false;
  assert.equal(emit(canvas, 'dblclick').defaultPrevented, false);
  state.allowed = true;
  assert.equal(emit(canvas, 'dblclick').defaultPrevented, true);
  assert.deepEqual(calls, [['begin'], ['follow'], ['change']]);
  controls.dispose();
});

test('double-click delegates latest restoration to the host for historical snapshots', () => {
  let restores = 0;
  const { canvas, calls, controls } = setup(() => restores++);
  emit(canvas, 'dblclick');
  assert.equal(restores, 1);
  assert.deepEqual(calls, [['begin'], ['change']]);
  controls.dispose();
});

test('cancel, lost capture, empty data and dispose release gestures without more zooms', () => {
  const { canvas, core, calls, controls } = setup();
  for (const stop of [() => emit(canvas, 'pointercancel'), () => emit(canvas, 'lostpointercapture'),
    () => controls.cancel(), () => { core.count = 0; controls.refresh(); }]) {
    core.count = 500;
    emit(canvas, 'pointerdown');
    assert.equal(canvas.hasPointerCapture(7), true);
    stop();
    assert.equal(canvas.hasPointerCapture(7), false);
    assert.equal(canvas.classes.has('time-axis-hover'), false);
    const count = calls.length;
    emit(canvas, 'pointermove', 220, 285);
    assert.equal(calls.length, count);
  }
  core.count = 500;
  emit(canvas, 'pointerdown');
  controls.dispose();
  assert.equal(canvas.hasPointerCapture(7), false);
  const count = calls.length;
  emit(canvas, 'pointerdown'); emit(canvas, 'wheel', 200, 285, { deltaY: -10 });
  emit(canvas, 'dblclick'); emit(canvas, 'pointermove', 220, 285);
  assert.equal(calls.length, count);
});

test('localized hover hint is host-owned and never overwrites the shared canvas title', () => {
  const { canvas, controls } = setup();
  emit(canvas, 'pointermove');
  assert.equal(canvas.classes.has('time-axis-hover'), true);
  assert.match(canvas.attributes.get('data-time-axis-hint'), /Drag right/);
  assert.equal(canvas.title, 'Chart hint');
  setLocale('zh-CN'); controls.refresh();
  assert.match(canvas.attributes.get('data-time-axis-hint'), /向右拖动放大/);
  canvas.title = 'Price axis hint';
  emit(canvas, 'pointerleave');
  assert.equal(canvas.attributes.has('data-time-axis-hint'), false);
  assert.equal(canvas.title, 'Price axis hint');
  controls.dispose();
  setLocale('en');
});
