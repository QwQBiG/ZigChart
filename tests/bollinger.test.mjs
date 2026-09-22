import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { createIndicatorState } from '../web/src/features/analysis/model.ts';
import { bollingerValuesAt } from '../web/src/features/analysis/values.ts';
import { drawBollingerFill, drawBollingerLines } from '../web/src/features/analysis/bollinger-render.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = (i, close = 1000 + i * i % 97) => ({ time: (i + 1) * 60_000,
  open: close, high: close + 1, low: close - 1, close, volume: 100 });
const source = (start, count) => Array.from({ length: count }, (_, i) => bar(start + i));

function verify(core, bars, period = 7, multiplier = 2.5) {
  core.setView(0, bars.length);
  const frame = core.frame(1500, 600);
  assert.equal(frame.bollinger.length, frame.rows.length / 17 * 6);
  for (let i = 0; i < bars.length; i++) {
    const actual = bollingerValuesAt(frame, i);
    if (i < period - 1) { assert.ok(Object.values(actual).every(Number.isNaN)); continue; }
    const window = bars.slice(i + 1 - period, i + 1).map(item => item.close);
    const basis = window.reduce((a, b) => a + b, 0) / period;
    const deviation = Math.sqrt(window.reduce((sum, close) => sum + (close - basis) ** 2, 0) / period);
    for (const [column, key, expected] of [[0, 'basis', basis], [1, 'upper', basis + multiplier * deviation], [2, 'lower', basis - multiplier * deviation]]) {
      assert.ok(Math.abs(actual[key] - expected) < 1e-8, `${key} at ${i}`);
      assert.ok(Math.abs(frame.bollinger[i * 6 + column + 3] - core.priceToY(expected, 1500, 600)) < 1e-7);
    }
  }
  assert.equal(bollingerValuesAt(frame, -1), null);
  assert.equal(bollingerValuesAt(frame, bars.length), null);
  return frame;
}

test('Bollinger Wasm batches match independent formulas across updates and copy their memory', async () => {
  const core = await ChartCore.create(bytes);
  let data = source(10, 50);
  core.configureBollinger(7, 2.5, true); core.apply('replace', data); verify(core, data);
  const revised = bar(59, 1800);
  core.apply('upsert', [revised, bar(60)]); data = [...data.slice(0, -1), revised, bar(60)]; verify(core, data);
  const earlier = source(0, 10); core.apply('prepend', earlier); data = [...earlier, ...data];
  const copied = verify(core, data), saved = copied.bollinger.slice();
  data[20] = bar(20, 400); core.apply('correct', [data[20]]); verify(core, data);
  assert.deepEqual(copied.bollinger, saved);
  core.configureBollinger(7, 2.5, false); assert.equal(core.frame(1500, 600).bollinger, undefined);
  core.configureBollinger(7, 2.5, true); verify(core, data);
});

test('bands extend price fitting, trigger honest log fallback and preserve pane/view identity', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', source(0, 80)); core.configureIndicators(20, 20, 4);
  core.configureBollinger(20, 2, true); core.pan(-1); core.maximizePane(0);
  const locked = core.frame(800, 600);
  core.configureBollinger(20, 2, true); assert.deepEqual(core.frame(800, 600), locked);
  for (const args of [[0, 2, true], [501, 2, true], [2.5, 2, true], [20, NaN, true], [20, .01, true], [20, 11, true], [20, 2, 1]]) {
    assert.throws(() => core.configureBollinger(...args), /Invalid Bollinger/);
    assert.deepEqual(core.frame(800, 600), locked);
  }
  core.configureBollinger(10, 3, true);
  const changed = core.frame(800, 600);
  assert.equal(core.maximizedPane, 0);
  assert.deepEqual(changed.meta.slice(8), locked.meta.slice(8));
  core.maximizePane(-1); core.configureBollinger(20, 10, false);
  core.apply('replace', Array.from({ length: 80 }, (_, i) => bar(i, i === 79 ? 100000 : 100)));
  core.setView(60, 20); core.configurePriceScale('logarithmic', false);
  assert.equal(core.frame(800, 600).priceAxis.effectiveMode, 1);
  core.configureBollinger(20, 10, true);
  const bands = core.frame(800, 600);
  assert.equal(bands.priceAxis.effectiveMode, 0);
  assert.ok(bands.meta[0] < 0 && bands.meta[1] > 100000);
  assert.deepEqual(bands.panes.map(pane => pane.id), [0, 1]);
});

test('band drawing separates gaps, uses copied coordinates and isolates opacity', () => {
  const frame = { rows: new Float64Array(5 * 17), meta: new Float64Array(13), bollinger: new Float64Array(5 * 6) };
  frame.meta[4] = 200;
  for (let i = 0; i < 5; i++) {
    frame.rows[i * 17] = i; frame.rows[i * 17 + 9] = 10 + i * 20;
    frame.bollinger.set(i === 2 ? Array(6).fill(NaN) : [100, 110, 90, 80 + i, 60 + i, 100 + i], i * 6);
  }
  const style = { ...createIndicatorState().bb, enabled: true }, ops = [], stack = [];
  let path = [];
  const ctx = { globalAlpha: 1, save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    beginPath() { path = []; }, moveTo(...p) { path.push(['move', ...p]); }, lineTo(...p) { path.push(['line', ...p]); },
    closePath() {}, setLineDash() {}, fill() { ops.push({ kind: 'fill', alpha: this.globalAlpha, path: path.slice() }); },
    stroke() { ops.push({ kind: 'stroke', color: this.strokeStyle, path: path.slice() }); } };
  drawBollingerFill(ctx, frame, style); drawBollingerLines(ctx, frame, style);
  const fills = ops.filter(op => op.kind === 'fill'), lines = ops.filter(op => op.kind === 'stroke');
  assert.equal(fills.length, 2); assert.equal(lines.length, 3); assert.equal(ctx.globalAlpha, 1);
  assert.equal(fills[0].alpha, .12);
  assert.deepEqual(fills[0].path, [['move', 10, 60], ['line', 30, 61], ['line', 30, 101], ['line', 10, 100]]);
  assert.equal(lines[0].path.filter(item => item[0] === 'move').length, 2);
  for (const op of ops) for (const command of op.path) assert.ok(command.slice(1).every(Number.isFinite));
  ops.length = 0; drawBollingerFill(ctx, frame, { ...style, showFill: false }); assert.equal(ops.length, 0);
  drawBollingerLines(ctx, frame, { ...style, enabled: false }); assert.equal(ops.length, 0);
  frame.meta[4] = 0; drawBollingerFill(ctx, frame, style); drawBollingerLines(ctx, frame, style); assert.equal(ops.length, 0);
});
