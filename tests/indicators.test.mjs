import test from 'node:test';
import assert from 'node:assert/strict';
import { INDICATOR_IDS, createIndicatorState, parseIndicatorState, setIndicatorEnabled, updateStudy } from '../web/src/features/analysis/model.ts';
import { analysisCatalog, indicatorTitle, searchAnalysis } from '../web/src/features/analysis/catalog.ts';

test('new indicator documents start empty and do not share mutable settings', () => {
  const first = createIndicatorState();
  const second = createIndicatorState();
  assert.equal(first.version, 4);
  assert.ok(INDICATOR_IDS.every(id => !first[id].enabled));
  first.ma.period = 7;
  first.ema.color = '#123456';
  first.volume.opacity = .2;
  assert.equal(second.ma.period, 20);
  assert.equal(second.ema.color, '#a397ed');
  assert.equal(second.volume.opacity, .6);
  first.rsi.lower = 20; first.macd.signalPeriod = 5;
  assert.equal(second.rsi.lower, 30);
  assert.equal(second.rsi.period, 14);
  assert.equal(second.macd.signalPeriod, 9);
  first.bb.multiplier = 3; first.bb.fillColor = '#123456';
  assert.equal(second.bb.multiplier, 2);
  assert.equal(second.bb.fillColor, '#4f8cff');
});

test('each indicator can be added and removed without changing others or losing its settings', () => {
  const original = createIndicatorState();
  original.ma = { enabled: false, period: 7, color: '#123456', width: 4 };
  original.volume = { enabled: false, upColor: '#abcdef', downColor: '#fedcba', opacity: .3 };
  original.bb = { ...original.bb, period: 45, multiplier: 3.2, fillOpacity: .25, showFill: false, width: 3 };
  for (const id of INDICATOR_IDS) {
    const added = setIndicatorEnabled(original, id, true);
    assert.equal(added[id].enabled, true);
    for (const other of INDICATOR_IDS.filter(value => value !== id)) assert.deepEqual(added[other], original[other]);
    const removed = setIndicatorEnabled(added, id, false);
    assert.deepEqual(removed, original);
    assert.deepEqual(setIndicatorEnabled(removed, id, true), added);
    assert.notEqual(added.ma, original.ma);
    assert.notEqual(added.ema, original.ema);
    assert.notEqual(added.volume, original.volume);
    assert.notEqual(added.rsi, original.rsi);
    assert.notEqual(added.macd, original.macd);
    assert.notEqual(added.bb, original.bb);
  }
});

test('saved indicator preferences round trip as a validated independent document', () => {
  const input = createIndicatorState();
  input.ma = { enabled: true, period: 1, color: '#ABCDEF', width: 1 };
  input.ema = { enabled: true, period: 500, color: '#123456', width: 4 };
  input.volume = { enabled: true, upColor: '#FEDCBA', downColor: '#654321', opacity: 1 };
  const restored = parseIndicatorState(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(restored, { ...input, ma: { ...input.ma, color: '#abcdef' }, volume: { ...input.volume, upColor: '#fedcba' } });
  restored.ma.period = 18;
  assert.equal(input.ma.period, 1);
  assert.equal(restored.ema.period, 500);
});

test('malformed documents and any invalid indicator reject the entire preference state', () => {
  for (const value of [null, [], {}, 'text', 1, { ...createIndicatorState(), version: 5 }]) assert.equal(parseIndicatorState(value), null);
  const invalidFields = [
    ['ma', 'period', 0], ['ma', 'period', 501], ['ema', 'period', 1.5], ['ema', 'period', '20'],
    ['ma', 'width', 0], ['ema', 'width', 5], ['ema', 'width', NaN], ['ma', 'width', 2.5],
    ['ma', 'enabled', 1], ['volume', 'enabled', 'false'], ['ma', 'color', ['#abcdef']],
    ['ema', 'color', '#fff'], ['volume', 'upColor', 'red'], ['volume', 'downColor', null],
    ['volume', 'opacity', .09], ['volume', 'opacity', 1.1], ['volume', 'opacity', Infinity], ['volume', 'opacity', '0.5'],
    ['rsi', 'lower', -1], ['rsi', 'upper', 101], ['rsi', 'lower', 70], ['rsi', 'upper', 30],
    ['rsi', 'lower', NaN], ['rsi', 'showLevels', 1], ['rsi', 'period', 0], ['rsi', 'width', 5],
    ['macd', 'fastPeriod', 26], ['macd', 'slowPeriod', 12], ['macd', 'signalPeriod', 0],
    ['macd', 'slowPeriod', 501], ['macd', 'fastPeriod', 1.5], ['macd', 'signalPeriod', '9'],
    ['macd', 'lineColor', '#fff'], ['macd', 'signalColor', null], ['macd', 'width', 0],
    ['bb', 'period', 0], ['bb', 'period', 501], ['bb', 'period', 2.5], ['bb', 'period', '20'],
    ['bb', 'multiplier', .09], ['bb', 'multiplier', 10.1], ['bb', 'multiplier', NaN], ['bb', 'multiplier', Infinity],
    ['bb', 'multiplier', '2'], ['bb', 'fillOpacity', -.01], ['bb', 'fillOpacity', 1.01], ['bb', 'fillOpacity', NaN],
    ['bb', 'fillOpacity', Infinity], ['bb', 'fillOpacity', '0.5'], ['bb', 'width', 0], ['bb', 'width', 5], ['bb', 'width', 2.5],
    ['bb', 'enabled', 1], ['bb', 'showFill', 'false'], ['bb', 'basisColor', '#fff'], ['bb', 'upperColor', 'blue'],
    ['bb', 'lowerColor', null], ['bb', 'fillColor', '#gggggg'],
  ];
  for (const [id, field, value] of invalidFields) {
    const input = createIndicatorState();
    input[id][field] = value;
    assert.equal(parseIndicatorState(input), null, `${id}.${field}: ${String(value)}`);
  }
  const missing = createIndicatorState();
  delete missing.volume.upColor;
  assert.equal(parseIndicatorState(missing), null);
  const missingBands = createIndicatorState(); delete missingBands.bb;
  assert.equal(parseIndicatorState(missingBands), null);
});

test('version two and three migration preserve existing studies while starting bands disabled', () => {
  const defaults = createIndicatorState();
  for (const version of [2, 3]) {
    const legacy = { ...defaults, version, ma: { ...defaults.ma, enabled: true, period: 9 },
      rsi: { ...defaults.rsi, enabled: true, lower: 25 }, bb: { enabled: true, multiplier: 5 },
      averages: version === 3 ? [{ ...defaults.ema, enabled: true, id: 'average-3', kind: 'ema', period: 42 }] : undefined };
    const migrated = parseIndicatorState(legacy);
    assert.equal(migrated.version, 4);
    assert.deepEqual(migrated.ma, legacy.ma);
    assert.deepEqual(migrated.rsi, legacy.rsi);
    assert.deepEqual(migrated.averages, legacy.averages ?? []);
    assert.deepEqual(migrated.bb, defaults.bb);
    assert.equal(migrated.bb.enabled, false);
  }
});

test('Bollinger settings preserve boundary values, colors and retained styles independently', () => {
  const original = createIndicatorState();
  for (const [period, multiplier, fillOpacity, width] of [[1, .1, 0, 1], [500, 10, 1, 4]]) {
    const changed = updateStudy(original, 'bb', { enabled: true, period, multiplier, fillOpacity, width, showFill: false,
      basisColor: '#ABCDEF', upperColor: '#FEDCBA', lowerColor: '#123ABC', fillColor: '#ABC123' });
    assert.deepEqual(changed.bb, { enabled: true, period, multiplier, fillOpacity, width, showFill: false,
      basisColor: '#abcdef', upperColor: '#fedcba', lowerColor: '#123abc', fillColor: '#abc123' });
    assert.deepEqual(parseIndicatorState(JSON.parse(JSON.stringify(changed))), changed);
    for (const id of INDICATOR_IDS.filter(id => id !== 'bb')) assert.deepEqual(changed[id], original[id]);
    const removed = setIndicatorEnabled(changed, 'bb', false);
    assert.deepEqual(removed.bb, { ...changed.bb, enabled: false });
    assert.deepEqual(setIndicatorEnabled(removed, 'bb', true), changed);
  }
  assert.equal(updateStudy(original, 'bb', { multiplier: 0 }), null);
  assert.equal(original.bb.multiplier, 2);
});

test('version one migration preserves existing studies and adds disabled oscillators', () => {
  const defaults = createIndicatorState();
  const legacy = { version: 1, ma: { ...defaults.ma, enabled: true, period: 7 },
    ema: { ...defaults.ema, color: '#ABCDEF' }, volume: { ...defaults.volume, enabled: true, opacity: .3 } };
  const migrated = parseIndicatorState(legacy);
  assert.deepEqual(migrated, { ...defaults, ma: legacy.ma, ema: { ...legacy.ema, color: '#abcdef' }, volume: legacy.volume });
  assert.notEqual(migrated.ma, legacy.ma);
  assert.equal(parseIndicatorState({ ...legacy, volume: {} }), null);
});

test('oscillator boundary parameters and presentation fields round trip without changing other studies', () => {
  const input = createIndicatorState();
  input.rsi = { enabled: true, period: 500, color: '#ABCDEF', width: 4, lower: 0, upper: 100, showLevels: false };
  input.macd = { ...input.macd, enabled: true, fastPeriod: 1, slowPeriod: 500, signalPeriod: 500, lineColor: '#ABCDEF' };
  const actual = parseIndicatorState(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(actual, { ...input, rsi: { ...input.rsi, color: '#abcdef' }, macd: { ...input.macd, lineColor: '#abcdef' } });
  for (const id of ['rsi', 'macd']) assert.deepEqual(setIndicatorEnabled(setIndicatorEnabled(actual, id, false), id, true), actual);
});

test('the unified library groups and finds oscillators in either language with parameter-aware names', () => {
  assert.deepEqual(analysisCatalog.map(entry => entry.id), INDICATOR_IDS);
  assert.deepEqual(searchAnalysis('振荡').map(entry => entry.id), ['rsi', 'macd']);
  assert.deepEqual(searchAnalysis('relative strength').map(entry => entry.id), ['rsi']);
  assert.deepEqual(searchAnalysis('MACD').map(entry => entry.id), ['macd']);
  assert.ok(analysisCatalog.filter(entry => entry.group === 'oscillators').every(entry => entry.placement === 'pane'));
  const state = createIndicatorState(); state.macd.fastPeriod = 5; state.rsi.period = 21;
  assert.match(indicatorTitle('macd', state, 'en'), /MACD 5 26 9$/);
  assert.match(indicatorTitle('rsi', state, 'zh-CN'), /RSI 21$/);
  for (const query of ['BB', 'BOLL', '布林带', 'population standard deviation']) {
    assert.deepEqual(searchAnalysis(query).map(entry => entry.id), ['bb']);
  }
  const bands = analysisCatalog.find(entry => entry.id === 'bb');
  assert.equal(bands.group, 'volatility');
  assert.equal(bands.placement, 'price');
  state.bb.period = 50; state.bb.multiplier = 2.5;
  assert.match(indicatorTitle('bb', state, 'en'), /BB 50 2.5$/);
  assert.match(indicatorTitle('bb', state, 'zh-CN'), /布林带 · BB 50 2.5$/);
});
