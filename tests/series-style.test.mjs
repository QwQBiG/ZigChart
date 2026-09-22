import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SERIES_STYLE, SERIES_TYPES, parseSeriesStyle, readSeriesStyle } from '../web/src/features/series/model.ts';
import { createSeriesControls } from '../web/src/features/series/controls.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

afterEach(() => setLocale('en'));

test('version 1 series preferences migrate without losing styles and baseline prices remain bounded raw units', () => {
  const old = { version: 1, type: 'area', lineColor: '#fedcba', lineWidth: 3, lineType: 'step' };
  const migrated = parseSeriesStyle(old);
  assert.equal(migrated.version, 2); assert.equal(migrated.type, 'area');
  assert.equal(migrated.lineColor, old.lineColor); assert.equal(migrated.baselineSource, 'first-visible');
  for (const baselinePrice of [-1e12, 0, 1e12]) {
    assert.equal(parseSeriesStyle({ ...migrated, baselinePrice }).baselinePrice, baselinePrice);
  }
  for (const baselinePrice of [NaN, Infinity, 1e12 + 1, 2.5, '100']) {
    assert.equal(parseSeriesStyle({ ...migrated, baselinePrice }).baselinePrice, 0);
  }
});

test('all supported chart types preserve independent line and area preferences', () => {
  const style = { ...DEFAULT_SERIES_STYLE, lineColor: '#abcdef', lineWidth: 4,
    lineType: 'step', areaTopColor: '#123456', areaBottomColor: '#fedcba' };
  for (const type of SERIES_TYPES) {
    const expected = { ...style, type };
    assert.deepEqual(readSeriesStyle(JSON.stringify(expected)), expected);
  }
  assert.equal(DEFAULT_SERIES_STYLE.type, 'candles');
  assert.ok(Object.isFrozen(DEFAULT_SERIES_STYLE));
});

test('invalid series documents fall back without retaining arbitrary fields', () => {
  for (const text of [null, '', '{', 'null', 'false', '42', '[]', '{}', '{"version":3,"type":"line"}']) {
    assert.deepEqual(readSeriesStyle(text), DEFAULT_SERIES_STYLE, String(text));
  }
  const parsed = parseSeriesStyle({ version: 1, type: 'area', lineColor: '#ABCDEF', lineWidth: 4,
    lineType: 'step', areaTopColor: 'red', areaBottomColor: '#fff', theme: 'light', extra: 42 });
  assert.deepEqual(parsed, { ...DEFAULT_SERIES_STYLE, type: 'area', lineColor: '#abcdef', lineWidth: 4, lineType: 'step' });
  assert.equal(Object.hasOwn(parsed, 'theme'), false);
  assert.equal(Object.hasOwn(parsed, 'extra'), false);
});

test('width and color validation reject unsafe values independently', () => {
  for (const lineWidth of [1, 2, 3, 4]) {
    assert.equal(parseSeriesStyle({ version: 1, lineWidth }).lineWidth, lineWidth);
  }
  for (const lineWidth of [0, 5, 2.5, Infinity, NaN, '3', null]) {
    assert.equal(parseSeriesStyle({ version: 1, lineWidth }).lineWidth, DEFAULT_SERIES_STYLE.lineWidth);
  }
  for (const lineColor of ['#fff', '#12345678', 'url(example)', 'transparent', 0]) {
    assert.equal(parseSeriesStyle({ version: 1, lineColor }).lineColor, DEFAULT_SERIES_STYLE.lineColor);
  }
  const parsed = parseSeriesStyle({ version: 1, type: 'renko', lineType: 'curved', areaTopColor: '#ABCDEF' });
  assert.equal(parsed.type, 'candles');
  assert.equal(parsed.lineType, 'simple');
  assert.equal(parsed.areaTopColor, '#abcdef');
  const missing = readSeriesStyle(null);
  missing.lineColor = '#000000';
  assert.equal(readSeriesStyle(null).lineColor, DEFAULT_SERIES_STYLE.lineColor);
});

class Select extends EventTarget {
  value = '';
  title = '';
  attributes = new Map();
  children = [];
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes.set(key, value); }
}

test('type controls change only type, localize without resetting styles, and dispose events', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({}) } });
  let controls;
  try {
    let state = { ...DEFAULT_SERIES_STYLE, lineColor: '#123456', lineWidth: 3 };
    const select = new Select();
    const changes = [];
    controls = createSeriesControls(select, { getState: () => state, onChange(next) { changes.push(next); state = next; } });
    assert.deepEqual(select.children.map(option => option.value), SERIES_TYPES);
    assert.equal(select.value, 'candles');
    select.value = 'line'; select.dispatchEvent(new Event('change'));
    assert.deepEqual(state, { ...DEFAULT_SERIES_STYLE, type: 'line', lineColor: '#123456', lineWidth: 3 });
    assert.equal(changes.length, 1);
    select.dispatchEvent(new Event('change'));
    assert.equal(changes.length, 1, 'Selecting the current type must not create another edit');
    setLocale('zh-CN'); controls.refresh();
    assert.equal(select.attributes.get('aria-label'), '图表类型');
    assert.equal(select.children.find(option => option.value === 'line').textContent, '折线图');
    assert.equal(select.value, 'line');
    select.value = 'invalid'; select.dispatchEvent(new Event('change'));
    assert.equal(select.value, 'line');
    assert.equal(changes.length, 1);
    controls.dispose();
    select.value = 'area'; select.dispatchEvent(new Event('change'));
    assert.equal(state.type, 'line');
  } finally {
    controls?.dispose();
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else delete globalThis.document;
  }
});
