import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { customRange, formatUtcDate, parseUtcDate, rangeStart, rangePeriod } from '../web/src/features/range/model.ts';
import { RangeController } from '../web/src/features/range/controller.ts';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { sampleBar, SampleFeed } from '../web/src/data/sample-feed.ts';
import { bucketStart, DAY_MS } from '../web/src/data/periods.ts';

test('range calendar clamps month ends and chooses readable real resolutions', () => {
  const end = Date.UTC(2024, 2, 31, 8);
  assert.equal(rangeStart('1M', end), Date.UTC(2024, 1, 29, 8));
  assert.equal(rangeStart('1Y', Date.UTC(2024, 1, 29)), Date.UTC(2023, 1, 28));
  assert.equal(rangeStart('YTD', end), Date.UTC(2024, 0, 1));
  assert.equal(rangeStart('5D', end), end - 5 * DAY_MS);
  assert.equal(rangePeriod('1D', end, 760), '15m');
  assert.equal(rangePeriod('1Y', end, 760), '1w');
  assert.equal(rangePeriod('All', end, 760), '1M');
  assert.throws(() => rangeStart('1D', NaN));
});

test('custom dates validate Gregorian UTC days and cap inclusive dates at the market cutoff', () => {
  const leap = Date.UTC(2024, 1, 29), cutoff = leap + 12 * 60 * 60_000;
  assert.equal(parseUtcDate('2024-02-29'), leap);
  assert.equal(parseUtcDate('1970-01-01'), 0);
  assert.equal(formatUtcDate(leap + DAY_MS - 1), '2024-02-29');
  for (const text of ['2023-02-29', '2024-04-31', '2024-00-01', '2024-13-01', '1969-12-31', '10000-01-01', '2024-2-01', ' 2024-02-01']) {
    assert.equal(parseUtcDate(text), null, text);
  }
  assert.equal(formatUtcDate(NaN), '');
  assert.equal(formatUtcDate(Date.UTC(10000, 0, 1)), '');
  assert.deepEqual(customRange('2024-02-28', '2024-02-28', cutoff), { from: leap - DAY_MS, to: leap });
  assert.deepEqual(customRange('2024-02-29', '2024-03-31', cutoff), { from: leap, to: cutoff });
  assert.equal(customRange('2024-03-01', '2024-03-01', cutoff), null);
  assert.equal(customRange('2024-02-29', '2024-02-28', cutoff), null);
  assert.equal(customRange('2024-02-28', '2024-02-29', NaN), null);
});

test('custom ranges fetch an old target directly, include its first bucket and reject invalid changes', async () => {
  const cutoff = Date.UTC(2026, 0, 13), from = Date.UTC(2024, 1, 29, 0, 7), to = Date.UTC(2024, 2, 1);
  const opens = [], fits = [];
  let first = 0, loads = 0;
  const controller = new RangeController({ cutoff: () => cutoff, width: () => 760,
    open: async (period, before) => { opens.push([period, before]); first = bucketStart(from, period); },
    first: () => first, hasMore: () => false, load: async () => { loads++; },
    fit: (start, end) => { fits.push([start, end]); return 0; }, change() {} });
  await controller.custom(from, to);
  assert.deepEqual(opens, [['15m', to]], 'The first request targets the exclusive end, not the latest snapshot');
  assert.deepEqual(fits, [[Date.UTC(2024, 1, 29), to]]);
  assert.equal(loads, 0); assert.equal(controller.selected, 'Custom'); assert.equal(controller.status, 'ready');
  for (const [start, end] of [[to, from], [from, from], [NaN, to], [-1, to], [cutoff, cutoff + DAY_MS]]) {
    await controller.custom(start, end);
  }
  assert.equal(opens.length, 1); assert.equal(fits.length, 1); assert.equal(controller.status, 'ready');
  await controller.custom(cutoff - DAY_MS, cutoff + DAY_MS);
  assert.equal(opens[1][1], cutoff); assert.equal(fits[1][1], cutoff);
  assert.equal(controller.cutoff(), cutoff);
});

test('custom ranges distinguish absent, partial, clipped and failed history', async () => {
  let first = 5 * DAY_MS, more = false, result = 0, fits = 0;
  const host = { cutoff: () => 20 * DAY_MS, width: () => 760,
    open: async () => {}, first: () => first, hasMore: () => more, load: async () => {},
    fit: () => { fits++; return result; }, change() {} };
  const controller = new RangeController(host);
  await controller.custom(DAY_MS, 10 * DAY_MS);
  assert.equal(controller.status, 'partial');
  await controller.select('All'); assert.equal(controller.status, 'ready');
  first = null;
  await controller.custom(DAY_MS, 10 * DAY_MS);
  assert.equal(controller.status, 'empty'); assert.equal(fits, 2);
  first = 0; result = -1;
  await controller.custom(DAY_MS, 10 * DAY_MS); assert.equal(controller.status, 'empty');
  result = 1;
  await controller.custom(DAY_MS, 10 * DAY_MS); assert.equal(controller.status, 'limited');
  first = 5 * DAY_MS; more = true;
  await controller.custom(DAY_MS, 10 * DAY_MS); assert.equal(controller.status, 'error');
  assert.equal(fits, 4, 'A stalled history loader must never fit an incomplete request');
  host.open = async () => { throw new Error('Provider unavailable'); };
  await controller.custom(DAY_MS, 10 * DAY_MS); assert.equal(controller.status, 'error');
});

test('a cancelled custom history page cannot later move the shared viewport', async () => {
  let first = 5 * DAY_MS, release, fits = 0;
  const controller = new RangeController({ cutoff: () => 20 * DAY_MS, width: () => 760,
    open: async () => {}, first: () => first, hasMore: () => true,
    load: () => new Promise(resolve => { release = () => { first = 0; resolve(); }; }),
    fit: () => { fits++; return 0; }, change() {} });
  const pending = controller.custom(DAY_MS, 10 * DAY_MS);
  await Promise.resolve();
  controller.cancel(); release(); await pending;
  assert.equal(fits, 0); assert.equal(controller.status, 'idle'); assert.equal(controller.selected, null);
});

test('real Wasm time fitting respects exclusive end, absent sessions, zoom limits and shared panes', async () => {
  const core = await ChartCore.create(await readFile(new URL('../web/public/core.wasm', import.meta.url)));
  const bars = Array.from({ length: 100 }, (_, i) => ({ ...sampleBar(i), time: Date.UTC(2024, 0, 1) + i * 2 * DAY_MS }));
  core.apply('replace', bars); core.resizePlot(760); core.configureIndicators(20, 20, 4);
  assert.equal(core.fitTimeRange(bars[30].time + DAY_MS, bars[60].time), 0);
  const frame = core.frame(760, 500);
  const indices = Array.from({ length: frame.rows.length / 17 }, (_, i) => frame.rows[i * 17]);
  assert.ok(indices.includes(31) && indices.includes(59));
  assert.equal(frame.meta[9], 29 / .8, 'The exclusive end is not counted; padding may show other loaded bars');
  assert.ok(frame.panes.some(p => p.id === 1));
  assert.equal(core.fitTimeRange(bars[99].time + DAY_MS, bars[99].time + 2 * DAY_MS), -1);
  assert.deepEqual(core.frame(760, 500).meta, frame.meta);
  core.resizePlot(180);
  assert.equal(core.fitTimeRange(0, bars[99].time + 1), 1);
  assert.ok(core.frame(180, 500).meta[9] <= 30);
});

test('range controller loads earlier pages and ignores a cancelled request', async () => {
  let first = 10 * DAY_MS, more = true, fits = 0, release;
  const host = { cutoff: () => 20 * DAY_MS, width: () => 760,
    open: async () => {}, first: () => first, hasMore: () => more,
    load: async () => { first = 0; more = false; },
    fit: () => { fits++; return 0; }, change() {} };
  const controller = new RangeController(host);
  await controller.select('All');
  assert.equal(first, 0); assert.equal(fits, 1); assert.equal(controller.status, 'ready');
  host.open = () => new Promise(resolve => { release = resolve; });
  const pending = controller.select('1D'); controller.cancel(); release(); await pending;
  assert.equal(fits, 1); assert.equal(controller.status, 'idle');
  host.open = async () => {}; first = 10 * DAY_MS; more = true; host.load = async () => {};
  await controller.select('All');
  assert.equal(controller.status, 'error'); assert.equal(fits, 1);
  host.cutoff = () => null;
  host.load = async () => { first = 0; more = false; };
  await controller.select('All');
  assert.equal(controller.status, 'ready'); assert.equal(fits, 2, 'Retry retains the failed request cutoff');
});

test('sample cutoff stays identical across resolutions rather than advancing to the end of a partial month', async () => {
  const feed = new SampleFeed();
  const minute = await feed.getHistory('1m', undefined, 1);
  const day = await feed.getHistory('1d', undefined, 1);
  assert.equal(minute.asOf, day.asOf);
  assert.ok(day.asOf > day.bars[0].time && day.asOf < day.bars[0].time + DAY_MS);
});
