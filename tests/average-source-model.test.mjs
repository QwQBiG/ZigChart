import test from 'node:test';
import assert from 'node:assert/strict';
import { INDICATOR_SOURCES, indicatorSourceCode } from '../web/src/chart/indicator-source.ts';
import { addAverage, createIndicatorState, parseIndicatorState, setIndicatorEnabled, updateStudy } from '../web/src/features/analysis/model.ts';
import { indicatorTitle } from '../web/src/features/analysis/catalog.ts';
import { averageLabel, sourceOptionLabel } from '../web/src/features/analysis/sources.ts';

test('versions one through five migrate all average sources to close without changing supported studies', () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const original = createIndicatorState();
    original.ma = { ...original.ma, enabled: true, period: 9, color: '#112233', source: 'open' };
    original.ema = { ...original.ema, enabled: true, period: 35, source: 'ohlc4' };
    original.averages = [{ ...original.ma, id: 'average-4', kind: 'ma', source: 'high' }];
    original.bb.enabled = original.dc.enabled = original.rsi.enabled = true;
    const legacy = { ...original, version };
    const migrated = parseIndicatorState(legacy);
    assert.equal(migrated.version, 6);
    assert.deepEqual(migrated.ma, { ...original.ma, source: 'close' });
    assert.deepEqual(migrated.ema, { ...original.ema, source: 'close' });
    assert.deepEqual(migrated.averages, version >= 3 ? [{ ...original.averages[0], source: 'close' }] : []);
    assert.deepEqual(migrated.bb, version >= 4 ? original.bb : createIndicatorState().bb);
    assert.deepEqual(migrated.dc, version >= 5 ? original.dc : createIndicatorState().dc);
    assert.deepEqual(migrated.rsi, version >= 2 ? original.rsi : createIndicatorState().rsi);
    assert.equal(Object.hasOwn(migrated.rsi, 'source'), false);
    assert.equal(original.ma.source, 'open');
    delete legacy.ma.source; delete legacy.ema.source;
    assert.equal(parseIndicatorState(legacy).ma.source, 'close');
  }
});

test('version six requires a known source even for disabled averages and rejects the whole invalid document', () => {
  for (const source of [undefined, null, '', 'Close', 'hlcc3', 0, false, {}, ['close']]) {
    for (const id of ['ma', 'ema']) {
      const state = createIndicatorState(); state[id].source = source;
      assert.equal(parseIndicatorState(state), null, `${id}: ${String(source)}`);
    }
    let state = addAverage(addAverage(createIndicatorState(), 'ma'), 'ma');
    state.averages[0].source = source;
    assert.equal(parseIndicatorState(state), null);
    assert.equal(indicatorSourceCode(source), null);
  }
  INDICATOR_SOURCES.forEach((source, code) => {
    const state = updateStudy(createIndicatorState(), 'ma', { source });
    assert.equal(state.ma.source, source); assert.equal(indicatorSourceCode(source), code);
    assert.deepEqual(parseIndicatorState(JSON.parse(JSON.stringify(state))), state);
  });
});

test('each average owns its source, new instances copy it and built-ins retain it when removed', () => {
  let state = updateStudy(createIndicatorState(), 'ema', { enabled: true, source: 'hlc3', period: 37, color: '#abcdef', width: 4 });
  state = addAverage(state, 'ema');
  assert.deepEqual(state.averages[0], { ...state.ema, id: 'average-1', kind: 'ema' });
  const changed = updateStudy(state, 'average-1', { source: 'low' });
  assert.deepEqual(changed.averages[0], { ...state.averages[0], source: 'low' });
  assert.deepEqual(changed.ema, state.ema); assert.deepEqual(changed.ma, state.ma);
  assert.deepEqual(changed.rsi, state.rsi); assert.deepEqual(changed.dc, state.dc);
  assert.equal(state.averages[0].source, 'hlc3');
  const removed = setIndicatorEnabled(changed, 'ema', false);
  assert.deepEqual(removed.ema, { ...changed.ema, enabled: false });
  assert.deepEqual(setIndicatorEnabled(removed, 'ema', true), changed);
  let full = changed;
  for (let i = 1; i < 6; i++) full = addAverage(full, 'ema');
  full.averages.forEach((item, index) => { item.source = INDICATOR_SOURCES[index + 1]; });
  assert.deepEqual(parseIndicatorState(JSON.parse(JSON.stringify(full))), full);
  const deleted = setIndicatorEnabled(full, 'average-3', false);
  assert.deepEqual(deleted.averages, full.averages.filter(item => item.id !== 'average-3'));
});

test('shared display labels identify sources and instance slots in both languages', () => {
  let state = addAverage(addAverage(createIndicatorState(), 'ma'), 'ma');
  state = updateStudy(state, 'average-1', { period: 9, source: 'hlcc4' });
  assert.equal(averageLabel('ma', state.ma, 'en'), 'MA 20 · Close');
  assert.equal(averageLabel('ma', state.ma, 'zh-CN'), 'MA 20 · 收盘');
  for (const locale of ['en', 'zh-CN']) {
    assert.match(indicatorTitle('average-1', state, locale), /MA 9 · HLCC4 · #1$/);
    assert.match(sourceOptionLabel('hlcc4', locale), /2 × .*\) \/ 4$/);
    assert.equal(new Set(INDICATOR_SOURCES.map(source => sourceOptionLabel(source, locale))).size, 8);
  }
  assert.match(sourceOptionLabel('ohlc4', 'en'), /Open \+ High \+ Low \+ Close/);
  assert.match(sourceOptionLabel('hl2', 'zh-CN'), /最高 \+ 最低/);
  assert.match(indicatorTitle('rsi', state, 'en'), /RSI 14$/);
});
