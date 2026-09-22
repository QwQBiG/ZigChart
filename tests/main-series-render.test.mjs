import test from 'node:test';
import assert from 'node:assert/strict';
import { drawMainSeries, mainSeriesBarWidth, mainSeriesOhlcHalfWidth, mainSeriesX } from '../web/src/chart/rendering/main-series.ts';
import { DEFAULT_APPEARANCE } from '../web/src/features/appearance/model.ts';
import { DEFAULT_SERIES_STYLE } from '../web/src/features/series/model.ts';
import { resolveBaseline } from '../web/src/features/series/baseline.ts';

function frame() {
  const meta = new Float64Array(13);
  meta[3] = 10; meta[4] = 150; meta[7] = 14; meta[11] = 200;
  const rows = new Float64Array(34);
  rows.set([0, 0, 10, 25, 5, 20, 0, 0, 0, 23.3, 80, 20, 120, 40, 0, 0, 0]);
  rows.set([1, 1, 25, 30, 10, 15, 0, 0, 0, 60.7, 30, 15, 100, 70, 0, 0, 0], 17);
  return { rows, meta };
}

function recording() {
  const operations = [];
  let path = [];
  const ctx = {
    save() { operations.push({ type: 'save' }); },
    restore() { operations.push({ type: 'restore' }); },
    beginPath() { path = []; },
    moveTo(...args) { path.push(['move', ...args]); },
    lineTo(...args) { path.push(['line', ...args]); },
    rect(...args) { path.push(['rect', ...args]); },
    arc(...args) { path.push(['arc', ...args]); },
    closePath() { path.push(['close']); },
    clip() { operations.push({ type: 'clip', path: path.slice() }); },
    setLineDash(dash) { assert.deepEqual(dash, []); },
    fill() { operations.push({ type: 'fill', path: path.slice(), color: this.fillStyle }); },
    stroke() { operations.push({ type: 'stroke', path: path.slice(), color: this.strokeStyle, width: this.lineWidth }); },
    createLinearGradient(...args) {
      const gradient = { stops: [], addColorStop(...stop) { this.stops.push(stop); } };
      operations.push({ type: 'gradient', args, gradient });
      return gradient;
    },
  };
  return { ctx, operations };
}

test('baseline halves use opposite clipping and colors under inversion without filling future slots', () => {
  for (const inverted of [false, true]) {
    const f = frame();
    const style = { ...DEFAULT_SERIES_STYLE, type: 'baseline', lineType: 'step' };
    const { ctx, operations } = recording();
    drawMainSeries(ctx, f, DEFAULT_APPEARANCE, style, 2, { price: 17, y: 55, inverted });
    const clips = operations.filter(op => op.type === 'clip');
    assert.deepEqual(clips.slice(1).map(op => op.path[0]), inverted
      ? [['rect', 0, 55, 200, 95], ['rect', 0, 10, 200, 45]]
      : [['rect', 0, 10, 200, 45], ['rect', 0, 55, 200, 95]]);
    assert.deepEqual(operations.filter(op => op.type === 'stroke').map(op => op.color),
      [style.baselineAboveColor, style.baselineBelowColor]);
    for (const op of operations.filter(op => op.type === 'fill')) {
      assert.deepEqual(op.path.slice(-3), [['line', 60.7, 55], ['line', 23.3, 55], ['close']]);
    }
    assert.deepEqual(operations.find(op => op.type === 'stroke').path,
      [['move', 23.3, 40], ['line', 60.7, 40], ['line', 60.7, 70]]);
  }
});

test('baseline reference uses a visible close or core projection; nonpositive log bases stay below valid prices', () => {
  const f = frame(); f.meta[0] = 5; f.meta[1] = 30;
  f.rows[9] = -1;
  const style = { ...DEFAULT_SERIES_STYLE, type: 'baseline' };
  assert.deepEqual(resolveBaseline(f, style, price => price * 2), { price: 15, y: 30, inverted: false });
  for (const inverted of [false, true]) {
    f.priceAxis = { requestedMode: 1, effectiveMode: 1, base: 1, inverted };
    const fixed = { ...style, baselineSource: 'price', baselinePrice: 0 };
    assert.deepEqual(resolveBaseline(f, fixed, () => NaN), { price: 0, y: inverted ? 10 : 150, inverted });
  }
  assert.equal(resolveBaseline({ ...f, rows: new Float64Array() }, style, () => 10), null);
});

test('a single baseline observation uses its raw side and never draws an invented segment', () => {
  const f = frame(); f.rows = f.rows.slice(0, 17);
  const style = { ...DEFAULT_SERIES_STYLE, type: 'baseline' };
  const { ctx, operations } = recording();
  drawMainSeries(ctx, f, DEFAULT_APPEARANCE, style, 2, { price: 25, y: 15, inverted: true });
  assert.equal(operations.filter(op => op.type === 'stroke').length, 0);
  assert.equal(operations.find(op => op.type === 'fill').color, style.baselineBelowColor);
});

test('candle body, border and wick use independent colors and physical-pixel geometry', () => {
  const f = frame();
  const before = f.rows.slice();
  const { ctx, operations } = recording();
  const appearance = { ...DEFAULT_APPEARANCE, upColor: '#abcdef', borderUpColor: '#010203', wickUpColor: '#123456' };
  drawMainSeries(ctx, f, appearance, DEFAULT_SERIES_STYLE, 1.25);
  assert.deepEqual(operations[1], { type: 'clip', path: [['rect', 0, 10, 200, 140]] });
  const body = operations.find(op => op.type === 'fill' && op.color === appearance.upColor);
  assert.equal(body.path[0][3], 14);
  assert.equal(body.path[0][1] + 7, mainSeriesX(23.3, 1.25));
  assert.ok(operations.some(op => op.type === 'stroke' && op.color === appearance.borderUpColor));
  assert.ok(operations.some(op => op.type === 'stroke' && op.color === appearance.wickUpColor && op.width === 0.8));
  assert.equal(operations.at(-1).type, 'restore');
  assert.deepEqual(f.rows, before);
  assert.equal(mainSeriesBarWidth(f, 2), 14);
});

test('hollow rises retain a background body; hiding every candle component draws no series', () => {
  const f = frame();
  const first = recording();
  drawMainSeries(first.ctx, f, DEFAULT_APPEARANCE, { ...DEFAULT_SERIES_STYLE, type: 'hollow' }, 2);
  assert.deepEqual(first.operations.filter(op => op.type === 'fill').map(op => op.color),
    [DEFAULT_APPEARANCE.backgroundColor, DEFAULT_APPEARANCE.downColor]);
  const second = recording();
  drawMainSeries(second.ctx, f, { ...DEFAULT_APPEARANCE, showBody: false, showBorder: false, showWick: false }, DEFAULT_SERIES_STYLE);
  assert.equal(second.operations.filter(op => op.type === 'fill' || op.type === 'stroke').length, 0);
});

test('OHLC ticks place open on the left and close on the right, independently of candle visibility', () => {
  const f = frame();
  const { ctx, operations } = recording();
  drawMainSeries(ctx, f, { ...DEFAULT_APPEARANCE, showBody: false, showBorder: false, showWick: false },
    { ...DEFAULT_SERIES_STYLE, type: 'bars' }, 2);
  const x = mainSeriesX(23.3, 2);
  const half = mainSeriesOhlcHalfWidth(f, 2);
  const rising = operations.find(op => op.type === 'stroke' && op.color === DEFAULT_APPEARANCE.upColor);
  assert.deepEqual(rising.path, [['move', x, 20], ['line', x, 120], ['move', x - half, 80],
    ['line', x, 80], ['move', x, 40], ['line', x + half, 40]]);
});

test('close lines use the original projected positions, with optional horizontal-then-vertical steps', () => {
  for (const lineType of ['simple', 'step']) {
    const { ctx, operations } = recording();
    drawMainSeries(ctx, frame(), DEFAULT_APPEARANCE, { ...DEFAULT_SERIES_STYLE, type: 'line', lineType, lineWidth: 3 }, 2);
    const stroke = operations.find(op => op.type === 'stroke');
    assert.deepEqual(stroke.path, lineType === 'simple' ? [['move', 23.3, 40], ['line', 60.7, 70]] :
      [['move', 23.3, 40], ['line', 60.7, 40], ['line', 60.7, 70]]);
    assert.equal(stroke.width, 3);
  }
});

test('area fills stop at the price pane bottom and never extend into future whitespace', () => {
  const { ctx, operations } = recording();
  drawMainSeries(ctx, frame(), DEFAULT_APPEARANCE, { ...DEFAULT_SERIES_STYLE, type: 'area' });
  const fill = operations.find(op => op.type === 'fill');
  assert.deepEqual(fill.path.slice(-3), [['line', 60.7, 150], ['line', 23.3, 150], ['close']]);
  assert.deepEqual(operations.find(op => op.type === 'gradient').gradient.stops,
    [[0, `${DEFAULT_SERIES_STYLE.areaTopColor}66`], [1, `${DEFAULT_SERIES_STYLE.areaBottomColor}0a`]]);
  assert.deepEqual(operations.find(op => op.type === 'gradient').args, [0, 10, 0, 150]);
  assert.equal(operations.filter(op => op.type === 'stroke').length, 1);
  const f = frame(); f.rows = f.rows.slice(0, 17);
  const single = recording();
  drawMainSeries(single.ctx, f, DEFAULT_APPEARANCE, { ...DEFAULT_SERIES_STYLE, type: 'area' });
  const dot = single.operations.find(op => op.type === 'fill');
  assert.equal(dot.color, DEFAULT_SERIES_STYLE.lineColor);
  assert.deepEqual(dot.path, [['arc', 23.3, 40, DEFAULT_SERIES_STYLE.lineWidth / 2, 0, Math.PI * 2]]);
});
