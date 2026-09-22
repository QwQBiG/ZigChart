import test from 'node:test';
import assert from 'node:assert/strict';
import { SampleFeed, HISTORY_COUNT, SAMPLE_START, sampleBar, replayBar } from '../web/src/data/sample-feed.ts';
import { bucketStart, nextBucketStart, MINUTE_MS } from '../web/src/data/periods.ts';

test('history is deterministic, exclusive, paginated and exhaustible', async () => {
  const feed = new SampleFeed();
  const first = await feed.getHistory('1m', undefined, 300);
  const again = await feed.getHistory('1m', undefined, 300);
  assert.deepEqual(first, again);
  assert.equal(first.bars.at(-1).time, sampleBar(HISTORY_COUNT - 1).time);
  const older = await feed.getHistory('1m', first.bars[0].time, 300);
  assert.ok(older.bars.at(-1).time < first.bars[0].time);
  const earliest = await feed.getHistory('1m', SAMPLE_START + 300 * MINUTE_MS, 500);
  assert.equal(earliest.bars.length, 300);
  assert.equal(earliest.hasMore, false);
  const empty = await feed.getHistory('1m', earliest.bars[0].time, 300);
  assert.deepEqual(empty, { periodId: '1m', bars: [], hasMore: false, partialLastBar: false });
});

test('history handles invalid requests and cancellation', async () => {
  const feed = new SampleFeed();
  await assert.rejects(feed.getHistory('1m', undefined, 0), /limit/);
  await assert.rejects(feed.getHistory('1m', NaN, 100), /cursor/);
  await assert.rejects(feed.getHistory('1s', undefined, 100), /Unsupported period/);
  const abort = new AbortController();
  const promise = feed.getHistory('1M', undefined, 100, abort.signal);
  abort.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});

test('replay snapshots are cumulative and finish at reproducible OHLCV', () => {
  for (let i = 0; i < 20; i++) {
    const group = Array.from({ length: 4 }, (_, phase) => replayBar(i * 4 + phase));
    assert.deepEqual(group[3], sampleBar(HISTORY_COUNT + i));
    group.forEach((bar, phase) => {
      assert.equal(bar.time, group[0].time);
      assert.equal(bar.open, group[0].open);
      if (phase) {
        assert.ok(bar.high >= group[phase - 1].high);
        assert.ok(bar.low <= group[phase - 1].low);
        assert.ok(bar.volume >= group[phase - 1].volume);
      }
    });
  }
});

test('subscription teardown stops updates and pause/resume keeps sequence', async () => {
  const feed = new SampleFeed();
  const received = [];
  let stop;
  await new Promise((resolve, reject) => {
    stop = feed.subscribe('1m', batch => { received.push(...batch); stop(); resolve(); }, reject);
  });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], sampleBar(HISTORY_COUNT - 1));
  await new Promise((resolve, reject) => {
    stop = feed.subscribe('1m', batch => { received.push(...batch); stop(); resolve(); }, reject);
  });
  assert.deepEqual(received[1], replayBar(0));
});

function aggregate(bars, time) {
  return { time, open: bars[0].open, high: Math.max(...bars.map(bar => bar.high)),
    low: Math.min(...bars.map(bar => bar.low)), close: bars.at(-1).close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0) };
}

test('coarse periods aggregate the same source OHLCV, including partial right buckets', async () => {
  const feed = new SampleFeed();
  for (const periodId of ['5m', '30m', '1h', '12h', '1d', '1w', '1M']) {
    const result = await feed.getHistory(periodId, undefined, 2);
    assert.equal(result.periodId, periodId);
    for (const bar of result.bars) {
      const start = (bar.time - SAMPLE_START) / MINUTE_MS;
      const end = Math.min(HISTORY_COUNT, (nextBucketStart(bar.time, periodId) - SAMPLE_START) / MINUTE_MS);
      assert.deepEqual(bar, aggregate(Array.from({ length: end - start }, (_, i) => sampleBar(start + i)), bar.time));
    }
    assert.equal(result.partialLastBar, nextBucketStart(result.bars.at(-1).time, periodId) > sampleBar(HISTORY_COUNT - 1).time + MINUTE_MS);
  }
});

test('monthly history has enough reproducible calendar bars, exclusive pages and a complete left edge', async () => {
  const feed = new SampleFeed();
  const recent = await feed.getHistory('1M', undefined, 20);
  const older = await feed.getHistory('1M', recent.bars[0].time, 100);
  assert.equal(recent.bars.length + older.bars.length, 49);
  assert.equal(older.hasMore, false);
  assert.equal(older.partialLastBar, false);
  assert.equal(older.bars[0].time, SAMPLE_START);
  assert.equal(recent.bars[0].time, nextBucketStart(older.bars.at(-1).time, '1M'));
  const months = [...older.bars, ...recent.bars];
  assert.ok(months.every(bar => bar.low > 0));
  assert.ok(months.some(bar => bar.close > bar.open));
  assert.ok(months.some(bar => bar.close < bar.open));
  const firstWeeks = await feed.getHistory('1w', Date.UTC(2022, 0, 20), 100);
  assert.equal(firstWeeks.bars[0].time, Date.UTC(2022, 0, 3));
  assert.equal(firstWeeks.hasMore, false);
});

test('large generation yields and can be cancelled after it begins', async () => {
  const feed = new SampleFeed();
  const controller = new AbortController();
  const pending = feed.getHistory('1M', undefined, 100, controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { name: 'AbortError' });
  const page = await feed.getHistory('1m', undefined, 3);
  assert.equal(page.bars.length, 3);
});

test('cumulative replay revisions never double count volume and switching periods keeps the clock', async () => {
  const feed = new SampleFeed();
  const received = [];
  let stop;
  await new Promise((resolve, reject) => {
    stop = feed.subscribe('5m', (bars, partial) => {
      received.push({ bar: bars[0], partial });
      if (received.length === 6) { stop(); resolve(); }
    }, reject);
  });
  for (let i = 1; i < received.length; i++) {
    const minute = replayBar(i - 1);
    const bars = i <= 4 ? [minute] : [sampleBar(HISTORY_COUNT), minute];
    assert.deepEqual(received[i].bar, aggregate(bars, bucketStart(minute.time, '5m')));
    assert.equal(received[i].partial, true);
  }
  const minutePage = await feed.getHistory('1m', undefined, 1);
  assert.deepEqual(minutePage.bars[0], replayBar(4));
  assert.equal(minutePage.partialLastBar, true);
  const coarsePage = await feed.getHistory('5m', undefined, 1);
  assert.deepEqual(coarsePage.bars[0], received.at(-1).bar);
  await new Promise((resolve, reject) => {
    stop = feed.subscribe('1m', bars => {
      assert.deepEqual(bars[0], replayBar(5)); stop(); resolve();
    }, reject);
  });
});
