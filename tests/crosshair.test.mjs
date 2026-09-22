import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CROSSHAIR_STYLE, parseCrosshairStyle, readCrosshairStyle } from '../web/src/features/crosshair/model.ts';
import { resolveCrosshair } from '../web/src/features/crosshair/resolve.ts';
import { DEFAULT_SERIES_STYLE } from '../web/src/features/series/model.ts';

function frame() {
  const meta = new Float64Array([100, 200, 500, 10, 110, 125, 165, 14.4, 0, 10, 3, 200, 180]);
  const rows = new Float64Array(3 * 17);
  for (let i = 0; i < 3; i++) {
    rows.set([i, 1700000000000 + i * 60000, 120 + i * 10, 180 + i * 10, 110 + i * 10,
      160 + i * 10, 300, NaN, NaN, 10 + 20 * i, 90 - i * 10, 30 - i * 10, 100 - i * 10,
      50 - i * 10, 141, NaN, NaN], i * 17);
  }
  return { rows, meta };
}
const resolve = (f, pointer, mode = 'magnet', series = DEFAULT_SERIES_STYLE) =>
  resolveCrosshair(f, pointer, { ...DEFAULT_CROSSHAIR_STYLE, mode }, series);

test('crosshair preferences validate independently and malformed documents recover safely', () => {
  const value = { ...DEFAULT_CROSSHAIR_STYLE, mode: 'magnetOHLC', width: 3, lineStyle: 'dotted', horizontal: false };
  assert.deepEqual(readCrosshairStyle(JSON.stringify(value)), value);
  for (const text of [null, '', '{', '[]', 'false', '{}', '{"version":2}']) {
    assert.deepEqual(readCrosshairStyle(text), DEFAULT_CROSSHAIR_STYLE);
  }
  assert.deepEqual(parseCrosshairStyle({ version: 1, mode: 'unsupported', color: '#ABCDEF', width: 4,
    lineStyle: 'bad', vertical: false, horizontal: 'false', extra: 10 }),
  { ...DEFAULT_CROSSHAIR_STYLE, color: '#abcdef', vertical: false });
  for (const width of [1, 2, 3]) assert.equal(parseCrosshairStyle({ version: 1, width }).width, width);
  const copy = readCrosshairStyle(null); copy.color = '#000000';
  assert.equal(DEFAULT_CROSSHAIR_STYLE.color, '#787b86');
});

test('free movement retains pointer coordinates while close magnet uses projected close and exact source price', () => {
  const f = frame();
  assert.deepEqual(resolve(f, { x: 12, y: 70 }, 'normal'), { x: 12, y: 70, index: 0, time: 1700000000000 });
  assert.deepEqual(resolve(f, { x: 12, y: 70 }), { x: 10.5, y: 50, index: 0, time: 1700000000000, rawPrice: 160 });
  assert.equal(resolveCrosshair(f, { x: 12, y: 70 }, { ...DEFAULT_CROSSHAIR_STYLE, mode: 'magnet' }, DEFAULT_SERIES_STYLE, 2).x, 10.25);
  assert.equal(resolve(f, { x: 12, y: 70 }, 'hidden'), null);
  assert.equal(resolve(f, null), null);
});

test('default crosshair moves vertically within rising and falling candles; explicit close magnets never use body tops', () => {
  const f = frame();
  assert.equal(DEFAULT_CROSSHAIR_STYLE.mode, 'normal');
  for (const falling of [false, true]) {
    f.rows[2] = falling ? 180 : 120;
    f.rows[10] = falling ? 30 : 90;
    for (const y of [35, 55, 85]) {
      const cursor = resolveCrosshair(f, { x: 12, y }, DEFAULT_CROSSHAIR_STYLE, DEFAULT_SERIES_STYLE);
      assert.equal(cursor.y, y);
      assert.equal(cursor.index, 0);
      assert.equal(cursor.rawPrice, undefined);
      const snapped = resolve(f, { x: 12, y }, 'magnet');
      assert.equal(snapped.y, 50);
      assert.equal(snapped.rawPrice, 160);
    }
  }
  assert.equal(readCrosshairStyle(JSON.stringify({ ...DEFAULT_CROSSHAIR_STYLE, mode: 'magnet' })).mode, 'magnet');
});

test('OHLC magnet picks the nearest projected value in either price orientation; close-only series retain close', () => {
  const f = frame();
  assert.equal(resolve(f, { x: 12, y: 86 }, 'magnetOHLC').rawPrice, 120);
  f.rows[10] = 30; f.rows[11] = 90; f.rows[12] = 20; f.rows[13] = 70;
  for (const type of ['candles', 'hollow', 'bars']) {
    const result = resolve(f, { x: 12, y: 86 }, 'magnetOHLC', { ...DEFAULT_SERIES_STYLE, type });
    assert.equal(result.y, 90); assert.equal(result.rawPrice, 180);
  }
  for (const type of ['line', 'area', 'baseline']) {
    const result = resolve(f, { x: 12, y: 86 }, 'magnetOHLC', { ...DEFAULT_SERIES_STYLE, type });
    assert.equal(result.y, 70); assert.equal(result.rawPrice, 160); assert.equal(result.x, 10);
  }
});

test('volume magnets never report a price, and pane gaps retain only horizontal position metadata', () => {
  const f = frame();
  for (const mode of ['magnet', 'magnetOHLC']) {
    const result = resolve(f, { x: 12, y: 158 }, mode);
    assert.equal(result.y, 141); assert.equal(result.rawVolume, 300);
    assert.equal(Object.hasOwn(result, 'rawPrice'), false);
  }
  const gap = resolve(f, { x: 12, y: 117 });
  assert.equal(gap.y, 117);
  assert.equal(Object.hasOwn(gap, 'rawPrice'), false);
  assert.equal(Object.hasOwn(gap, 'rawVolume'), false);
  f.meta[5] = f.meta[6] = 180;
  assert.equal(Object.hasOwn(resolve(f, { x: 12, y: 158 }), 'rawVolume'), false);
});

test('future whitespace and empty frames preserve free crosshairs without fabricating bars or time', () => {
  const f = frame();
  assert.equal(resolve(f, { x: 20, y: 75 }).index, 1, 'A shared slot edge belongs to the following bar');
  assert.deepEqual(resolve(f, { x: 60, y: 75 }), { x: 60, y: 75, index: null });
  for (const mode of ['normal', 'magnet', 'magnetOHLC']) {
    assert.deepEqual(resolve(f, { x: 100, y: 75 }, mode), { x: 100, y: 75, index: null });
  }
  f.rows = new Float64Array();
  assert.deepEqual(resolve(f, { x: 20, y: 75 }), { x: 20, y: 75, index: null });
  for (const pointer of [{ x: -1, y: 40 }, { x: 200, y: 40 }, { x: 20, y: -1 }, { x: 20, y: 181 }, { x: NaN, y: 40 }]) {
    assert.equal(resolve(f, pointer), null);
  }
});

test('offscreen price and volume values cannot pull a crosshair into another pane', () => {
  const f = frame(); f.rows[13] = 140; f.rows[14] = 80;
  const price = resolve(f, { x: 12, y: 100 });
  assert.equal(price.y, 100); assert.equal(Object.hasOwn(price, 'rawPrice'), false);
  const volume = resolve(f, { x: 12, y: 150 });
  assert.equal(volume.y, 150); assert.equal(Object.hasOwn(volume, 'rawVolume'), false);
});

test('oscillator magnets use only available values in the pointed pane', () => {
  const f = frame(); f.meta[12] = 360;
  f.panes = [
    { id: 2, top: 180, bottom: 260, contentTop: 200, contentBottom: 250, min: 0, max: 100 },
    { id: 3, top: 260, bottom: 360, contentTop: 280, contentBottom: 350, min: -10, max: 10 },
  ];
  f.oscillators = new Float64Array([
    70, 3, 2, 1, 215, 300, 310, 325,
    NaN, 4, NaN, NaN, NaN, 290, NaN, NaN,
    80, 7, 3, 4, 210, 180, 310, 295,
  ]);
  for (const mode of ['magnet', 'magnetOHLC']) {
    const rsi = resolve(f, { x: 12, y: 230 }, mode);
    assert.equal(rsi.y, 215); assert.equal(rsi.rawOscillator, 70);
    const signal = resolve(f, { x: 12, y: 312 }, mode);
    assert.equal(signal.y, 310); assert.equal(signal.rawOscillator, 2);
    const histogram = resolve(f, { x: 12, y: 340 }, mode);
    assert.equal(histogram.y, 325); assert.equal(histogram.rawOscillator, 1);
    assert.equal(Object.hasOwn(signal, 'rawPrice'), false);
    assert.equal(Object.hasOwn(signal, 'rawVolume'), false);
  }
  assert.equal(resolve(f, { x: 32, y: 230 }).y, 230, 'RSI warm-up does not invent a value');
  assert.equal(resolve(f, { x: 32, y: 340 }).rawOscillator, 4, 'MACD can precede its signal seed');
  assert.equal(resolve(f, { x: 52, y: 281 }).rawOscillator, 4, 'A clipped line cannot pull the cursor out of the pane');
  assert.equal(resolve(f, { x: 12, y: 270 }).rawOscillator, undefined, 'Pane header is not data');
  assert.deepEqual(resolve(f, { x: 100, y: 320 }), { x: 100, y: 320, index: null });
});
