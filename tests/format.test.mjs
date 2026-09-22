import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrice, formatVolume, scalePrecision } from '../web/src/chart/format.ts';
import { setLocale } from '../web/src/ui/i18n.ts';

afterEach(() => setLocale('en'));

test('terminating integer scales retain the precision of a single unit', () => {
  for (const locale of ['en', 'zh-CN']) {
    setLocale(locale);
    for (const [scale, digits, expected] of [[1, 0, '1'], [8, 3, '0.125'], [32, 5, '0.03125'],
      [100, 2, '0.01'], [1000000000, 9, '0.000000001'], [5 ** 20, 20, '0.00000000000001048576']]) {
      assert.equal(scalePrecision(scale), digits);
      assert.equal(formatPrice(1, scale), expected);
      assert.equal(formatPrice(-1, scale), `-${expected}`);
    }
  }
});

test('integer quotes remain exact when scaled division would lose decimal places', () => {
  setLocale('en');
  assert.equal(formatPrice(1000000000001, 5 ** 20), '0.01048576000001048576');
  assert.equal(formatPrice(-1000000000001, 5 ** 20), '-0.01048576000001048576');
  assert.equal(formatPrice(1234567, 100), '12,345.67');
  assert.equal(formatPrice(0, 100), '0.00');
  assert.equal(formatPrice(-0, 100), '0.00');
  assert.equal(formatPrice(0, 1), '0');
  assert.equal(formatPrice(25.5, 8), '3.188', 'Indicator and axis fractions round at the instrument precision');
});

test('full and compact volume use instrument units and the selected locale', () => {
  setLocale('en');
  assert.equal(formatVolume(1, 8, false), '0.125');
  assert.equal(formatVolume(8, 8, false), '1');
  assert.equal(formatVolume(1, 1000000000, false), '0.000000001');
  assert.equal(formatVolume(1000000000001, 5 ** 20, false), '0.01048576000001048576');
  assert.equal(formatVolume(123456, 100, false), '1,234.56');
  assert.equal(formatVolume(1, 8), '0.125');
  assert.equal(formatVolume(12500, 1), '12.5K');
  setLocale('zh-CN');
  assert.equal(formatVolume(12500, 1), '1.3万');
  setLocale('en');
  assert.equal(formatVolume(12500, 1), '12.5K');
});

test('unsupported scales fail explicitly instead of hiding units through rounding', () => {
  for (const scale of [0, -1, 1.5, 3, 6, 7, Infinity, NaN, 2 ** 21, 2 ** 53, '100']) {
    assert.throws(() => scalePrecision(scale), RangeError);
    assert.throws(() => formatPrice(1, scale), RangeError);
    assert.throws(() => formatVolume(1, scale), RangeError);
  }
});
