import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeasureController } from '../web/src/features/measure/controller.ts';
import { formatMeasurement } from '../web/src/features/measure/controls.ts';
import { drawMeasure } from '../web/src/features/measure/render.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

function fixture() {
  const size = { width: 800, height: 500 }, calls = [];
  let changed = 0, available = true;
  const core = {
    drawingPoint(x, y) {
      if (x < 0 || x > 100 || y < 0 || y > 200) return null;
      return { index: Math.floor(x / 10), time: 1_000 + Math.floor(x / 10) * 60_000, price: Math.round(1000 - y) };
    },
    measure(a, b, width, height) {
      calls.push({ a: { ...a }, b: { ...b }, width, height });
      return available ? { x1: a.time, y1: a.price, x2: b.time, y2: b.price } : null;
    },
  };
  const control = createMeasureController({ getCore: () => core, getSize: () => size, onChange: () => changed++ });
  return { control, size, calls, available(value) { available = value; }, changes: () => changed };
}
const p = (x, y = 10) => ({ x, y });

test('two-click measurement tracks after first release, then freezes and disarms', () => {
  const f = fixture(), c = f.control;
  assert.equal(c.down(p(10)), false); c.enable(); assert.equal(c.active, true);
  assert.equal(c.down(p(10)), true); c.up(p(10));
  assert.equal(c.measuring, true); assert.equal(c.hasResult, false);
  c.motion(p(30, 50)); c.result();
  assert.deepEqual(f.calls.at(-1).b, { time: 181000, price: 950 });
  c.down(p(40, 60)); c.up(p(40, 60));
  assert.equal(c.active, false); assert.equal(c.measuring, false); assert.equal(c.hasResult, true);
  const result = c.result(); c.motion(p(80, 90)); c.up(p(80, 90));
  assert.deepEqual(c.result(), result); assert.equal(c.down(p(80)), false);
  c.cancel(); assert.equal(c.result(), null); assert.equal(c.hasResult, false);
});

test('four-pixel drag completes and anchors retain UTC and raw integer prices only', () => {
  const f = fixture(), c = f.control; c.enable(); c.down(p(20, 20)); c.up(p(20, 23));
  assert.equal(c.measuring, true); c.cancel(); c.enable(); c.down(p(20, 20)); c.up(p(20, 24));
  assert.equal(c.hasResult, true); c.result();
  assert.deepEqual(f.calls.at(-1).a, { time: 121000, price: 980 });
  assert.deepEqual(f.calls.at(-1).b, { time: 121000, price: 976 });
  f.size.width = 420; c.result(); assert.equal(f.calls.at(-1).width, 420);
  f.available(false); assert.equal(c.result(), null);
});

test('invalid positions cannot start or finish; cancellation and rearming discard old anchors', () => {
  const f = fixture(), c = f.control; c.enable();
  assert.equal(c.down(p(-1)), true); c.up(p(-1)); assert.equal(c.measuring, false);
  c.down(p(10)); c.motion(p(50, 90)); c.up(p(101));
  assert.equal(c.measuring, true); assert.equal(c.hasResult, false);
  c.down(p(70, 30)); c.up(p(70, 30)); assert.equal(c.hasResult, true);
  c.enable(); assert.equal(c.result(), null); assert.equal(c.hasResult, false);
  c.down(p(20)); c.toggle(); assert.equal(c.active, false); assert.equal(c.result(), null);
  const changes = f.changes(); c.motion(p(30)); c.up(p(30)); assert.equal(f.changes(), changes);
});

test('measurement labels preserve signed raw prices, elapsed gaps, inclusive count and unavailable values', () => {
  const value = { priceChange: -123, percentChange: -1.234, barDistance: -2,
    elapsedMs: -259261001, volume: 1234, barCount: 3 };
  setLocale('en');
  const en = formatMeasurement(value, { priceScale: 100, volumeScale: 10 });
  assert.equal(en[0], 'Price change: -1.23 (−1.23%)');
  assert.equal(en[1], 'Bar distance: −2 · Elapsed: −3 d 1 min 1 s 1 ms');
  assert.equal(en[2], 'Volume: 123.4 (3 bars, both endpoints included)');
  const unavailable = formatMeasurement({ ...value, percentChange: null, volume: null }, { priceScale: 100, volumeScale: 10 });
  assert.match(unavailable[0], /Unavailable/); assert.match(unavailable[2], /Unavailable/);
  setLocale('zh-CN');
  const zh = formatMeasurement(value, { priceScale: 100, volumeScale: 10 });
  assert.match(zh[1], /K 线间距: −2/); assert.match(zh[1], /−3 天 1 分钟 1 秒 1 毫秒/);
  assert.match(zh[2], /3 根，含两端 K 线/); setLocale('en');
});

test('rendering clips to the main price pane and skips hidden price panes', () => {
  const calls = [], ctx = new Proxy({}, { get: (_, key) => (...args) => calls.push([key, ...args]), set: () => true });
  const frame = { meta: new Float64Array(13) }; frame.meta[3] = 120; frame.meta[4] = 300; frame.meta[11] = 600;
  const value = { x1: -20, y1: 100, x2: 400, y2: 330, priceChange: 50 };
  drawMeasure(ctx, frame, value);
  assert.deepEqual(calls.slice(0, 4), [['save'], ['beginPath'], ['rect', 0, 120, 600, 180], ['clip']]);
  assert.deepEqual(calls.at(-1), ['restore']); calls.length = 0;
  frame.meta[4] = frame.meta[3]; drawMeasure(ctx, frame, value); assert.equal(calls.length, 0);
});
