import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceScaleControls } from '../web/src/chart/price-scale-controls.ts';
import { setLocale, t } from '../web/src/ui/i18n.ts';

class Control extends EventTarget {
  title = '';
  textContent = '';
  disabled = false;
  attributes = new Map();
  captures = new Set();
  classes = new Set();
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(name, value) { this.attributes.set(name, value); }
  getBoundingClientRect() { return { left: 10, top: 20 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  focus() {}
}
function emit(target, type, x = 450, y = 105, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: x + 10, clientY: y + 20, pointerId: 7, button: 0, isPrimary: true }, values);
  target.dispatchEvent(event);
  return event;
}
function setup() {
  setLocale('en');
  const canvas = new Control(), button = new Control(), calls = [];
  const core = { count: 500, scaleIsAuto: true,
    scalePrice(factor, anchor) { calls.push(['scale', factor, anchor]); this.scaleIsAuto = false; },
    resetScale() { calls.push(['reset']); this.scaleIsAuto = true; },
  };
  const meta = new Float64Array(13);
  meta[3] = 10; meta[4] = 200; meta[11] = 400;
  const state = { allowed: true };
  let controls;
  controls = createPriceScaleControls({ canvas, button, getCore: () => core, getFrame: () => ({ meta, rows: [] }),
    getSize: () => ({ width: 500, height: 300 }), canStart: () => state.allowed,
    onBegin() { calls.push(['begin']); controls?.cancel(); }, onChange() { calls.push(['change']); },
  });
  return { canvas, button, core, calls, controls, state };
}

test('price-axis capture excludes the plot, volume/time axis and click-only gestures', () => {
  const { canvas, calls, controls, state } = setup();
  let downstream = 0;
  canvas.addEventListener('pointerdown', () => downstream++);
  for (const [x, y] of [[399, 100], [450, 230], [450, 290], [500, 100]]) {
    assert.equal(emit(canvas, 'pointerdown', x, y).defaultPrevented, false);
  }
  assert.equal(downstream, 4);
  state.allowed = false;
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, false);
  state.allowed = true;
  assert.equal(emit(canvas, 'pointerdown').defaultPrevented, true);
  assert.equal(canvas.hasPointerCapture(7), true);
  emit(canvas, 'pointermove', 450, 103);
  emit(canvas, 'pointerup', 450, 103);
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.deepEqual(calls, [['begin']]);
  assert.equal(downstream, 5);
  controls.dispose();
});

test('upward drag magnifies about the initial price fraction, bounds jumps and cleans cancellation', () => {
  const { canvas, button, calls, controls } = setup();
  emit(canvas, 'pointerdown');
  emit(canvas, 'pointermove', 390, 95);
  const first = calls.find(call => call[0] === 'scale');
  assert.equal(first[1], Math.exp(.1));
  assert.equal(first[2], .5);
  assert.equal(button.attributes.get('aria-pressed'), 'false');
  assert.equal(canvas.classes.has('price-axis-hover'), true);
  emit(canvas, 'pointermove', 390, -1000);
  assert.equal(calls.filter(call => call[0] === 'scale').at(-1)[1], Math.E);
  emit(canvas, 'lostpointercapture');
  assert.equal(canvas.hasPointerCapture(7), false);
  assert.equal(canvas.classes.has('price-axis-hover'), false);
  const count = calls.length;
  emit(canvas, 'pointermove', 350, 50);
  assert.equal(calls.length, count);
  controls.dispose();
});

test('axis double-click and Auto reset, keyboard zoom and localization remain independent', () => {
  const { canvas, button, core, calls, controls } = setup();
  assert.equal(emit(canvas, 'dblclick', 350, 100).defaultPrevented, false);
  assert.equal(emit(canvas, 'dblclick').defaultPrevented, true);
  emit(button, 'keydown', 0, 0, { key: 'ArrowUp' });
  assert.deepEqual(calls.find(call => call[0] === 'scale'), ['scale', 1.1, .5]);
  assert.equal(core.scaleIsAuto, false);
  emit(button, 'click');
  assert.equal(core.scaleIsAuto, true);
  setLocale('zh-CN'); controls.refresh();
  assert.equal(button.textContent, t('priceScaleAuto'));
  emit(canvas, 'pointermove');
  assert.equal(canvas.title, t('priceScaleHint'));
  controls.dispose();
  const count = calls.length;
  emit(button, 'click'); emit(canvas, 'pointerdown');
  assert.equal(calls.length, count);
  assert.equal(canvas.title, '');
  setLocale('en');
});
