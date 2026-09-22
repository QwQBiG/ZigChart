import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SYMBOL, SAMPLE_CATALOG, findSampleInstrument } from '../web/src/data/catalog.ts';
import { SampleFeed, SAMPLE_START, HISTORY_COUNT, instrument, sampleBar, replayBar } from '../web/src/data/sample-feed.ts';
import { DAY_MS, MINUTE_MS } from '../web/src/data/periods.ts';
import { MarketSession } from '../web/src/data/session.ts';

const symbols = SAMPLE_CATALOG.map(entry => entry.instrument.symbol);
const aggregate = (bars, time) => ({ time, open: bars[0].open, close: bars.at(-1).close,
  high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)),
  volume: bars.reduce((sum, bar) => sum + bar.volume, 0) });

test('sample catalog preserves the default series and exposes distinct deterministic integer-price profiles', () => {
  assert.deepEqual(symbols, ['ZIG/USD', 'DEMO:STOCK', 'DEMO:FX', 'DEMO:INDEX']);
  assert.deepEqual(SAMPLE_CATALOG.map(entry => entry.instrument.priceScale), [100, 100, 100000, 10]);
  assert.equal(instrument, findSampleInstrument(DEFAULT_SYMBOL).instrument);
  assert.deepEqual(sampleBar(0), { time: 1640995200000, open: 4197794, close: 4199015, high: 4200142, low: 4196849, volume: 3046 });
  assert.deepEqual(sampleBar(HISTORY_COUNT - 1), { time: 1768291140000, open: 4092924, close: 4093468, high: 4096242, low: 4090524, volume: 894 });
  assert.deepEqual(replayBar(0), { time: 1768291200000, open: 4093468, close: 4093495, high: 4093495, low: 4093468, volume: 1650 });
  for (const entry of SAMPLE_CATALOG) {
    assert.ok(entry.labels.en.includes('Simulated')); assert.ok(entry.labels['zh-CN'].includes('模拟'));
    assert.equal(entry.instrument.intervalMs, MINUTE_MS); assert.equal(entry.instrument.volumeScale, 1);
    for (const index of [0, 1, 12345, HISTORY_COUNT - 1]) {
      const row = sampleBar(index, entry.instrument.symbol);
      assert.deepEqual(row, sampleBar(index, entry.instrument.symbol));
      assert.ok(Object.values(row).every(Number.isSafeInteger));
      assert.ok(row.low > 0 && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close));
      assert.equal(row.open, sampleBar(index - 1, entry.instrument.symbol).close);
      assert.ok(row.volume > 0 && Math.max(row.high, row.volume) <= 1e12);
    }
  }
  assert.equal(new Set(symbols.map(symbol => sampleBar(12345, symbol).close)).size, symbols.length);
  for (const unknown of ['UNKNOWN', 'toString', 'constructor']) {
    assert.equal(findSampleInstrument(unknown), undefined);
    assert.throws(() => new SampleFeed(unknown), /Unknown sample instrument/);
    assert.throws(() => sampleBar(1, unknown), /Unknown sample instrument/);
    assert.throws(() => replayBar(0, unknown), /Unknown sample instrument/);
  }
});

test('sample sources aggregate their own raw profiles and keep daily caches and replay clocks isolated', async () => {
  const feeds = symbols.map(symbol => new SampleFeed(symbol));
  const start = SAMPLE_START + DAY_MS, before = start + DAY_MS;
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i], symbol = symbols[i], expected = aggregate(Array.from({ length: 1440 }, (_, n) => sampleBar(1440 + n, symbol)), start);
    const daily = await feed.getHistory('1d', before, 1);
    assert.deepEqual(daily.bars, [expected]);
    assert.deepEqual((await feed.getHistory('1d', before, 1)).bars, [expected]);
    const latest = await feed.getHistory('1m', undefined, 1);
    assert.deepEqual(latest.bars, [sampleBar(HISTORY_COUNT - 1, symbol)]);
    feed.replay.seek(start + 15000);
    const replay = await feed.getHistory('1d', undefined, 1), final = sampleBar(1440, symbol);
    const close = Math.round(final.open + (final.close - final.open) / 4);
    assert.deepEqual(replay.bars, [{ ...final, close, high: Math.max(final.open, close), low: Math.min(final.open, close), volume: Math.round(final.volume / 4) }]);
    assert.equal(replay.asOf, start + 15000);
    assert.deepEqual((await feed.replay.advance('1m')).bars, [final]);
    assert.ok(feeds.slice(i + 1).every(other => !other.replay.state.active));
    feed.replay.reset();
    assert.deepEqual((await feed.getHistory('1d', before, 1)).bars, [expected]);
  }
});

test('simulated tick updates retain each selected instrument profile', async context => {
  const timers = [];
  context.mock.method(globalThis, 'setTimeout', callback => { timers.push(callback); return timers.length; });
  context.mock.method(globalThis, 'clearTimeout', () => {});
  for (const symbol of symbols) {
    const updates = [], errors = [], feed = new SampleFeed(symbol);
    const stop = feed.subscribe('1m', bars => updates.push(bars[0]), error => errors.push(error));
    timers.shift()(); timers.shift()(); stop(); timers.length = 0;
    assert.deepEqual(updates, [sampleBar(HISTORY_COUNT - 1, symbol), replayBar(0, symbol)]);
    assert.deepEqual(errors, []);
    assert.deepEqual((await feed.getHistory('1m', undefined, 1)).bars, [replayBar(0, symbol)]);
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const page = (periodId, price = 100, extra = {}) => ({ periodId, bars: [{ time: SAMPLE_START, open: price, close: price,
  high: price + 1, low: price - 1, volume: 10 }], partialLastBar: false, hasMore: true, ...extra });
function provider(cleanup = () => {}) {
  const requests = [], streams = [];
  return { requests, streams,
    getHistory(periodId, before, limit, signal) {
      const request = { ...deferred(), periodId, before, signal }; requests.push(request); return request.promise;
    },
    subscribe(periodId, bars, error, corrections) {
      const stream = { bars, error, corrections, stopped: false }; streams.push(stream);
      return () => { stream.stopped = true; cleanup(stream); };
    },
  };
}
function sessionFor(feed) {
  const history = [], bars = [], corrections = [], errors = [];
  const session = new MarketSession(feed, { reset() {}, change() {},
    history: result => history.push(result), bars: result => bars.push(result), corrections: result => corrections.push(result),
    error: (error, source) => errors.push({ error, source }) });
  return { session, history, bars, corrections, errors };
}

test('source replacement invalidates old history and callbacks before throwing unsubscribe cleanup', async () => {
  const retired = provider(stream => {
    stream.bars(page('1m', 999).bars, false); stream.corrections(page('1m', 999).bars);
    stream.error(new Error('Retired stream callback')); throw new Error('Retired unsubscribe failure');
  });
  const next = provider(), h = sessionFor(retired), { session } = h;
  const opening = session.open('1m'); retired.requests[0].resolve(page('1m')); await opening;
  session.setReplaySpeed(5); session.toggleReplay();
  const oldStream = retired.streams[0], pending = session.load(SAMPLE_START);
  const replacing = session.replaceSource(next, '5m');
  assert.equal(retired.requests[1].signal.aborted, true); assert.equal(oldStream.stopped, true);
  assert.equal(session.period, '5m'); assert.equal(session.replaySpeed, 1);
  assert.equal(session.running, false); assert.equal(session.replayStarted, false); assert.equal(session.stepping, false);
  oldStream.bars(page('1m', 999).bars, false); oldStream.corrections(page('1m', 999).bars);
  oldStream.error(new Error('Late stream error')); retired.requests[1].reject(new Error('Late history error')); await pending;
  assert.equal(session.loading, true); assert.deepEqual(h.errors, []);
  assert.deepEqual(h.bars, []); assert.deepEqual(h.corrections, []); assert.equal(h.history.length, 1);
  next.requests[0].resolve(page('5m', 200)); await replacing;
  assert.equal(session.ready, true); assert.equal(session.running, false); assert.equal(next.streams.length, 0);
  assert.equal(h.history.at(-1).bars[0].close, 200);
  session.toggleReplay(); assert.equal(next.streams.length, 1);
  next.streams[0].bars(page('5m', 210).bars, true);
  assert.equal(h.bars[0][0].close, 210); session.dispose();
});

test('rapid replacement clears queued resume and historical cursor and delivers only the newest snapshot', async () => {
  const first = provider(), middle = provider(), last = provider(), h = sessionFor(first), { session } = h;
  const opening = session.open('1m'); first.requests[0].resolve(page('1m')); await opening;
  session.toggleReplay();
  const periodChange = session.open('1h');
  const middleOpen = session.replaceSource(middle);
  const lastOpen = session.replaceSource(last, '15m');
  first.requests[1].resolve(page('1h', 1000)); middle.requests[0].resolve(page('1h', 2000));
  await periodChange; await middleOpen;
  assert.equal(session.loading, true); assert.equal(h.history.length, 1);
  last.requests[0].resolve(page('15m', 300)); await lastOpen;
  assert.equal(session.period, '15m'); assert.equal(session.running, false); assert.equal(last.streams.length, 0);
  const historical = session.open('15m', SAMPLE_START + MINUTE_MS);
  last.requests[1].resolve(page('15m', 310)); await historical;
  assert.equal(session.browsingHistory, true);
  const reset = session.replaceSource(middle);
  assert.equal(session.historyBefore, undefined); assert.equal(middle.requests[1].before, undefined);
  middle.requests[1].resolve(page('15m', 400)); await reset;
  assert.equal(session.running, false); assert.equal(h.history.at(-1).bars[0].close, 400);
  session.dispose(); await session.replaceSource(first);
  assert.equal(first.requests.length, 2);
});

test('source replacement aborts a pending replay step and resets playback state without delivering its result', async () => {
  const retired = provider(), next = provider(), step = deferred();
  let signal;
  const state = { active: true, cutoff: SAMPLE_START + MINUTE_MS, end: SAMPLE_START + 10 * MINUTE_MS };
  retired.replay = { get state() { return { ...state }; }, seek() {}, reset() {},
    advance(period, abort) { signal = abort; return step.promise; } };
  const h = sessionFor(retired), { session } = h;
  const opening = session.open('1m'); retired.requests[0].resolve(page('1m', 100, { asOf: state.cutoff })); await opening;
  session.setReplaySpeed(10); session.toggleReplay();
  const advancing = session.stepReplay(); assert.equal(session.stepping, true);
  const replacing = session.replaceSource(next);
  assert.equal(signal.aborted, true); assert.equal(session.stepping, false);
  assert.equal(session.replayState, null); assert.equal(session.replayStarted, false); assert.equal(session.replaySpeed, 1);
  state.cutoff += MINUTE_MS; step.resolve(page('1m', 999, { asOf: state.cutoff })); await advancing;
  assert.deepEqual(h.bars, []); assert.deepEqual(h.errors, []);
  next.requests[0].resolve(page('1m', 200)); await replacing;
  assert.equal(session.running, false); assert.equal(h.history.at(-1).bars[0].close, 200); session.dispose();
});
