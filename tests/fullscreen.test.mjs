import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreenControl } from '../web/src/ui/fullscreen.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

class Element extends EventTarget {
  attributes = new Map();
  classes = new Set();
  disabled = false;
  hidden = false;
  textContent = '';
  title = '';
  classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  click() { this.dispatchEvent(new Event('click')); }
}

const settled = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  setLocale('en');
  const doc = new EventTarget(), target = new Element(), button = new Element(), status = new Element();
  doc.fullscreenEnabled = true; doc.fullscreenElement = null; target.ownerDocument = doc;
  let enters = 0, exits = 0, changes = 0;
  const change = value => { doc.fullscreenElement = value; doc.dispatchEvent(new Event('fullscreenchange')); };
  target.requestFullscreen = async () => { enters++; change(target); };
  doc.exitFullscreen = async () => { exits++; change(null); };
  const control = createFullscreenControl({ target, button, status, onChange: () => { changes++; } });
  return { doc, target, button, status, control, change, calls: () => ({ enters, exits, changes }) };
}

test('fullscreen follows successful entry, browser exit and explicit exit without optimistic state', async () => {
  const f = fixture();
  assert.equal(f.button.title, 'Enter fullscreen'); assert.equal(f.status.hidden, true);
  f.button.click(); assert.equal(f.button.disabled, true); await settled();
  assert.equal(f.button.getAttribute('aria-pressed'), 'true'); assert.equal(f.button.title, 'Exit fullscreen');
  assert.equal(f.button.classes.has('active'), true); assert.equal(f.button.disabled, false);
  f.change(null);
  assert.equal(f.button.getAttribute('aria-pressed'), 'false'); assert.equal(f.button.title, 'Enter fullscreen');
  assert.equal(f.calls().exits, 0);
  f.button.click(); await settled(); f.button.click(); await settled();
  assert.deepEqual(f.calls(), { enters: 2, exits: 1, changes: 4 });
  assert.equal(f.doc.fullscreenElement, null); f.control.dispose();
});

test('pending requests prevent duplicate actions and rejection exposes a retryable failure', async () => {
  const f = fixture(); let reject, requests = 0;
  f.target.requestFullscreen = () => { requests++; return new Promise((_, fail) => { reject = fail; }); };
  f.button.click(); f.button.click();
  assert.equal(requests, 1); assert.equal(f.button.getAttribute('aria-busy'), 'true');
  assert.equal(f.button.getAttribute('aria-pressed'), 'false');
  f.doc.dispatchEvent(new Event('fullscreenerror'));
  assert.match(f.status.textContent, /could not be changed/);
  reject(new Error('Denied')); await settled();
  assert.equal(f.button.disabled, false); assert.equal(f.status.hidden, false);
  assert.equal(f.button.getAttribute('aria-busy'), 'false'); assert.equal(f.doc.fullscreenElement, null);
  f.target.requestFullscreen = async () => f.change(f.target);
  f.button.click(); await settled();
  assert.equal(f.status.hidden, true); assert.equal(f.button.getAttribute('aria-pressed'), 'true');
  f.control.dispose();
});

test('API resolution alone does not report fullscreen and exit failures retain actual active state', async () => {
  const f = fixture();
  f.target.requestFullscreen = async () => {};
  f.button.click(); await settled();
  assert.equal(f.button.getAttribute('aria-pressed'), 'false'); assert.equal(f.calls().changes, 0);
  f.change(f.target);
  f.doc.exitFullscreen = () => { throw new Error('Exit rejected'); };
  f.button.click(); await settled();
  assert.equal(f.button.getAttribute('aria-pressed'), 'true'); assert.equal(f.button.disabled, false);
  assert.match(f.status.textContent, /could not be changed/); f.control.dispose();
});

test('unavailable APIs and unrelated fullscreen stay disabled with localized state feedback', async () => {
  const f = fixture();
  f.doc.fullscreenEnabled = false; f.control.refresh(); f.button.click(); await settled();
  assert.equal(f.button.disabled, true); assert.match(f.status.textContent, /unavailable/); assert.equal(f.calls().enters, 0);
  f.doc.fullscreenEnabled = true; f.target.requestFullscreen = undefined; f.control.refresh();
  assert.equal(f.button.disabled, true);
  f.target.requestFullscreen = async () => f.change(f.target);
  f.change(new Element()); f.button.click(); await settled();
  assert.equal(f.button.disabled, true); assert.match(f.status.textContent, /Another element/); assert.equal(f.calls().exits, 0);
  setLocale('zh-CN'); f.control.refresh(); assert.match(f.status.textContent, /其他元素/);
  f.change(null); assert.equal(f.button.title, '进入全屏');
  f.change(f.target); assert.equal(f.button.title, '退出全屏');
  f.doc.fullscreenEnabled = false; f.control.refresh(); assert.equal(f.button.disabled, false);
  f.control.dispose(); setLocale('en');
});

test('disposal removes listeners and prevents an in-flight completion from updating controls', async () => {
  const f = fixture(); let complete;
  f.target.requestFullscreen = () => new Promise(resolve => { complete = resolve; });
  f.button.click(); f.control.dispose();
  const title = f.button.title;
  f.change(f.target); complete(); await settled(); f.control.refresh(); f.button.click();
  assert.equal(f.calls().changes, 0); assert.equal(f.button.title, title);
  assert.equal(f.button.getAttribute('aria-pressed'), 'false');
});
