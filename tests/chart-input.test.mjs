import test from 'node:test';
import assert from 'node:assert/strict';
import { createChartInput } from '../web/src/app/chart-input.ts';

class Canvas extends EventTarget {
  captures = new Set();
  classes = new Set();
  classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() { return { left: 10, top: 20 }; }
  focus() {}
}
function emit(canvas, type, x = 100, y = 100, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: x + 10, clientY: y + 20, pointerId: 7,
    button: 0, isPrimary: true, pointerType: 'mouse', deltaY: 0, deltaMode: 0 }, values);
  canvas.dispatchEvent(event);
  return event;
}
function setup() {
  const calls = [], canvas = new Canvas(), meta = new Float64Array(13);
  meta[3] = 0; meta[4] = 250; meta[9] = 80; meta[11] = 400; meta[12] = 270;
  const editor = name => ({ document: { items: [], selection: null, selected: null }, tool: 'pointer',
    drawing: false, dragging: false, down() { calls.push([name, 'down']); return false; },
    motion() { calls.push([name, 'motion']); }, cancel() { calls.push([name, 'cancel']); },
    up() { calls.push([name, 'up']); }, setTool(tool) { this.tool = tool; },
  });
  const core = name => ({ count: 500, pan: value => calls.push([name, 'pan', value]),
    zoom: (factor, anchor) => calls.push([name, 'zoom', factor, anchor]),
    drawingPoint: () => ({ time: 1000, price: 10 }),
  });
  const state = { core: core('first'), editor: editor('first'), selected: false, replay: false,
    frame: { meta, rows: new Float64Array() } };
  const touch = { active: false, down: () => false, move: () => false, end: () => false,
    cancel: () => calls.push(['touch', 'cancel']) };
  const measure = { active: false, hasResult: false, cancel() { this.active = false; calls.push(['measure', 'cancel']); },
    down: () => true, motion: () => {}, up: () => calls.push(['measure', 'up']) };
  let input;
  input = createChartInput({ canvas, getCore: () => state.core, getFrame: () => state.frame,
    getEditor: () => state.editor, getSize: () => ({ width: 400, height: 270, pageHeight: 300, pixelRatio: 1 }),
    getAppearance: () => ({}), getSeriesStyle: () => ({ type: 'candles' }),
    isSeriesSelected: () => state.selected, isReplayChoosing: () => state.replay,
    touch, measure, textBounds: () => [], selectSeries: selected => { state.selected = selected; },
    openSeriesSettings: () => calls.push(['series', 'open']), openTextSettings: () => {}, selectReplay: () => {},
    startMeasurement: () => { input.cancel(); measure.active = true; },
    cancelRange: () => calls.push(['range', 'cancel']), loadHistory: () => calls.push(['history']),
    followLatest: () => calls.push(['latest']), clearTooltip: () => calls.push(['tooltip', 'clear']),
    syncAxisTitle: () => {}, paint: level => calls.push(['paint', level]),
  });
  return { input, state, calls, canvas, core, editor, measure };
}

test('chart pointer stays free; pan begins at four pixels and wheel excludes both axes', () => {
  const { input, calls, canvas } = setup();
  emit(canvas, 'pointermove', 100, 73);
  assert.deepEqual(input.pointer, { x: 100, y: 73 });
  emit(canvas, 'pointerdown'); emit(canvas, 'pointermove', 103, 100);
  assert.equal(calls.some(call => call[1] === 'pan'), false);
  emit(canvas, 'pointermove', 104, 100);
  assert.deepEqual(calls.find(call => call[1] === 'pan'), ['first', 'pan', -.8]);
  emit(canvas, 'pointerup', 104, 100);
  assert.equal(input.dragging, false); assert.equal(canvas.captures.size, 0);
  assert.equal(emit(canvas, 'wheel', 401, 100, { deltaY: -1 }).defaultPrevented, false);
  assert.equal(emit(canvas, 'wheel', 100, 280, { deltaY: -1 }).defaultPrevented, false);
  assert.equal(emit(canvas, 'wheel', 100, 100, { deltaY: -1, deltaMode: 2 }).defaultPrevented, true);
  const zoom = calls.find(call => call[1] === 'zoom');
  assert.ok(Math.abs(zoom[2] - Math.exp(.45)) < 1e-12); assert.equal(zoom[3], .25);
  input.dispose();
});

test('cancel before symbol switch drops captured gesture and subsequent events use the new editor/core', () => {
  const { input, state, calls, canvas, core, editor } = setup();
  emit(canvas, 'pointerdown'); assert.equal(input.dragging, true);
  input.cancel(); assert.equal(canvas.captures.size, 0); assert.equal(input.pointer, null);
  state.core = core('second'); state.editor = editor('second'); calls.length = 0;
  emit(canvas, 'pointermove', 180, 100); emit(canvas, 'pointerup', 180, 100);
  assert.equal(calls.some(call => call[1] === 'pan'), false);
  emit(canvas, 'pointerdown'); emit(canvas, 'pointermove', 110, 100);
  assert.ok(calls.some(call => call[0] === 'second' && call[1] === 'down'));
  assert.ok(calls.some(call => call[0] === 'second' && call[1] === 'pan'));
  assert.equal(calls.some(call => call[0] === 'first'), false);
  input.dispose();
});

test('dispose releases measurement capture and detaches all canvas listeners', () => {
  const { input, calls, canvas, measure } = setup();
  measure.active = true; emit(canvas, 'pointerdown'); assert.equal(canvas.captures.size, 1);
  input.dispose(); assert.equal(measure.active, false); assert.equal(canvas.captures.size, 0);
  assert.equal(input.pointer, null); calls.length = 0;
  emit(canvas, 'pointerdown'); emit(canvas, 'pointermove', 120, 100); emit(canvas, 'pointerup');
  emit(canvas, 'wheel', 100, 100, { deltaY: -100 }); emit(canvas, 'keydown', 100, 100, { key: 'ArrowLeft' });
  assert.deepEqual(calls, []); assert.equal(canvas.captures.size, 0);
});
