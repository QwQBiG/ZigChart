import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, appearanceForTheme, parseAppearance, readAppearance, resolvePalette } from '../web/src/features/appearance/model.ts';

test('appearance preferences round trip and preserve independent customizations', () => {
  const preferences = { ...appearanceForTheme('light'), upColor: '#abcdef', showGrid: false, candleStyle: 'hollow',
    showBody: false, showBorder: true, showWick: false, borderUpColor: '#123456', wickDownColor: '#fedcba' };
  assert.deepEqual(readAppearance(JSON.stringify(preferences)), preferences);
  assert.equal(DEFAULT_APPEARANCE.theme, 'dark');
  assert.equal(DEFAULT_APPEARANCE.backgroundColor, '#000000');
  assert.ok(Object.isFrozen(DEFAULT_APPEARANCE));
});

test('missing, malformed and unknown-version preferences recover safely', () => {
  for (const text of [null, '', '{', 'null', 'false', '42', '[]', '{}', '{"version":4,"theme":"light"}']) {
    assert.deepEqual(readAppearance(text), DEFAULT_APPEARANCE, String(text));
  }
});

test('invalid appearance fields fall back independently to the selected theme', () => {
  const input = {
    version: 1, theme: 'light', upColor: '#ABCDEF', downColor: 'red', backgroundColor: 'url(example)',
    gridColor: '#fff', maColor: '#12345678', emaColor: null, showGrid: 'false', showLastPrice: 0,
    candleStyle: 'invisible', indicatorWidth: 2.5, extra: 'ignored',
  };
  const actual = parseAppearance(input);
  assert.deepEqual(actual, { ...appearanceForTheme('light'), upColor: '#abcdef', borderUpColor: '#abcdef', wickUpColor: '#abcdef' });
  assert.equal(Object.hasOwn(actual, 'extra'), false);
});

test('legacy appearance migrates the old dark preset without retaining indicator styles', () => {
  const legacy = { version: 1, theme: 'dark', backgroundColor: '#131722', gridColor: '#242b3a',
    maColor: '#abcdef', emaColor: '#123456', indicatorWidth: 4, showGrid: false };
  const migrated = parseAppearance(legacy);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.backgroundColor, '#000000');
  assert.equal(migrated.gridColor, '#202020');
  assert.equal(migrated.showGrid, false);
  for (const key of ['maColor', 'emaColor', 'indicatorWidth']) assert.equal(Object.hasOwn(migrated, key), false);
  assert.equal(parseAppearance({ ...legacy, backgroundColor: '#123456' }).backgroundColor, '#123456');
  assert.equal(parseAppearance({ ...legacy, version: 2 }).backgroundColor, '#131722');
});

test('legacy candles retain body, border and wick colors when upgrading', () => {
  for (const version of [1, 2]) {
    const migrated = parseAppearance({ version, theme: 'light', upColor: '#ABCDEF', downColor: '#123456', candleStyle: 'hollow' });
    assert.equal(migrated.version, 3);
    assert.equal(migrated.upColor, '#abcdef');
    assert.equal(migrated.borderUpColor, '#abcdef');
    assert.equal(migrated.wickUpColor, '#abcdef');
    assert.equal(migrated.borderDownColor, '#123456');
    assert.equal(migrated.wickDownColor, '#123456');
    assert.equal(migrated.candleStyle, 'hollow');
    assert.equal(migrated.showBody && migrated.showBorder && migrated.showWick, true);
  }
});

test('independent candle controls validate malformed values without changing valid siblings', () => {
  const actual = parseAppearance({ version: 3, theme: 'dark', showBody: false, showBorder: 'false', showWick: false,
    upColor: '#ABCDEF', borderUpColor: 'red', borderDownColor: '#112233', wickUpColor: '#ffffff', wickDownColor: null });
  assert.equal(actual.showBody, false);
  assert.equal(actual.showBorder, true);
  assert.equal(actual.showWick, false);
  assert.equal(actual.upColor, '#abcdef');
  assert.equal(actual.borderUpColor, DEFAULT_APPEARANCE.borderUpColor);
  assert.equal(actual.borderDownColor, '#112233');
  assert.equal(actual.wickUpColor, '#ffffff');
  assert.equal(actual.wickDownColor, DEFAULT_APPEARANCE.wickDownColor);
});

test('theme presets return independent values and palettes retain custom chart colors', () => {
  const dark = appearanceForTheme('dark');
  dark.upColor = '#123456';
  assert.notEqual(appearanceForTheme('dark').upColor, dark.upColor);
  const palette = resolvePalette(dark);
  assert.equal(palette.upColor, '#123456');
  assert.notEqual(palette.text, resolvePalette(appearanceForTheme('light')).text);
  assert.notEqual(palette.surface, resolvePalette(appearanceForTheme('light')).surface);
});
