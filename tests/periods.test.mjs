import test from 'node:test';
import assert from 'node:assert/strict';
import { PERIODS, getPeriod, bucketStart, nextBucketStart, periodOrdinal, DAY_MS } from '../web/src/data/periods.ts';

test('supported periods have unique canonical identities and reject unavailable seconds', () => {
  assert.equal(new Set(PERIODS.map(period => period.id)).size, PERIODS.length);
  assert.equal(PERIODS.length, 15);
  for (const id of ['1s', '1mo', '1H', '', '13h']) assert.throws(() => getPeriod(id), /Unsupported period/);
  assert.equal(getPeriod('1m').unit, 'minute');
  assert.equal(getPeriod('1M').unit, 'month');
  assert.equal(getPeriod('1M').intervalMs, undefined);
});

test('fixed buckets start at UTC boundaries and are half open', () => {
  const time = Date.UTC(2026, 0, 13, 8, 17, 42);
  assert.equal(bucketStart(time, '5m'), Date.UTC(2026, 0, 13, 8, 15));
  assert.equal(bucketStart(time, '6h'), Date.UTC(2026, 0, 13, 6));
  assert.equal(bucketStart(time, '1d'), Date.UTC(2026, 0, 13));
  for (const { id } of PERIODS) {
    const start = bucketStart(time, id);
    const next = nextBucketStart(time, id);
    assert.equal(bucketStart(start, id), start);
    assert.equal(bucketStart(next - 1, id), start);
    assert.equal(bucketStart(next, id), next);
    assert.equal(periodOrdinal(next, id), periodOrdinal(start, id) + 1);
  }
});

test('weekly buckets start Monday UTC across year transitions', () => {
  const monday = Date.UTC(2025, 11, 29);
  assert.equal(bucketStart(Date.UTC(2026, 0, 1, 20), '1w'), monday);
  assert.equal(bucketStart(Date.UTC(2026, 0, 4, 23, 59), '1w'), monday);
  assert.equal(nextBucketStart(monday, '1w'), Date.UTC(2026, 0, 5));
});

test('calendar months use leap years and real boundaries, not a fixed duration', () => {
  const february = Date.UTC(2024, 1, 1);
  assert.equal(bucketStart(Date.UTC(2024, 1, 29, 23, 59), '1M'), february);
  assert.equal(nextBucketStart(february, '1M') - february, 29 * DAY_MS);
  assert.equal(nextBucketStart(Date.UTC(2025, 1, 1), '1M') - Date.UTC(2025, 1, 1), 28 * DAY_MS);
  assert.equal(nextBucketStart(Date.UTC(2025, 11, 1), '1M'), Date.UTC(2026, 0, 1));
  assert.equal(periodOrdinal(Date.UTC(2026, 0, 1), '1M') - periodOrdinal(Date.UTC(2022, 0, 1), '1M'), 48);
});

test('invalid and unrepresentable timestamps are rejected before calendar arithmetic', () => {
  for (const time of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => bucketStart(time, '1M'), /Invalid period timestamp/);
  }
});
