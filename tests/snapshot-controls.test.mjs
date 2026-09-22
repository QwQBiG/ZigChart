import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotControls } from '../web/src/features/export/controls.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; }
  children = []; attributes = new Map(); dataset = {};
  disabled = false; hidden = false; open = false; textContent = '';
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parent = this; } }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  focus() { this.focused = true; }
  click() { this.dispatchEvent(new Event('click')); }
  showModal() { this.open = true; }
  close() {
    if (!this.open) return;
    this.open = false; queueMicrotask(() => this.dispatchEvent(new Event('close')));
  }
  cancel() { if (this.dispatchEvent(new Event('cancel', { cancelable: true }))) this.close(); }
}
const settled = () => new Promise(resolve => setImmediate(resolve));
const result = filename => ({ blob: new Blob(['fixture'], { type: 'image/png' }), filename, width: 1200, height: 600 });
function fixture(context) {
  setLocale('en');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const body = new Element('body'), button = new Element('button'), pending = [], created = [], revoked = [];
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body, createElement: tag => new Element(tag) } });
  context.mock.method(URL, 'createObjectURL', blob => { const url = `blob:chart-${created.length}`; created.push({ url, blob }); return url; });
  context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const controls = createSnapshotControls({ button, capture: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  const dialog = body.children[0], [header, content, footer] = dialog.children;
  const [preview, status] = content.children, [retry, close, download] = footer.children;
  context.after(() => {
    controls.dispose(); setLocale('en');
    if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document;
  });
  return { body, button, controls, dialog, header, content, preview, status, retry, close, download, pending, created, revoked };
}

test('cancelled snapshots cannot replace a reopened preview and completed URLs are released', async context => {
  const f = fixture(context);
  f.button.click();
  assert.equal(f.button.getAttribute('aria-expanded'), 'true');
  assert.equal(f.content.getAttribute('aria-busy'), 'true');
  assert.equal(f.download.hidden, true);
  f.dialog.cancel(); f.button.click();
  assert.equal(f.pending.length, 2);
  f.pending[1].resolve(result('current.png')); await settled();
  const current = f.created[0].url;
  assert.equal(f.dialog.open, true); assert.equal(f.download.download, 'current.png');
  assert.equal(f.download.href, current); assert.equal(f.preview.src, current);
  assert.match(f.preview.alt, /1200 × 600 pixels/);
  assert.equal(f.content.getAttribute('aria-busy'), 'false');
  f.pending[0].resolve(result('stale.png')); await settled();
  assert.equal(f.created.length, 1); assert.equal(f.download.download, 'current.png');
  f.close.click(); await settled();
  assert.deepEqual(f.revoked, [current]); assert.equal(f.preview.src, undefined);
  assert.equal(f.download.href, undefined); assert.equal(f.button.getAttribute('aria-expanded'), 'false');
  f.button.click(); f.pending[2].resolve(result('dispose.png')); await settled();
  f.controls.dispose();
  assert.deepEqual(f.revoked, f.created.map(item => item.url)); assert.equal(f.body.children.length, 0);
});

test('capture rejection is localized and retryable without overriding host disabled state', async context => {
  const f = fixture(context);
  f.button.disabled = true; f.controls.refresh(); f.button.click();
  assert.equal(f.pending.length, 0); assert.equal(f.button.disabled, true);
  f.button.disabled = false; f.button.click(); f.button.click();
  assert.equal(f.pending.length, 1);
  f.button.disabled = true; f.controls.refresh();
  f.pending[0].reject(new Error('Canvas encoding rejected')); await settled();
  assert.equal(f.status.getAttribute('role'), 'status'); assert.match(f.status.textContent, /could not be prepared/);
  assert.equal(f.retry.hidden, false); assert.equal(f.download.hidden, true);
  assert.equal(f.button.disabled, true); assert.equal(f.content.getAttribute('aria-busy'), 'false');
  setLocale('zh-CN'); f.controls.refresh();
  assert.equal(f.button.getAttribute('aria-label'), '保存图表图片'); assert.match(f.status.textContent, /请重试/);
  f.retry.click(); f.pending[1].resolve(result('retry.png')); await settled();
  assert.equal(f.download.download, 'retry.png'); assert.equal(f.download.textContent, '下载 PNG');
  assert.match(f.preview.alt, /像素/); assert.equal(f.retry.hidden, true); assert.equal(f.button.disabled, true);
});

test('disposal suppresses an in-flight result and detaches the trigger', async context => {
  const f = fixture(context);
  f.button.click(); f.controls.dispose();
  f.pending[0].resolve(result('late.png')); await settled();
  f.controls.refresh(); f.button.click();
  assert.equal(f.created.length, 0); assert.equal(f.pending.length, 1);
  assert.equal(f.button.getAttribute('aria-expanded'), 'false'); assert.equal(f.body.children.length, 0);
});
