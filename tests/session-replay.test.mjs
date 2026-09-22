import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketSession } from '../web/src/data/session.ts';
import { bucketStart, nextBucketStart } from '../web/src/data/periods.ts';

const minute = 60_000, base = Date.UTC(2026, 0, 1), end = base + 10 * minute;
const bar = time => ({ time, open: 100, high: 110, low: 90, close: 105, volume: 20 });
const settled = () => new Promise(resolve => setImmediate(resolve));
function fixture(context) {
  let state = { active: false, cutoff: end, end }, streams = 0, stops = 0, nextTimer = 0;
  const timers = new Map(), steps = [], histories = [], updates = [], errors = [];
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++nextTimer; timers.set(id, { callback, delay }); return id;
  });
  context.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const feed = {
    replay: {
      get state() { return { ...state }; },
      seek(cutoff) { state = { active: true, cutoff, end }; },
      reset() { state = { active: false, cutoff: end, end }; },
      advance(periodId, signal) {
        const target = Math.min(nextBucketStart(state.cutoff, periodId), end);
        return new Promise((resolve, reject) => steps.push({ signal, periodId, reject,
          complete() {
            if (!signal.aborted) state.cutoff = target;
            resolve({ periodId, bars: [bar(bucketStart(target - 1, periodId))], asOf: target,
              partialLastBar: nextBucketStart(target - 1, periodId) > target, hasMore: true });
          } }));
      },
    },
    async getHistory(periodId, before) {
      return { periodId, asOf: state.cutoff, bars: [bar(bucketStart(Math.min(state.cutoff, before ?? Infinity) - 1, periodId))],
        hasMore: true, partialLastBar: nextBucketStart(state.cutoff - 1, periodId) > state.cutoff };
    },
    subscribe() { streams++; return () => { stops++; }; },
  };
  const session = new MarketSession(feed, { reset() {}, history: page => histories.push(page),
    bars: (bars, partial) => updates.push({ bars, partial }), corrections() {}, change() {},
    error: (error, source) => errors.push({ error, source }) });
  context.after(() => session.dispose());
  return { session, feed, timers, steps, histories, updates, errors,
    subscriptions: () => ({ streams, stops }),
    tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
  };
}

test('enter, serial manual steps, cross-period reload and exit share one cutoff and remain paused', async context => {
  const f = fixture(context); await f.session.open('1m');
  f.session.toggleReplay(); assert.equal(f.subscriptions().streams, 1);
  await f.session.enterReplay(base + 2 * minute);
  assert.equal(f.session.running, false); assert.equal(f.subscriptions().stops, 1);
  assert.equal(f.histories.at(-1).asOf, base + 2 * minute);
  const first = f.session.stepReplay(); assert.equal(f.session.stepping, true);
  await f.session.stepReplay(); assert.equal(f.steps.length, 1);
  f.steps[0].complete(); await first;
  assert.equal(f.session.stepping, false); assert.equal(f.updates.length, 1);
  assert.equal(f.updates[0].bars[0].time, base + 2 * minute);
  await f.session.open('5m');
  assert.equal(f.histories.at(-1).asOf, base + 3 * minute); assert.equal(f.session.running, false);
  assert.equal(f.histories.at(-1).partialLastBar, true);
  await f.session.exitReplay();
  assert.equal(f.session.replayState.active, false); assert.equal(f.histories.at(-1).asOf, end);
  assert.equal(f.session.running, false); assert.deepEqual(f.errors, []);
});

test('automatic speed changes, pause cancellation, period resume and final delivery use one scheduler', async context => {
  const f = fixture(context); await f.session.enterReplay(base + 7 * minute);
  f.session.toggleReplay(); assert.equal([...f.timers.values()][0].delay, 1000);
  f.session.setReplaySpeed(5); assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].delay, 200);
  assert.throws(() => f.session.setReplaySpeed(3), /Unsupported/);
  f.tick(); assert.equal(f.session.stepping, true);
  f.session.toggleReplay(); assert.equal(f.steps[0].signal.aborted, true);
  f.steps[0].complete(); await settled();
  assert.equal(f.updates.length, 0); assert.equal(f.session.replayState.cutoff, base + 7 * minute);
  f.session.toggleReplay(); await f.session.open('5m');
  assert.equal(f.session.running, true); assert.equal(f.timers.size, 1); assert.equal(f.subscriptions().streams, 0);
  f.tick(); f.steps[1].complete(); await settled();
  assert.equal(f.updates.length, 1); assert.equal(f.updates[0].bars[0].time, base + 5 * minute);
  assert.equal(f.session.replayState.cutoff, end); assert.equal(f.session.running, false); assert.equal(f.timers.size, 0);
  f.session.toggleReplay(); assert.equal(f.session.running, false); assert.deepEqual(f.errors, []);
});

test('history cursors block playback, failures are reported and disposal suppresses late step delivery', async context => {
  const f = fixture(context); await f.session.enterReplay(base + 2 * minute);
  await f.session.open('1m', base + minute); f.session.toggleReplay(); await f.session.stepReplay();
  assert.equal(f.timers.size, 0); assert.equal(f.steps.length, 0);
  await f.session.open('1m');
  const failure = f.session.stepReplay(); f.steps[0].reject(new Error('Replay unavailable')); await failure;
  assert.equal(f.session.running, false); assert.equal(f.session.stepping, false);
  assert.equal(f.errors[0].source, 'stream'); assert.match(f.errors[0].error.message, /Replay unavailable/);
  const paused = f.session.stepReplay(); f.session.pauseReplay();
  assert.equal(f.steps[1].signal.aborted, true); f.steps[1].complete(); await paused;
  const pending = f.session.stepReplay(); f.session.dispose();
  assert.equal(f.steps[2].signal.aborted, true); f.steps[2].complete(); await pending;
  assert.equal(f.updates.length, 0); assert.equal(f.errors.length, 1); assert.equal(f.timers.size, 0);
});

test('replay history rejects missing, mismatched and future cutoffs using request-time state', async context => {
  const f = fixture(context), cutoff = base + 2 * minute;
  for (const invalid of [{ asOf: undefined }, { asOf: end }, { bars: [bar(cutoff)] }]) {
    f.feed.getHistory = async periodId => ({ periodId, asOf: cutoff, bars: [bar(base)],
      hasMore: true, partialLastBar: false, ...invalid });
    await f.session.enterReplay(cutoff);
    assert.equal(f.session.ready, false); assert.equal(f.histories.length, 0);
    assert.equal(f.errors.at(-1).source, 'history');
  }
  let resolve;
  f.feed.getHistory = () => new Promise(done => { resolve = done; });
  const opening = f.session.enterReplay(cutoff);
  f.feed.replay.seek(cutoff + minute);
  resolve({ periodId: '1m', asOf: cutoff + minute, bars: [bar(base)], hasMore: true, partialLastBar: false });
  await opening;
  assert.equal(f.histories.length, 0); assert.equal(f.errors.length, 4);
});

test('older history temporarily defers playback and explicit pause cancels period-load resume', async context => {
  const f = fixture(context); await f.session.enterReplay(base + 2 * minute); f.session.toggleReplay();
  let resolve;
  f.feed.getHistory = () => new Promise(done => { resolve = done; });
  const loading = f.session.load(base + minute);
  f.tick(); assert.equal(f.steps.length, 0); assert.equal(f.timers.size, 1);
  resolve({ periodId: '1m', asOf: base + 2 * minute, bars: [bar(base)], hasMore: true, partialLastBar: false });
  await loading; f.tick(); assert.equal(f.steps.length, 1);
  f.steps[0].complete(); await settled(); assert.equal(f.session.running, true);
  const switching = f.session.open('5m'); f.session.pauseReplay();
  resolve({ periodId: '5m', asOf: base + 3 * minute, bars: [bar(base)], hasMore: true, partialLastBar: true });
  await switching;
  assert.equal(f.session.running, false); assert.equal(f.timers.size, 0); assert.deepEqual(f.errors, []);
});
