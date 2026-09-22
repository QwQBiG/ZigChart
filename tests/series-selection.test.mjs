import test from 'node:test';
import assert from 'node:assert/strict';
import { hitCandle, hitMainSeries, hitSeriesHandle, drawSeriesSelection } from '../web/src/features/series/selection.ts';
import { DEFAULT_APPEARANCE } from '../web/src/features/appearance/model.ts';
import { DEFAULT_SERIES_STYLE } from '../web/src/features/series/model.ts';

function frame(bars = [{ index: 0, x: 20.2, open: 30, close: 50, high: 20, low: 70 }], width = 8) {
  const meta = new Float64Array(13);
  meta[3] = 10; meta[4] = 150; meta[7] = width; meta[11] = 200;
  const rows = new Float64Array(bars.length * 17);
  bars.forEach((bar, i) => {
    const offset = i * 17;
    rows[offset] = bar.index; rows[offset + 9] = bar.x;
    rows[offset + 10] = bar.open; rows[offset + 13] = bar.close;
    rows[offset + 11] = bar.high; rows[offset + 12] = bar.low;
  });
  return { rows, meta };
}

test('body and wick select the series, but only the body midpoint is a settings handle', () => {
  const f = frame();
  assert.equal(hitCandle(f, { x: 23.5, y: 40 }), 0);
  assert.equal(hitCandle(f, { x: 20.5, y: 65 }), 0);
  assert.equal(hitSeriesHandle(f, { x: 20.5, y: 40 }), 0);
  assert.equal(hitSeriesHandle(f, { x: 20.5, y: 65 }), null);
  assert.equal(hitCandle(f, { x: 26, y: 65 }), null);
  assert.equal(hitCandle(f, { x: 180, y: 40 }), null);
  assert.equal(hitSeriesHandle(f, { x: 180, y: 40 }), null);
});

test('the price pane clips hit tolerance, and offscreen centers do not create handles', () => {
  const f = frame([
    { index: 1, x: -1.6, open: 30, close: 50, high: 20, low: 70 },
    { index: 2, x: 198, open: 140, close: 160, high: 130, low: 170 },
    { index: 3, x: 30, open: 0, close: 10, high: -10, low: 25 },
  ]);
  assert.equal(hitCandle(f, { x: 0, y: 40 }), 1);
  assert.equal(hitSeriesHandle(f, { x: 0, y: 40 }), null);
  assert.equal(hitSeriesHandle(f, { x: 198.5, y: 150 }), 2);
  for (const point of [{ x: -1, y: 40 }, { x: 200, y: 150 }, { x: 198, y: 151 }, { x: 30.5, y: 9 }]) {
    assert.equal(hitCandle(f, point), null);
    assert.equal(hitSeriesHandle(f, point), null);
  }
  assert.equal(hitSeriesHandle(f, { x: 30.5, y: 10 }), null);
});

test('doji and dense views retain distinct nearest handles using snapped candle centers', () => {
  const f = frame([
    { index: 40, x: 20.2, open: 40, close: 40, high: 30, low: 50 },
    { index: 41, x: 26.2, open: 40, close: 40, high: 30, low: 50 },
  ], 4);
  assert.equal(hitCandle(f, { x: 21.5, y: 41 }), 40);
  assert.equal(hitSeriesHandle(f, { x: 21, y: 40 }), 40);
  assert.equal(hitSeriesHandle(f, { x: 24.8, y: 40 }), 41);
});

test('hit geometry respects hidden components and the rendered body width limits', () => {
  const f = frame();
  assert.equal(hitCandle(f, { x: 23.5, y: 40 }, { body: false, border: false }), null);
  assert.equal(hitCandle(f, { x: 20.5, y: 65 }, { wick: false }), null);
  assert.equal(hitCandle(f, { x: 20.5, y: 40 }, { body: false, border: false, wick: false }), null);
  assert.equal(hitCandle(f, { x: 24.5, y: 40 }, { body: false, wick: false }), 0);
  const bodyOnly = { border: false, wick: false };
  f.meta[7] = 100;
  assert.equal(hitCandle(f, { x: 30.5, y: 40 }, bodyOnly), 0);
  assert.equal(hitCandle(f, { x: 31, y: 40 }, bodyOnly), null);
  f.meta[7] = 0.1;
  assert.equal(hitCandle(f, { x: 20.9, y: 40 }, bodyOnly), 0);
  assert.equal(hitCandle(f, { x: 21.1, y: 40 }, bodyOnly), null);
});

test('selection drawing clips all visible centers in one path and restores canvas state', () => {
  const calls = [];
  const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'setLineDash', 'moveTo', 'arc', 'fill', 'stroke']
    .map(name => [name, (...args) => calls.push([name, ...args])]));
  const f = frame([
    { index: 0, x: 20.2, open: 30, close: 50, high: 20, low: 70 },
    { index: 1, x: -1.6, open: 30, close: 50, high: 20, low: 70 },
    { index: 2, x: 198, open: 140, close: 160, high: 130, low: 170 },
  ]);
  drawSeriesSelection(ctx, f, '#4466ff', '#000000');
  assert.deepEqual(calls.filter(c => c[0] === 'arc').map(c => c.slice(1, 4)), [[20.5, 40, 4], [198.5, 150, 4]]);
  assert.deepEqual(calls.find(c => c[0] === 'rect'), ['rect', 0, 10, 200, 140]);
  assert.equal(calls[0][0], 'save');
  assert.equal(calls.at(-1)[0], 'restore');
  assert.equal(ctx.strokeStyle, '#4466ff');
});

test('hollow bodies do not select erased interiors when their border is hidden', () => {
  const f = frame();
  const hidden = { hollowRising: true, border: false, wick: false };
  assert.equal(hitCandle(f, { x: 20.5, y: 40 }, hidden), null);
  assert.equal(hitCandle(f, { x: 20.5, y: 40 }, { ...hidden, wick: true }), null);
  assert.equal(hitCandle(f, { x: 20.5, y: 65 }, { ...hidden, wick: true }), 0);
  f.rows[2] = 200; f.rows[5] = 100;
  assert.equal(hitCandle(f, { x: 20.5, y: 40 }, hidden), 0);
});

test('main candle hits use the actual width and DPR, while hollow interiors stay empty', () => {
  const f = frame(undefined, 40);
  const bodyOnly = { ...DEFAULT_APPEARANCE, showBorder: false, showWick: false };
  assert.equal(hitMainSeries(f, { x: 38, y: 40 }, bodyOnly, DEFAULT_SERIES_STYLE, 2), 0);
  assert.equal(hitMainSeries(f, { x: 41, y: 40 }, bodyOnly, DEFAULT_SERIES_STYLE, 2), null);
  f.meta[7] = .1;
  assert.equal(hitMainSeries(f, { x: 20.49, y: 40 }, bodyOnly, DEFAULT_SERIES_STYLE, 2), 0);
  assert.equal(hitMainSeries(f, { x: 20.6, y: 40 }, bodyOnly, DEFAULT_SERIES_STYLE, 2), null);
  f.meta[7] = 8;
  const hollow = { ...DEFAULT_SERIES_STYLE, type: 'hollow' };
  assert.equal(hitMainSeries(f, { x: 20.5, y: 40 }, DEFAULT_APPEARANCE, hollow), null);
  assert.equal(hitMainSeries(f, { x: 24.5, y: 40 }, DEFAULT_APPEARANCE, hollow), 0);
  assert.equal(hitMainSeries(f, { x: 20.5, y: 65 }, DEFAULT_APPEARANCE, hollow), 0);
  f.rows[2] = 200; f.rows[5] = 100;
  assert.equal(hitMainSeries(f, { x: 20.5, y: 40 }, bodyOnly, hollow), 0);
});

test('OHLC hits match left open and right close ticks independently of candle visibility', () => {
  const f = frame();
  const hidden = { ...DEFAULT_APPEARANCE, showBody: false, showBorder: false, showWick: false };
  const bars = { ...DEFAULT_SERIES_STYLE, type: 'bars' };
  assert.equal(hitMainSeries(f, { x: 16.25, y: 30 }, hidden, bars, 2), 0);
  assert.equal(hitMainSeries(f, { x: 24.25, y: 50 }, hidden, bars, 2), 0);
  assert.equal(hitMainSeries(f, { x: 20.25, y: 65 }, hidden, bars, 2), 0);
  assert.equal(hitMainSeries(f, { x: 24.25, y: 30 }, hidden, bars, 2), null);
});

test('straight and stepped close paths and area fills are selectable only in the price pane', () => {
  const f = frame([
    { index: 2, x: 20, open: 30, close: 50, high: 20, low: 70 },
    { index: 3, x: 100, open: 70, close: 110, high: 60, low: 130 },
  ]);
  const line = { ...DEFAULT_SERIES_STYLE, type: 'line' };
  const step = { ...line, lineType: 'step' };
  const area = { ...line, type: 'area' };
  assert.equal(hitMainSeries(f, { x: 60, y: 80 }, DEFAULT_APPEARANCE, line), 2);
  assert.equal(hitMainSeries(f, { x: 60, y: 50 }, DEFAULT_APPEARANCE, line), null);
  assert.equal(hitMainSeries(f, { x: 60, y: 50 }, DEFAULT_APPEARANCE, step), 2);
  assert.equal(hitMainSeries(f, { x: 100, y: 80 }, DEFAULT_APPEARANCE, step), 3);
  assert.equal(hitMainSeries(f, { x: 60, y: 80 }, DEFAULT_APPEARANCE, step), null);
  assert.equal(hitMainSeries(f, { x: 60, y: 120 }, DEFAULT_APPEARANCE, area), 2);
  assert.equal(hitMainSeries(f, { x: 60, y: 40 }, DEFAULT_APPEARANCE, area), null);
  assert.equal(hitMainSeries(f, { x: 60, y: 70 }, DEFAULT_APPEARANCE, { ...area, lineType: 'step' }), 2);
  const baseline = { ...line, type: 'baseline' };
  assert.equal(hitMainSeries(f, { x: 60, y: 70 }, DEFAULT_APPEARANCE, baseline, 1, 60), 2);
  assert.equal(hitMainSeries(f, { x: 60, y: 95 }, DEFAULT_APPEARANCE, baseline, 1, 100), 2);
  assert.equal(hitMainSeries(f, { x: 60, y: 120 }, DEFAULT_APPEARANCE, baseline, 1, 100), null);
  for (const type of ['line', 'area', 'baseline']) {
    assert.equal(hitMainSeries(frame(), { x: 20.2, y: 50 }, DEFAULT_APPEARANCE, { ...line, type }, 2), 0);
    assert.equal(hitMainSeries(frame(), { x: 27, y: 50 }, DEFAULT_APPEARANCE, { ...line, type }, 2), null);
  }
  for (const type of ['candles', 'hollow', 'bars', 'line', 'area', 'baseline']) {
    for (const point of [{ x: -1, y: 50 }, { x: 200, y: 50 }, { x: 20, y: 9 }, { x: 60, y: 151 }]) {
      assert.equal(hitMainSeries(f, point, DEFAULT_APPEARANCE, { ...line, type }), null, `${type}: ${JSON.stringify(point)}`);
    }
  }
});

test('line and area handles use close coordinates while candle handles use pixel-aligned body centers', () => {
  const f = frame();
  for (const type of ['line', 'area', 'baseline']) {
    const style = { ...DEFAULT_SERIES_STYLE, type };
    assert.equal(hitSeriesHandle(f, { x: 20.2, y: 50 }, style, 2), 0);
    assert.equal(hitSeriesHandle(f, { x: 20.2, y: 40 }, style, 2), null);
    const arcs = [];
    const ctx = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'setLineDash', 'moveTo', 'fill', 'stroke']
      .map(name => [name, () => {}]));
    ctx.arc = (...args) => arcs.push(args);
    drawSeriesSelection(ctx, f, '#4466ff', '#000000', style, 2);
    assert.deepEqual(arcs[0].slice(0, 2), [20.2, 50]);
  }
  assert.equal(hitSeriesHandle(f, { x: 20.25, y: 40 }, DEFAULT_SERIES_STYLE, 2), 0);
});
