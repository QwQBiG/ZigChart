import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { sampleBar } from '../web/src/data/sample-feed.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const create = async () => { const core = await ChartCore.create(bytes); core.configureIndicators(20, 20, 7); return core; };
const bars = (start, count) => Array.from({ length: count }, (_, i) => sampleBar(start + i));

test('real Wasm: warmup and independent indicator reference', async () => {
  const core = await create();
  const data = bars(100, 80);
  core.apply('replace', data);
  assert.ok(Number.isNaN(core.inspect(18).ma));
  assert.ok(Number.isNaN(core.inspect(18).ema));
  let ema = data.slice(0, 20).reduce((sum, bar) => sum + bar.close, 0) / 20;
  for (let i = 19; i < data.length; i++) {
    const ma = data.slice(i - 19, i + 1).reduce((sum, bar) => sum + bar.close, 0) / 20;
    if (i > 19) ema += 2 / 21 * (data[i].close - ema);
    assert.ok(Math.abs(core.inspect(i).ma - ma) < 1e-7);
    assert.ok(Math.abs(core.inspect(i).ema - ema) < 1e-7);
  }
});

test('atomic updates reject malformed values, duplicates and historical revisions', async () => {
  const core = await create();
  core.apply('replace', bars(100, 40));
  const last = core.inspect(39);
  assert.throws(() => core.apply('upsert', [sampleBar(140), { ...sampleBar(141), high: NaN }]));
  assert.throws(() => core.apply('upsert', [sampleBar(138)]));
  assert.throws(() => core.apply('prepend', [sampleBar(100)]));
  assert.throws(() => core.apply('replace', [sampleBar(1), sampleBar(1)]));
  assert.throws(() => core.apply('replace', [{ ...sampleBar(1), close: 1.25 }]));
  assert.equal(core.count, 40);
  assert.deepEqual(core.inspect(39), last);
});

test('runtime mode validation rejects inherited names without replacing data', async () => {
  const core = await create();
  core.apply('replace', bars(100, 40));
  const before = core.frame(900, 500);
  for (const mode of ['toString', 'constructor', '__proto__', 'unknown']) {
    assert.throws(() => core.apply(mode, [sampleBar(500)]), /Unknown update mode/);
    assert.equal(core.count, 40);
    assert.deepEqual(core.frame(900, 500), before);
  }
});

test('sparse batches and coercible fields cannot reuse input memory or mutate data', async () => {
  const core = await create();
  core.apply('replace', bars(100, 40));
  const before = core.frame(900, 500);
  const batches = [new Array(1), [sampleBar(0), , sampleBar(2)], [null],
    [{ ...sampleBar(0), volume: null }], [{ ...sampleBar(0), open: '4200000' }]];
  for (const batch of batches) {
    assert.throws(() => core.apply('replace', batch), /snapshot|numbers/);
    assert.equal(core.count, 40);
    assert.deepEqual(core.frame(900, 500), before);
  }
});

test('repeated final-bar updates match complete snapshot and preserve borrowed results', async () => {
  const core = await create();
  const fresh = await create();
  const data = bars(0, 120);
  core.apply('replace', data);
  const frame = core.frame(900, 500);
  const copied = frame.rows.slice();
  const revised = { ...data[119], close: data[119].high, volume: 12345 };
  core.apply('upsert', [revised]);
  core.apply('upsert', [revised, sampleBar(120)]);
  fresh.apply('replace', [...data.slice(0, 119), revised, sampleBar(120)]);
  assert.deepEqual(core.inspect(119), fresh.inspect(119));
  assert.deepEqual(core.inspect(120), fresh.inspect(120));
  core.frame(200, 100);
  assert.deepEqual(frame.rows, copied);
});

test('history maintains timestamp anchor, panes share X and hit testing', async () => {
  const core = await create();
  core.apply('replace', bars(300, 300));
  core.setView(50, 120);
  const before = core.frame(900, 500);
  core.apply('prepend', bars(0, 300));
  const after = core.frame(900, 500);
  assert.equal(after.meta[8], before.meta[8] + 300);
  assert.equal(after.rows[1], before.rows[1]);
  assert.equal(after.rows[9], before.rows[9]);
  const row = after.rows.slice(17 * 50, 17 * 51);
  assert.equal(core.hit(row[9], 900), row[0]);
  assert.ok(row[14] >= after.meta[5] && row[14] <= after.meta[6]);
  core.zoom(2, 0.5);
  assert.equal(core.frame(900, 500).meta[9], 60);
  const start = core.frame(900, 500).meta[8];
  core.apply('upsert', [sampleBar(600)]);
  assert.equal(core.frame(900, 500).meta[8], start);
  core.follow();
  assert.equal(core.frame(900, 500).meta[8], 552.5);
});

test('real Wasm: right whitespace survives live updates and prepended history', async () => {
  const core = await create();
  core.apply('replace', bars(100, 200));
  let frame = core.frame(1000, 600);
  assert.equal(frame.meta[8], 103.5);
  assert.equal(frame.rows.at(-8), 800);
  assert.equal(core.hit(900, 1000), -1);
  core.setView(127.5, 120);
  frame = core.frame(1000, 600);
  assert.equal(frame.rows.at(-8), 600);
  const revised = { ...sampleBar(299), close: sampleBar(299).high };
  core.apply('upsert', [revised]);
  assert.equal(core.frame(1000, 600).meta[8], 127.5);
  core.apply('upsert', [revised, sampleBar(300), sampleBar(301)]);
  frame = core.frame(1000, 600);
  assert.equal(frame.meta[8], 129.5);
  assert.equal(frame.rows.at(-8), 600);
  const newestTime = frame.rows.at(-16);
  core.apply('prepend', bars(80, 20));
  frame = core.frame(1000, 600);
  assert.equal(frame.meta[8], 149.5);
  assert.equal(frame.rows.at(-16), newestTime);
  assert.equal(frame.rows.at(-8), 600);
  core.pan(10000);
  core.apply('upsert', [sampleBar(302)]);
  frame = core.frame(1000, 600);
  assert.equal(frame.rows.at(-8), 500);
  assert.equal(frame.rows.at(-17), core.count - 1);
  assert.equal(core.hit(750, 1000), -1);
  core.follow();
  assert.equal(core.frame(1000, 600).rows.at(-8), 800);
});

test('real Wasm: zooming over blank future space preserves the pointer anchor', async () => {
  const core = await create();
  core.apply('replace', bars(100, 200));
  const before = core.frame(1000, 600);
  const anchor = before.meta[8] + before.meta[9] * 0.9;
  core.zoom(2, 0.9);
  const after = core.frame(1000, 600);
  assert.equal(after.meta[8] + after.meta[9] * 0.9, anchor);
  assert.equal(after.rows.length, 43 * 17);
  assert.equal(after.rows.at(-17), 199);
  assert.equal(after.rows.at(-8), 700);
  assert.equal(core.hit(900, 1000), -1);
});

test('real Wasm: first live batch and short datasets have safe viewport bounds', async () => {
  const core = await create();
  core.pan(10000);
  assert.equal(core.frame(1000, 600).rows.length, 0);
  assert.equal(core.hit(500, 1000), -1);
  core.apply('upsert', bars(100, 200));
  assert.equal(core.frame(1000, 600).meta[8], 103.5);
  core.apply('replace', bars(100, 3));
  core.setView(10000, 2000);
  const frame = core.frame(1000, 600);
  assert.equal(frame.meta[8], 0);
  assert.equal(frame.rows.length, 3 * 17);
  assert.ok([...frame.meta].every(Number.isFinite));
  assert.equal(core.hit(500, 1000), -1);
});

test('real Wasm: maximum frame buffers remain bounded with future whitespace', async () => {
  const core = await create();
  core.apply('replace', bars(0, 100000));
  core.setView(90000.25, 2000);
  assert.equal(core.frame(1000, 600).rows.length, 2001 * 17);
  core.pan(100000);
  const frame = core.frame(1000, 600);
  assert.equal(frame.rows.length, 1001 * 17);
  assert.equal(frame.rows.at(-17), 99999);
  assert.equal(frame.rows.at(-8), 500);
  assert.equal(core.hit(750, 1000), -1);
});

test('empty and flat zero-volume snapshots remain finite; instances are isolated', async () => {
  const core = await create();
  const other = await create();
  core.apply('replace', bars(0, 25).map(bar => ({ ...bar, open: -100, high: -100, low: -100, close: -100, volume: 0 })));
  const frame = core.frame(800, 400);
  assert.ok([...frame.meta].every(Number.isFinite));
  assert.ok(frame.meta[1] > frame.meta[0]);
  assert.equal(other.count, 0);
  assert.equal(core.inspect(-1), null);
  core.apply('replace', []);
  assert.equal(core.frame(800, 400).rows.length, 0);
});

test('real Wasm: panning only translates candles and retains price and volume scales', async () => {
  const core = await create();
  const data = bars(100, 300);
  data[90] = { ...data[90], volume: 1000000000 };
  core.apply('replace', data);
  core.setView(80, 100);
  const before = core.frame(1000, 600);
  const candle = before.rows.slice(50 * 17, 51 * 17);
  core.pan(20);
  const after = core.frame(1000, 600);
  const moved = after.rows.slice(30 * 17, 31 * 17);
  assert.deepEqual(after.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.equal(after.meta[7], before.meta[7]);
  assert.equal(after.meta[9], before.meta[9]);
  assert.equal(moved[1], candle[1]);
  assert.equal(moved[9], candle[9] - 200);
  assert.deepEqual(moved.slice(10), candle.slice(10));
  const resized = core.frame(700, 1200);
  assert.deepEqual(resized.meta.slice(0, 3), before.meta.slice(0, 3));
  for (let column = 10; column < 17; column++) {
    assert.equal(resized.rows[30 * 17 + column], candle[column] * 2);
  }
});

test('real Wasm: panning before rendering has stable bounds through history and live updates', async () => {
  const core = await create();
  const reference = await create();
  for (const instance of [core, reference]) {
    instance.apply('replace', bars(100, 300));
    instance.setView(80, 100);
  }
  const original = reference.frame(1000, 600);
  core.pan(20);
  const before = core.frame(1000, 600);
  assert.deepEqual(before.meta.slice(0, 3), original.meta.slice(0, 3));
  core.apply('prepend', bars(80, 20));
  core.apply('upsert', [{ ...sampleBar(400), open: 20000000, high: 30000000,
    low: 10000000, close: 25000000, volume: 1000000000 }]);
  const after = core.frame(1000, 600);
  assert.deepEqual(after.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.equal(after.meta[8], before.meta[8] + 20);
  assert.equal(after.rows[1], before.rows[1]);
  assert.deepEqual(after.rows.slice(9, 15), before.rows.slice(9, 15));
  assert.notEqual(after.rows[8], before.rows[8]);
});

test('real Wasm: locked latest updates preserve geometry and explicit zoom or Latest refits', async () => {
  const core = await create();
  core.apply('replace', bars(100, 300));
  const before = core.frame(1000, 600);
  core.pan(10000);
  const extreme = { ...sampleBar(399), open: 20000000, high: 30000000,
    low: 10000000, close: 25000000, volume: 1000000000 };
  core.apply('upsert', [extreme]);
  assert.deepEqual(core.frame(1000, 600).meta.slice(0, 3), before.meta.slice(0, 3));
  core.apply('upsert', [{ ...extreme, time: sampleBar(400).time }]);
  let after = core.frame(1000, 600);
  assert.deepEqual(after.meta.slice(0, 3), before.meta.slice(0, 3));
  assert.equal(after.rows.at(-8), 500);
  assert.ok(after.rows.at(-6) < after.meta[3]);
  assert.ok(after.rows.at(-3) < after.meta[5]);
  core.zoom(2, .5);
  after = core.frame(1000, 600);
  assert.ok(after.meta[1] > extreme.high);
  assert.equal(after.meta[2], extreme.volume);
  core.pan(-10);
  core.follow();
  after = core.frame(1000, 600);
  assert.equal(after.rows.at(-8), 800);
  assert.ok(after.meta[1] > extreme.high);
});

test('real Wasm: no-op pans retain automatic scaling and empty replacement clears locks', async () => {
  const core = await create();
  const extreme = { ...sampleBar(399), open: 20000000, high: 30000000,
    low: 10000000, close: 25000000, volume: 1000000000 };
  for (const delta of [0, NaN, Infinity, -10000]) {
    core.apply('replace', bars(100, 300));
    core.setView(0, 2000);
    core.pan(delta);
    core.apply('upsert', [extreme]);
    const frame = core.frame(1000, 600);
    assert.ok(frame.meta[1] > extreme.high);
    assert.equal(frame.meta[2], extreme.volume);
  }
  core.setView(80, 100);
  core.pan(20);
  core.apply('replace', []);
  core.pan(20);
  assert.equal(core.frame(1000, 600).rows.length, 0);
  core.apply('upsert', [{ ...sampleBar(1000), open: -10000, high: -9990, low: -10010, close: -10000 }]);
  const frame = core.frame(1000, 600);
  assert.ok(frame.meta[0] < -10000 && frame.meta[1] > -10000);
  assert.ok([...frame.meta].every(Number.isFinite));
});
