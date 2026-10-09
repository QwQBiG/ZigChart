import test from 'node:test';
import assert from 'node:assert/strict';
import { INDICATOR_IDS, createIndicatorState, parseIndicatorState, setIndicatorEnabled, updateStudy } from '../web/src/features/analysis/model.ts';
import { analysisCatalog, indicatorTitle, searchAnalysis } from '../web/src/features/analysis/catalog.ts';

test('Donchian preferences migrate from version four without changing existing studies', () => {
  const defaults = createIndicatorState();
  const { dc, ...legacy } = defaults;
  const previous = { ...legacy, version: 4, bb: { ...legacy.bb, enabled: true, period: 34 },
    averages: [{ ...legacy.ma, enabled: true, period: 7, id: 'average-2', kind: 'ma' }] };
  const migrated = parseIndicatorState(previous);
  assert.deepEqual(migrated, { ...previous, version: 6, dc });
  assert.equal(migrated.dc.enabled, false);
  assert.notEqual(migrated.dc, dc);
});

test('Donchian settings validate every field and round trip independently', () => {
  const original = createIndicatorState();
  assert.ok(INDICATOR_IDS.includes('dc'));
  assert.equal(original.dc.period, 20);
  assert.equal(original.dc.enabled, false);
  for (const [period, width, fillOpacity] of [[1, 1, 0], [500, 4, 1]]) {
    const changed = updateStudy(original, 'dc', { enabled: true, period, width, fillOpacity, showFill: false,
      upperColor: '#ABCDEF', lowerColor: '#FEDCBA', middleColor: '#123ABC', fillColor: '#ABC123' });
    assert.deepEqual(changed.dc, { enabled: true, period, width, fillOpacity, showFill: false,
      upperColor: '#abcdef', lowerColor: '#fedcba', middleColor: '#123abc', fillColor: '#abc123' });
    assert.deepEqual(parseIndicatorState(JSON.parse(JSON.stringify(changed))), changed);
    for (const id of INDICATOR_IDS.filter(id => id !== 'dc')) assert.deepEqual(changed[id], original[id]);
    const disabled = setIndicatorEnabled(changed, 'dc', false);
    assert.deepEqual(disabled.dc, { ...changed.dc, enabled: false });
    assert.deepEqual(setIndicatorEnabled(disabled, 'dc', true), changed);
  }
  const invalid = [
    ['period', 0], ['period', 501], ['period', 1.5], ['period', '20'], ['enabled', 1],
    ['width', 0], ['width', 5], ['width', 1.5], ['fillOpacity', -.01], ['fillOpacity', 1.01],
    ['fillOpacity', NaN], ['fillOpacity', Infinity], ['showFill', 'true'],
    ['upperColor', 'blue'], ['lowerColor', '#fff'], ['middleColor', null], ['fillColor', '#gggggg'],
  ];
  for (const [field, value] of invalid) {
    assert.equal(updateStudy(original, 'dc', { [field]: value }), null, `${field}: ${String(value)}`);
  }
  assert.equal(parseIndicatorState({ ...original, dc: undefined }), null);
  assert.equal(parseIndicatorState({ ...original, version: 7 }), null);
  assert.deepEqual(original, createIndicatorState());
});

test('Donchian catalog entry is searchable and names its selected period in both languages', () => {
  assert.deepEqual(analysisCatalog.map(entry => entry.id), INDICATOR_IDS);
  assert.deepEqual(searchAnalysis('donchian').map(entry => entry.id), ['dc']);
  assert.deepEqual(searchAnalysis('唐奇安').map(entry => entry.id), ['dc']);
  const entry = analysisCatalog.find(item => item.id === 'dc');
  assert.equal(entry.group, 'volatility');
  assert.equal(entry.placement, 'price');
  const state = createIndicatorState(); state.dc.period = 55;
  assert.match(indicatorTitle('dc', state, 'en'), /DC 55$/);
  assert.match(indicatorTitle('dc', state, 'zh-CN'), /DC 55$/);
});
