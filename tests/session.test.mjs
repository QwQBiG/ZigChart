import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketSession } from '../web/src/data/session.ts';

const bar = { time: Date.UTC(2026, 0, 1), open: 100, high: 110, low: 90, close: 105, volume: 20 };
const page = (periodId, overrides = {}) => ({ periodId, bars: [{ ...bar }], hasMore: true, partialLastBar: false, ...overrides });

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(overrides = {}) {
  const requests = [], streams = [], histories = [], bars = [], corrections = [], errors = [], resets = [], changes = [];
  const feed = {
    getHistory(periodId, before, limit, signal) {
      const pending = { ...deferred(), periodId, before, limit, signal };
      requests.push(pending);
      return pending.promise;
    },
    subscribe(periodId, onBars, onError, onCorrections) {
      const stream = { periodId, onBars, onError, onCorrections, stops: 0 };
      streams.push(stream);
      overrides.subscribe?.(stream);
      return () => { stream.stops++; overrides.unsubscribe?.(stream); };
    },
  };
  const session = new MarketSession(feed, {
    reset(periodId) { resets.push(periodId); },
    history(value, initial) { overrides.history?.(value, initial); histories.push({ value, initial }); },
    bars(value, partial) { overrides.bars?.(value, partial); bars.push({ value, partial }); },
    corrections(value) { overrides.corrections?.(value); corrections.push(value); },
    error(error, source) { errors.push({ error, source }); },
    change() { changes.push({ loading: session.loading, ready: session.ready, running: session.running, period: session.period }); },
  });
  return { session, requests, streams, histories, bars, corrections, errors, resets, changes };
}

async function ready(h, periodId = '1m') {
  const opening = h.session.open(periodId);
  h.requests.at(-1).resolve(page(periodId));
  await opening;
}

test('invalid snapshot cutoffs are rejected before delivering history', async () => {
  for (const asOf of [NaN, bar.time, bar.time - 1]) {
    const h = harness();
    const opening = h.session.open('1m');
    h.requests[0].resolve(page('1m', { asOf }));
    await opening;
    assert.equal(h.histories.length, 0);
    assert.equal(h.session.ready, false);
    assert.equal(h.errors.length, 1);
    h.session.dispose();
  }
});

test('historical snapshots pause replay and returning to latest requires explicit resume', async () => {
  const h = harness(); await ready(h); h.session.toggleReplay();
  const before = bar.time + 60_000;
  const historical = h.session.open('15m', before);
  assert.equal(h.session.browsingHistory, true);
  assert.equal(h.session.historyBefore, before);
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.requests[1].before, before);
  h.requests[1].resolve(page('15m')); await historical;
  h.session.toggleReplay();
  assert.equal(h.streams.length, 1);
  const switched = h.session.open('1h', h.session.historyBefore);
  assert.equal(h.requests[2].before, before);
  h.requests[2].resolve(page('1h')); await switched;
  h.session.toggleReplay(); assert.equal(h.streams.length, 1);
  const latest = h.session.open('1h');
  assert.equal(h.session.browsingHistory, false);
  assert.equal(h.requests[3].before, undefined);
  h.requests[3].resolve(page('1h')); await latest;
  assert.equal(h.session.running, false);
  h.session.toggleReplay(); assert.equal(h.streams.length, 2);
  assert.equal(h.session.running, true);
  h.session.dispose();
});

test('invalid historical cursors leave a running session and its data lifetime intact', async () => {
  const h = harness(); await ready(h); h.session.toggleReplay();
  for (const before of [NaN, Infinity, bar.time + .5, 8_640_000_000_000_001]) {
    await assert.rejects(h.session.open('1d', before), /Invalid history snapshot cursor/);
    assert.equal(h.session.period, '1m');
    assert.equal(h.session.ready, true);
    assert.equal(h.session.running, true);
    assert.equal(h.session.browsingHistory, false);
    assert.equal(h.streams[0].stops, 0);
    assert.equal(h.requests.length, 1);
    assert.equal(h.resets.length, 1);
  }
  h.session.dispose();
});

test('historical failures retain the cursor for retry and empty snapshots can return to latest', async () => {
  const h = harness(), before = bar.time + 60_000;
  const opening = h.session.open('1m', before);
  h.requests[0].reject(new Error('Temporary history failure')); await opening;
  assert.equal(h.session.historyBefore, before);
  assert.equal(h.session.ready, false);
  const retry = h.session.load();
  assert.equal(h.requests[1].before, before);
  h.requests[1].resolve(page('1m', { bars: [], hasMore: false })); await retry;
  assert.equal(h.session.hasMore, false);
  assert.equal(h.session.browsingHistory, true);
  h.session.toggleReplay(); assert.equal(h.streams.length, 0);
  const latest = h.session.open('1m');
  h.requests[2].resolve(page('1m')); await latest;
  assert.equal(h.session.ready, true);
  assert.equal(h.session.hasMore, true);
  assert.equal(h.session.browsingHistory, false);
  assert.equal(h.session.running, false);
});

test('historical responses enforce exclusive cursors and cannot overwrite a newer latest request', async () => {
  const h = harness();
  const invalid = h.session.open('1m', bar.time);
  h.requests[0].resolve(page('1m')); await invalid;
  assert.equal(h.histories.length, 0);
  assert.match(h.errors[0].error.message, /exclusive cursor/);
  const historical = h.session.open('1m', bar.time + 60_000);
  const latest = h.session.open('1m');
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve(page('1m')); await historical;
  assert.equal(h.histories.length, 0);
  assert.equal(h.session.loading, true);
  h.requests[2].resolve(page('1m')); await latest;
  assert.equal(h.histories.length, 1);
  assert.equal(h.session.historyBefore, undefined);
  const older = h.session.load(bar.time);
  h.requests[3].resolve(page('1m')); await older;
  assert.equal(h.histories.length, 1);
  assert.equal(h.session.ready, true);
  assert.equal(h.errors.length, 2);
});

test('corrections have an independent callback and stale corrections cannot cross subscription lifetimes', async () => {
  const h = harness(); await ready(h); h.session.toggleReplay();
  const previous = h.streams.at(-1), revised = { ...bar, close: 100 };
  previous.onCorrections([revised]);
  assert.deepEqual(h.corrections, [[revised]]); assert.deepEqual(h.bars, []);
  h.session.toggleReplay(); previous.onCorrections([bar]);
  h.session.toggleReplay(); const current = h.streams.at(-1);
  previous.onCorrections([bar]); current.onCorrections([bar]);
  assert.equal(h.corrections.length, 2);
  const opening = h.session.open('5m'); current.onCorrections([revised]);
  h.requests.at(-1).resolve(page('5m')); await opening;
  h.session.dispose(); h.streams.at(-1).onCorrections([revised]);
  assert.equal(h.corrections.length, 2);
});

test('a rejected correction stops the stream and synchronous cleanup releases exactly once', async () => {
  const h = harness({ corrections() { throw new Error('Correction target missing'); },
    subscribe(stream) { stream.onCorrections([bar]); } });
  await ready(h); h.session.toggleReplay();
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.errors.length, 1); assert.equal(h.errors[0].source, 'update');
  h.streams[0].onCorrections([bar]); assert.equal(h.errors.length, 1);
});

test('rapid period opens apply only the newest response and abort obsolete requests', async () => {
  const h = harness();
  const first = h.session.open('1m');
  const second = h.session.open('1M');
  const third = h.session.open('5m');
  assert.deepEqual(h.resets, ['1m', '1M', '5m']);
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.requests[2].signal.aborted, false);
  h.requests[1].resolve(page('1M'));
  await second;
  h.requests[0].resolve(page('1m'));
  await first;
  assert.equal(h.session.loading, true);
  assert.equal(h.session.ready, false);
  assert.deepEqual(h.histories, []);
  h.requests[2].resolve(page('5m'));
  await third;
  assert.equal(h.session.loading, false);
  assert.equal(h.session.ready, true);
  assert.equal(h.histories.length, 1);
  assert.equal(h.histories[0].value.periodId, '5m');
  assert.equal(h.histories[0].initial, true);
});

test('obsolete failures and finally handlers cannot alter the newer loading state', async () => {
  const h = harness();
  const obsolete = h.session.open('1m');
  const current = h.session.open('1h');
  const count = h.changes.length;
  h.requests[0].reject(new Error('Obsolete failure'));
  await obsolete;
  assert.equal(h.session.loading, true);
  assert.equal(h.session.period, '1h');
  assert.equal(h.changes.length, count);
  assert.deepEqual(h.errors, []);
  h.requests[1].resolve(page('1h'));
  await current;
});

test('failed initial history remains retryable and only successful application marks ready', async () => {
  const h = harness();
  const opening = h.session.open('15m');
  h.requests[0].reject(new Error('Network unavailable'));
  await opening;
  assert.equal(h.session.loading, false);
  assert.equal(h.session.ready, false);
  assert.equal(h.session.hasMore, true);
  assert.equal(h.errors[0].source, 'history');
  h.session.toggleReplay();
  assert.equal(h.streams.length, 0);
  const retry = h.session.load();
  assert.equal(h.requests[1].periodId, '15m');
  assert.equal(h.requests[1].limit, 500);
  h.requests[1].resolve(page('15m'));
  await retry;
  assert.equal(h.session.ready, true);
  assert.equal(h.histories[0].initial, true);
});

test('mismatched history identity is rejected before handing data to the chart', async () => {
  const h = harness();
  const opening = h.session.open('1M');
  h.requests[0].resolve(page('1m'));
  await opening;
  assert.deepEqual(h.histories, []);
  assert.equal(h.session.ready, false);
  assert.equal(h.session.loading, false);
  assert.match(h.errors[0].error.message, /period mismatch/);
});

test('pause and resume isolate subscription callbacks even when an adapter ignores stop', async () => {
  const h = harness();
  await ready(h);
  h.session.toggleReplay();
  assert.equal(h.session.running, true);
  h.streams[0].onBars([bar], true);
  assert.deepEqual(h.bars, [{ value: [bar], partial: true }]);
  h.session.toggleReplay();
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.session.running, false);
  h.streams[0].onBars([bar], false);
  h.streams[0].onError(new Error('Late stream error'));
  assert.equal(h.bars.length, 1);
  assert.equal(h.errors.length, 0);
  h.session.toggleReplay();
  assert.equal(h.streams.length, 2);
  h.streams[0].onBars([bar], false);
  h.streams[1].onBars([bar], false);
  assert.equal(h.bars.length, 2);
  assert.equal(h.bars.at(-1).partial, false);
  h.session.dispose();
});

test('running replay survives rapid period changes and resumes only after current history', async () => {
  const h = harness();
  await ready(h);
  h.session.toggleReplay();
  const obsolete = h.session.open('1M');
  const current = h.session.open('30m');
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.streams.length, 1);
  h.streams[0].onBars([bar], true);
  h.requests[1].resolve(page('1M'));
  await obsolete;
  assert.equal(h.streams.length, 1);
  assert.equal(h.session.loading, true);
  h.requests[2].resolve(page('30m'));
  await current;
  assert.equal(h.streams.length, 2);
  assert.equal(h.streams[1].periodId, '30m');
  assert.equal(h.session.running, true);
  assert.equal(h.session.replayStarted, true);
  assert.deepEqual(h.bars, []);
  h.session.dispose();
});

test('history retry after a period-switch failure retains pending replay intent', async () => {
  const h = harness();
  await ready(h);
  h.session.toggleReplay();
  const opening = h.session.open('4h');
  h.requests[1].reject(new Error('Temporary failure'));
  await opening;
  assert.equal(h.session.running, false);
  assert.equal(h.streams.length, 1);
  const retry = h.session.load();
  h.requests[2].resolve(page('4h'));
  await retry;
  assert.equal(h.session.running, true);
  assert.equal(h.streams[1].periodId, '4h');
  h.session.dispose();
});

test('older-page loads are deduplicated, pass exclusive cursors and stop at exhaustion', async () => {
  const h = harness();
  await ready(h);
  const loading = h.session.load(bar.time);
  await h.session.load(bar.time);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].before, bar.time);
  h.requests[1].resolve(page('1m', { bars: [], hasMore: true }));
  await loading;
  assert.equal(h.histories[1].initial, false);
  assert.equal(h.session.hasMore, false);
  assert.equal(h.session.ready, true);
  await h.session.load(bar.time);
  assert.equal(h.requests.length, 2);
});

test('dispose aborts history, stops streaming and ignores every late provider event', async () => {
  const h = harness();
  await ready(h);
  h.session.toggleReplay();
  const loading = h.session.load(bar.time);
  h.session.dispose();
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.streams[0].stops, 1);
  const counts = [h.histories.length, h.bars.length, h.errors.length, h.changes.length];
  h.streams[0].onBars([bar], true);
  h.streams[0].onError(new Error('Already disposed'));
  h.requests[1].reject(new Error('Late rejection'));
  await loading;
  await h.session.open('1M');
  await h.session.load();
  assert.deepEqual([h.histories.length, h.bars.length, h.errors.length, h.changes.length], counts);
  assert.equal(h.requests.length, 2);
});

test('chart update failures stop the active stream and do not poison later subscriptions', async () => {
  let rejectUpdates = true;
  const h = harness({ bars() { if (rejectUpdates) throw new Error('Invalid batch'); } });
  await ready(h);
  h.session.toggleReplay();
  h.streams[0].onBars([bar], false);
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.errors[0].source, 'update');
  rejectUpdates = false;
  h.session.toggleReplay();
  h.streams[0].onError(new Error('Old stream'));
  h.streams[1].onBars([bar], false);
  assert.equal(h.errors.length, 1);
  assert.equal(h.bars.length, 1);
  h.session.dispose();
});

test('synchronous subscription errors still release the returned cleanup exactly once', async () => {
  const h = harness({ subscribe(stream) { stream.onError(new Error('Immediate stream failure')); },
    unsubscribe() { throw new Error('Cleanup failure'); } });
  await ready(h);
  h.session.toggleReplay();
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.errors[0].source, 'stream');
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].error.message, 'Immediate stream failure');
  h.session.dispose();
  assert.equal(h.streams[0].stops, 1);
});

test('synchronous first-bar failures release cleanup even before subscribe returns', async () => {
  const h = harness({ subscribe(stream) { stream.onBars([bar], true); },
    bars() { throw new Error('Rejected first update'); } });
  await ready(h);
  h.session.toggleReplay();
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.errors[0].source, 'update');
  assert.deepEqual(h.bars, []);
});

test('failed history application preserves retry state and empty history never starts replay', async () => {
  let rejectHistory = true;
  const h = harness({ history() { if (rejectHistory) throw new Error('Invalid history batch'); } });
  const opening = h.session.open('1d');
  h.requests[0].resolve(page('1d'));
  await opening;
  assert.equal(h.session.ready, false);
  assert.equal(h.session.hasMore, true);
  assert.equal(h.errors[0].source, 'history');
  rejectHistory = false;
  const retry = h.session.load();
  h.requests[1].resolve(page('1d', { bars: [], hasMore: false }));
  await retry;
  h.session.toggleReplay();
  assert.equal(h.session.ready, false);
  assert.equal(h.session.hasMore, false);
  assert.equal(h.streams.length, 0);
});

test('throwing subscription cleanup cannot block a period switch or leak stale events', async () => {
  const h = harness({ unsubscribe(stream) {
    stream.onBars([bar], true);
    stream.onError(new Error('Obsolete cleanup event'));
    throw new Error('Cleanup failure');
  } });
  await ready(h);
  h.session.toggleReplay();
  const older = h.session.load(bar.time);
  const opening = h.session.open('5m');
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.session.period, '5m');
  assert.equal(h.session.loading, true);
  h.requests[1].resolve(page('1m'));
  await older;
  h.requests[2].resolve(page('5m'));
  await opening;
  assert.equal(h.session.ready, true);
  assert.equal(h.session.running, true);
  assert.equal(h.streams[1].periodId, '5m');
  assert.deepEqual(h.bars, []);
  assert.deepEqual(h.errors, []);
  h.session.dispose();
  assert.equal(h.streams[0].stops, 1);
});

test('dispose completes once despite cleanup failure and ignores pending results', async () => {
  const h = harness({ unsubscribe() { throw new Error('Cleanup failure'); } });
  await ready(h);
  h.session.toggleReplay();
  const pending = h.session.load(bar.time);
  assert.doesNotThrow(() => h.session.dispose());
  assert.equal(h.requests[1].signal.aborted, true);
  assert.equal(h.session.running, false);
  h.session.dispose();
  assert.equal(h.streams[0].stops, 1);
  h.requests[1].reject(new Error('Late history failure'));
  await pending;
  h.streams[0].onBars([bar], false);
  h.streams[0].onError(new Error('Late stream failure'));
  assert.equal(h.histories.length, 1);
  assert.deepEqual(h.bars, []);
  assert.deepEqual(h.errors, []);
});

test('explicit pause reports cleanup failure once and remains resumable', async () => {
  const h = harness({ unsubscribe() { throw new Error('Cleanup failure'); } });
  await ready(h);
  h.session.toggleReplay();
  assert.doesNotThrow(() => h.session.toggleReplay());
  assert.equal(h.session.running, false);
  assert.equal(h.streams[0].stops, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].source, 'stream');
  assert.equal(h.errors[0].error.message, 'Cleanup failure');
  h.session.toggleReplay();
  assert.equal(h.session.running, true);
  assert.equal(h.streams.length, 2);
  h.session.dispose();
  assert.equal(h.errors.length, 1);
});
