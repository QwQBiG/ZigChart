import test from 'node:test';
import assert from 'node:assert/strict';
import { drawOscillatorPanes, drawVolumePane } from '../web/src/features/analysis/render.ts';
import { createIndicatorState } from '../web/src/features/analysis/model.ts';
import { oscillatorValuesAt, formatOscillator } from '../web/src/features/analysis/values.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

function frame() {
  const rows = new Float64Array(3 * 17);
  for (let i = 0; i < 3; i++) rows.set([10 + i, i, 100, 120, 80, 110, 40, NaN, NaN,
    10.2 + i * 20, 25, 20, 50, 30, 135, NaN, NaN], i * 17);
  return { rows, meta: new Float64Array([80, 120, 50, 10, 100, 120, 160, 12, 10, 10, 13, 200, 400]),
    panes: [{ id: 2, top: 160, bottom: 270, contentTop: 180, contentBottom: 260, min: 0, max: 100 },
      { id: 3, top: 270, bottom: 400, contentTop: 290, contentBottom: 390, min: -10, max: 10 }],
    oscillators: new Float64Array([NaN, 2, NaN, NaN, NaN, 330, NaN, NaN,
      60, 3, 1, 2, 212, 325, 335, 330, 40, -2, 1, -3, 228, 350, 335, 355]) };
}
function recording() {
  const ops = []; let path = [];
  const ctx = { save() {}, restore() {}, beginPath() { path = []; },
    moveTo(...args) { path.push(['move', ...args]); }, lineTo(...args) { path.push(['line', ...args]); },
    rect(...args) { path.push(['rect', ...args]); }, fillRect(...args) { ops.push({ kind: 'rect', args }); },
    clip() { ops.push({ kind: 'clip', path: path.slice() }); }, setLineDash() {},
    fill() { ops.push({ kind: 'fill', color: this.fillStyle, path: path.slice() }); },
    stroke() { ops.push({ kind: 'stroke', color: this.strokeStyle, path: path.slice() }); } };
  return { ctx, ops };
}
test('oscillator render clips each pane, omits warm-up, and aligns histogram and volume centers', () => {
  const f = frame(), state = createIndicatorState(), { ctx, ops } = recording();
  state.rsi.enabled = state.macd.enabled = state.volume.enabled = true;
  state.rsi.showLevels = false;
  drawOscillatorPanes(ctx, f, state, 2, () => 340);
  drawVolumePane(ctx, f, state.volume, 2);
  const clips = ops.filter(op => op.kind === 'clip');
  assert.deepEqual(clips.map(op => op.path[0]), [['rect', 0, 180, 200, 80], ['rect', 0, 290, 200, 100], ['rect', 0, 120, 200, 40]]);
  const rsi = ops.find(op => op.kind === 'stroke' && op.color === state.rsi.color);
  assert.deepEqual(rsi.path, [['move', 30.2, 212], ['line', 50.2, 228]]);
  const positive = ops.find(op => op.kind === 'fill' && op.color === state.macd.positiveColor);
  const negative = ops.find(op => op.kind === 'fill' && op.color === state.macd.negativeColor);
  assert.deepEqual(positive.path, [['rect', 24.25, 330, 12, 10]]);
  assert.deepEqual(negative.path, [['rect', 44.25, 340, 12, 15]]);
  const volume = ops.findLast(op => op.kind === 'fill' && op.color === state.volume.upColor);
  assert.equal(volume.path[1][1], positive.path[0][1]);
  for (const op of ops) for (const command of op.path ?? []) for (const value of command.slice(1)) assert.ok(Number.isFinite(value));
  const hidden = recording();
  drawOscillatorPanes(hidden.ctx, f, createIndicatorState(), 1, () => 340);
  assert.equal(hidden.ops.some(op => op.kind === 'stroke' || op.kind === 'fill'), false);
});

test('readouts preserve row alignment, unavailable values and fractional oscillator units', () => {
  const f = frame(); setLocale('en');
  assert.equal(oscillatorValuesAt(f, 9), null); assert.equal(oscillatorValuesAt(f, 13), null);
  assert.equal(oscillatorValuesAt(f, 10.5), null); assert.equal(oscillatorValuesAt(null, 10), null);
  assert.ok(Number.isNaN(oscillatorValuesAt(f, 10).rsi));
  assert.deepEqual(oscillatorValuesAt(f, 12), { rsi: 40, macd: -2, signal: 1, histogram: -3 });
  assert.equal(formatOscillator(62.375, 2, 100), '62.38');
  assert.equal(formatOscillator(12.345, 3, 100), '0.1235');
  assert.equal(formatOscillator(-0.00001, 3, 100), '0.00');
  assert.equal(formatOscillator(NaN, 2, 100), '—');
});
