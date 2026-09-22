import test from 'node:test';
import assert from 'node:assert/strict';
import { SampleFeed, SAMPLE_START, sampleBar } from '../web/src/data/sample-feed.ts';
import { bucketStart, nextBucketStart, MINUTE_MS } from '../web/src/data/periods.ts';

const aggregate = (bars, time) => ({ time, open: bars[0].open, close: bars.at(-1).close,
  high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)),
  volume: bars.reduce((sum, bar) => sum + bar.volume, 0) });

test('replay snapshots exclude future minutes and partial coarse OHLCV at one shared cutoff', async () => {
  const feed = new SampleFeed(), cutoff = Date.UTC(2024, 1, 2, 1, 17, 15), end = feed.replay.state.end;
  // A previously cached completed day must not leak into a rewind within that day.
  await feed.getHistory('1d', Date.UTC(2024, 1, 3), 2);
  feed.replay.seek(cutoff);
  const fine = await feed.getHistory('1m', undefined, 7000);
  assert.equal(fine.asOf, cutoff); assert.equal(fine.partialLastBar, true);
  const last = fine.bars.at(-1), final = sampleBar((last.time - SAMPLE_START) / MINUTE_MS);
  assert.equal(last.close, Math.round(final.open + (final.close - final.open) / 4));
  assert.equal(last.volume, Math.round(final.volume / 4));
  assert.equal(last.high, Math.max(last.open, last.close));
  assert.ok(fine.bars.every(bar => bar.time < cutoff));
  for (const period of ['5m', '1h', '1d', '1w', '1M']) {
    const page = await feed.getHistory(period, undefined, 1), start = bucketStart(cutoff - 1, period);
    assert.deepEqual(page.bars[0], aggregate(fine.bars.filter(bar => bar.time >= start), start));
    assert.equal(page.asOf, cutoff); assert.equal(page.partialLastBar, true);
  }
  const older = await feed.getHistory('1m', fine.bars[0].time, 3);
  assert.equal(older.asOf, cutoff); assert.ok(older.bars.every(bar => bar.time < fine.bars[0].time));
  assert.deepEqual(feed.replay.state, { active: true, cutoff, end });
});

test('steps complete a partial period then add the next bar and stop at the fixed source end', async () => {
  const feed = new SampleFeed(), end = feed.replay.state.end, cutoff = SAMPLE_START + 1234 * MINUTE_MS + 15_000;
  feed.replay.seek(cutoff);
  const complete = await feed.replay.advance('1m');
  assert.deepEqual(complete.bars, [sampleBar(1234)]); assert.equal(complete.partialLastBar, false);
  const next = await feed.replay.advance('1m');
  assert.deepEqual(next.bars, [sampleBar(1235)]); assert.equal(next.asOf, SAMPLE_START + 1236 * MINUTE_MS);
  const coarse = await feed.replay.advance('5m');
  assert.equal(coarse.asOf, nextBucketStart(next.asOf, '5m'));
  assert.deepEqual(coarse.bars, (await feed.getHistory('5m', undefined, 1)).bars);
  feed.replay.seek(end - 30_000);
  const final = await feed.replay.advance('1d');
  assert.equal(final.asOf, end); assert.equal(final.partialLastBar, true); assert.equal(final.bars.length, 1);
  assert.deepEqual((await feed.replay.advance('1d')).bars, []);
  feed.replay.reset(); assert.deepEqual(feed.replay.state, { active: false, cutoff: end, end });
});

test('invalid seeks and cancelled or superseded aggregation cannot advance the replay clock', async () => {
  const feed = new SampleFeed(), cutoff = Date.UTC(2024, 0, 2), end = feed.replay.state.end;
  feed.replay.seek(cutoff);
  for (const invalid of [NaN, SAMPLE_START, cutoff + 1, end + 15_000]) assert.throws(() => feed.replay.seek(invalid));
  assert.equal(feed.replay.state.cutoff, cutoff);
  const abort = new AbortController(), step = feed.replay.advance('1M', abort.signal);
  abort.abort(); await assert.rejects(step, { name: 'AbortError' });
  assert.equal(feed.replay.state.cutoff, cutoff);
  const superseded = feed.replay.advance('1M'); feed.replay.seek(cutoff + MINUTE_MS);
  await assert.rejects(superseded, /state changed/);
  assert.equal(feed.replay.state.cutoff, cutoff + MINUTE_MS);
});

test('replay fixes a partial live end and reset restores the paused simulated tick position', async context => {
  const timers = [];
  context.mock.method(globalThis, 'setTimeout', callback => { timers.push(callback); return timers.length; });
  context.mock.method(globalThis, 'clearTimeout', () => {});
  const feed = new SampleFeed(), baseline = feed.replay.state.end, errors = [];
  let stop = feed.subscribe('1m', () => {}, error => errors.push(error));
  await new Promise(resolve => setImmediate(resolve));
  timers.shift()(); timers.shift()(); stop();
  const end = baseline + 15_000;
  assert.equal(feed.replay.state.end, end);
  feed.replay.seek(baseline);
  const page = await feed.replay.advance('1m');
  assert.equal(page.asOf, end); assert.equal(page.partialLastBar, true);
  assert.equal(page.bars[0].time, baseline);
  feed.replay.reset();
  const restored = await feed.getHistory('1m', undefined, 1);
  assert.deepEqual(restored.bars, page.bars); assert.equal(restored.asOf, end);
  assert.deepEqual(errors, []);
});
