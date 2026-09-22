import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, parseLayout, readLayout } from '../web/src/ui/layout-preferences.ts';
import { createPaneResizers } from '../web/src/ui/pane-resizers.ts';
import { createWorkspaceLayout } from '../web/src/ui/workspace-layout.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

class Element extends EventTarget {
  constructor(doc) { super(); this.ownerDocument = doc; }
  children = [];
  attributes = new Map();
  captures = new Set();
  classes = new Set();
  classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
  properties = new Map();
  style = { getPropertyValue: key => this.properties.get(key) ?? '',
    setProperty: (key, value) => this.properties.set(key, value) };
  title = '';
  hidden = false;
  tabIndex = 0;
  clientWidth = 1200;
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(node) { this.children.push(node); node.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  focus() {}
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
function emit(target, type, values = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { clientX: 600, clientY: 100, pointerId: 7, button: 0, isPrimary: true }, values);
  target.dispatchEvent(event); return event;
}
function frame(ids = [0, 1, 2, 3]) {
  const meta = new Float64Array(13); meta[12] = 400;
  return { meta, rows: new Float64Array(), panes: ids.map((id, index) => ({ id,
    top: index * 400 / ids.length, bottom: (index + 1) * 400 / ids.length })) };
}
function fixture() {
  setLocale('en');
  const doc = { createElement: () => new Element(doc) };
  const container = new Element(doc), first = new Element(doc); container.append(first);
  const state = { weights: [.74, .26, .26, .26], ids: [0, 1, 2, 3], paints: 0, commits: 0, starts: 0 };
  let weights = [...state.weights];
  const calls = [];
  let order = [0, 1, 2, 3];
  const core = {
    maximizedPane: -1,
    getPaneOrder: () => [...order],
    movePane(id, direction) {
      const index = order.indexOf(id), next = index + direction;
      if (next >= 0 && next < order.length) [order[index], order[next]] = [order[next], order[index]];
    },
    maximizePane(id) { this.maximizedPane = id; },
    getPaneWeights: () => [...weights],
    setPaneWeights(next) { calls.push(['set', [...next]]); weights = [...next]; },
    resizePane(upper, delta, height) {
      calls.push(['resize', upper, delta, height]);
      const lower = state.ids[state.ids.indexOf(upper) + 1];
      const step = Math.sign(delta) * Math.min(Math.abs(delta) / height, .01);
      weights[upper] += step; weights[lower] -= step;
    },
  };
  const controls = createPaneResizers({ container, first, getCore: () => core, getWeights: () => state.weights,
    onWeights: next => { state.weights = next; }, onCommit: () => state.commits++,
    onStart: () => state.starts++, requestPaint: () => state.paints++,
  });
  controls.updateFrame(frame());
  return { doc, container, first, core, state, calls, controls };
}

test('layout preferences migrate v1 and retain valid independent v2 pane weights', () => {
  assert.deepEqual(parseLayout({ version: 1, sidebarWidth: 340, priceFraction: .6 }),
    { version: 3, sidebarWidth: 340, paneWeights: [.6, .4, .26, .26], paneOrder: [0, 1, 2, 3] });
  assert.deepEqual(parseLayout({ version: 1, priceFraction: 5 }).paneWeights, [.85, 1 - .85, .26, .26]);
  const input = { version: 2, sidebarWidth: 10, paneWeights: [1, 2, 3, 4] };
  const parsed = parseLayout(input); input.paneWeights[2] = 99;
  assert.deepEqual(parsed, { version: 3, sidebarWidth: 220, paneWeights: [1, 2, 3, 4], paneOrder: [0, 1, 2, 3] });
  for (const paneWeights of [[1, 2, 3], [1, 0, 3, 4], [1, NaN, 3, 4], [1, Infinity, 3, 4], [1, '2', 3, 4], new Array(4)]) {
    assert.deepEqual(parseLayout({ version: 2, paneWeights }).paneWeights, defaultLayout().paneWeights);
  }
  assert.deepEqual(readLayout('{'), defaultLayout());
  assert.deepEqual(parseLayout({ version: 9, sidebarWidth: 999 }), defaultLayout());
});

test('adjacent boundaries use frame geometry and batch pointer deltas into one core call per paint', () => {
  const { container, first, controls, calls, state, core } = fixture();
  assert.equal(container.children.length, 3);
  assert.deepEqual(container.children.map(node => node.style.top), ['100px', '200px', '300px']);
  assert.equal(emit(first, 'pointerdown').defaultPrevented, true);
  emit(first, 'pointermove', { clientY: 103 });
  assert.equal(controls.flush(), false);
  emit(first, 'pointermove', { clientY: 106 });
  emit(first, 'pointermove', { clientY: 120 });
  assert.deepEqual(calls, []);
  assert.equal(controls.flush(), true);
  assert.deepEqual(calls, [['resize', 0, 20, 400]]);
  assert.deepEqual(state.weights, core.getPaneWeights());
  assert.equal(state.commits, 0);
  emit(first, 'pointerup');
  assert.equal(state.commits, 1);
  assert.equal(first.hasPointerCapture(7), false);
  assert.equal(controls.flush(), false);
  controls.dispose();
});

test('cancel and capture loss roll back flushed previews and discard pending deltas', () => {
  const { first, controls, calls, core, state } = fixture();
  for (const type of ['pointercancel', 'lostpointercapture', 'keydown']) {
    const before = core.getPaneWeights();
    emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 120 }); controls.flush();
    emit(first, 'pointermove', { clientY: 125 });
    emit(first, type, { key: 'Escape' });
    assert.deepEqual(state.weights, before);
    controls.flush();
    assert.deepEqual(core.getPaneWeights(), before);
    assert.equal(first.hasPointerCapture(7), false);
  }
  assert.equal(state.commits, 0);
  assert.equal(calls.filter(call => call[0] === 'resize').length, 3);
  controls.dispose();
});

test('adding and removing panes retains inactive weights and cancels an obsolete boundary', () => {
  const { container, first, controls, core, state, calls } = fixture();
  const original = core.getPaneWeights();
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 120 }); controls.flush();
  emit(first, 'pointermove', { clientY: 130 });
  state.ids = [0, 2, 3]; controls.updateFrame(frame(state.ids)); controls.flush();
  assert.deepEqual(core.getPaneWeights(), original);
  assert.equal(first.hasPointerCapture(7), false);
  assert.equal(first.getAttribute('data-lower-pane'), '2');
  assert.equal(container.children[2].hidden, true);
  emit(first, 'keydown', { key: 'ArrowDown' }); controls.flush();
  assert.deepEqual(calls.at(-1), ['resize', 0, 8, 400]);
  assert.equal(core.getPaneWeights()[1], original[1]);
  const retained = core.getPaneWeights();
  state.ids = [0]; controls.updateFrame(frame(state.ids));
  assert.ok(container.children.every(node => node.hidden && node.tabIndex === -1));
  state.ids = [0, 1, 2, 3]; controls.updateFrame(frame(state.ids));
  assert.equal(container.children.length, 3);
  assert.deepEqual(core.getPaneWeights(), retained);
  controls.dispose();
});

test('keyboard deltas coalesce, Home/End delegate bounds, and double-click resets only its pair', () => {
  const { container, controls, core, state, calls } = fixture();
  const middle = container.children[1];
  emit(middle, 'keydown', { key: 'ArrowDown' }); emit(middle, 'keydown', { key: 'ArrowDown' });
  controls.flush();
  assert.deepEqual(calls.at(-1), ['resize', 1, 16, 400]);
  emit(middle, 'keydown', { key: 'Home' }); emit(middle, 'keydown', { key: 'End' }); controls.flush();
  assert.deepEqual(calls.at(-1), ['resize', 1, 800, 400]);
  emit(middle, 'keydown', { key: 'Home' }); controls.flush();
  assert.deepEqual(calls.at(-1), ['resize', 1, -800, 400]);
  const before = core.getPaneWeights();
  emit(middle, 'dblclick');
  assert.deepEqual(core.getPaneWeights(), before);
  controls.flush();
  const after = core.getPaneWeights();
  assert.equal(after[0], before[0]); assert.equal(after[3], before[3]);
  assert.equal(after[1], after[2]);
  assert.ok(Math.abs(after[1] + after[2] - before[1] - before[2]) < 1e-12);
  assert.equal(state.commits, 6);
  controls.dispose();
});

test('click-only gestures do not save, locale refresh labels pairs, and disposal removes handlers', () => {
  const { container, first, controls, calls, state } = fixture();
  emit(first, 'pointerdown', { isPrimary: false });
  assert.equal(first.hasPointerCapture(7), false);
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 103 }); emit(first, 'pointerup');
  assert.equal(controls.flush(), false); assert.equal(state.commits, 0);
  setLocale('zh-CN'); controls.refresh();
  assert.match(first.getAttribute('aria-label'), /价格 \/ 成交量/);
  assert.match(first.title, /双击恢复这对图窗/);
  controls.dispose();
  emit(first, 'pointerdown'); emit(first, 'keydown', { key: 'ArrowDown' });
  assert.deepEqual(calls, []); assert.equal(container.children.length, 1);
  assert.equal(first.hidden, true);
  setLocale('en');
});

function workspaceFixture(context, unavailableStorage = false) {
  const fixtureValue = fixture(); fixtureValue.controls.dispose();
  const { doc, container, first, core, state } = fixtureValue;
  const desk = new Element(doc), side = new Element(doc), windowTarget = new EventTarget();
  const storage = new Map([['zigchart.layout', JSON.stringify({ version: 1, sidebarWidth: 264, priceFraction: .6 })]]);
  doc.querySelector = () => desk;
  doc.getElementById = id => ({ 'chart-container': container, 'sidebar-resizer': side, 'pane-resizer': first })[id];
  const injected = { document: doc, window: windowTarget, getComputedStyle: () => desk.style,
    localStorage: { getItem: key => { if (unavailableStorage) throw Error('Storage denied'); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (unavailableStorage) throw Error('Storage denied'); storage.set(key, value); } },
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(injected)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  context.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const layout = createWorkspaceLayout({ getCore: () => core, getFrame: () => frame(),
    onStart: () => state.starts++, requestPaint: () => state.paints++,
  });
  core.setPaneWeights(layout.paneWeights);
  context.after(() => layout.dispose());
  return { ...fixtureValue, desk, side, storage, layout, windowTarget };
}

test('arrangement rolls back active resize and saves order independently of transient maximization', context => {
  const { first, core, layout, storage } = workspaceFixture(context);
  const weights = core.getPaneWeights();
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 150 }); layout.flush();
  assert.notDeepEqual(core.getPaneWeights(), weights);
  layout.movePane(0, 1);
  assert.deepEqual(core.getPaneWeights(), weights);
  assert.deepEqual(layout.paneOrder, [1, 0, 2, 3]);
  const saved = storage.get('zigchart.layout');
  assert.deepEqual(JSON.parse(saved).paneOrder, [1, 0, 2, 3]);
  layout.maximizePane(2); assert.equal(layout.maximizedPane, 2);
  assert.equal(storage.get('zigchart.layout'), saved);
  layout.maximizePane(-1); assert.deepEqual(core.getPaneWeights(), weights);
});

test('workspace keeps sidebar batching and width bounds while saving core pane weights as version 3', context => {
  const { desk, side, first, core, calls, layout, storage, windowTarget } = workspaceFixture(context);
  assert.deepEqual(layout.paneWeights, [.6, .4, .26, .26]);
  const copy = layout.paneWeights; copy[0] = 99;
  assert.equal(layout.paneWeights[0], .6);
  calls.length = 0;
  emit(side, 'pointerdown');
  emit(side, 'pointermove', { clientX: 580 }); emit(side, 'pointermove', { clientX: 560 });
  assert.equal(desk.style.getPropertyValue('--sidebar-width'), '264px');
  assert.equal(layout.flush(), true);
  assert.equal(desk.style.getPropertyValue('--sidebar-width'), '304px');
  assert.deepEqual(calls, []);
  emit(side, 'pointerup'); layout.flush();
  emit(side, 'keydown', { key: 'End' }); layout.flush();
  assert.equal(desk.style.getPropertyValue('--sidebar-width'), '926px');
  desk.clientWidth = 500; windowTarget.dispatchEvent(new Event('resize')); layout.flush();
  assert.equal(desk.style.getPropertyValue('--sidebar-width'), '452px');
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 110 });
  emit(first, 'pointerup'); layout.flush();
  const saved = JSON.parse(storage.get('zigchart.layout'));
  assert.equal(saved.version, 3); assert.equal(saved.sidebarWidth, 452);
  assert.equal(Object.hasOwn(saved, 'priceFraction'), false);
  assert.deepEqual(saved.paneWeights, core.getPaneWeights());
  assert.deepEqual(layout.paneWeights, saved.paneWeights);
});

test('resetFrame rolls a resize back before new panes and denied storage leaves resizing usable', context => {
  const { first, layout, core, container } = workspaceFixture(context, true);
  const original = core.getPaneWeights();
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 120 }); layout.flush();
  assert.notDeepEqual(core.getPaneWeights(), original);
  layout.resetFrame();
  assert.deepEqual(layout.paneWeights, original);
  assert.ok(container.children.every(node => node.hidden));
  layout.flush();
  assert.deepEqual(core.getPaneWeights(), original);
  layout.updateFrame(frame());
  emit(first, 'keydown', { key: 'ArrowDown' });
  assert.doesNotThrow(() => layout.flush());
  assert.notDeepEqual(core.getPaneWeights(), original);
});

test('disposal rolls back active core previews without scheduling another paint', () => {
  const { first, controls, core, state } = fixture();
  const original = core.getPaneWeights();
  emit(first, 'pointerdown'); emit(first, 'pointermove', { clientY: 120 }); controls.flush();
  const paints = state.paints;
  controls.dispose();
  assert.deepEqual(core.getPaneWeights(), original);
  assert.equal(state.paints, paints);
  assert.equal(first.hasPointerCapture(7), false);
});
