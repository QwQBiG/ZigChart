import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHLIST_KEY, candleChange, createWatchlist, parseWatchlist, readWatchlist, saveWatchlist, setWatched,
} from '../web/src/features/watchlist/model.ts';
import { filterInstrumentEntries } from '../web/src/features/watchlist/picker.ts';

const symbol = 'ZIG/USD';
const catalog = [symbol];

test('watchlist membership persists intentional emptiness and prevents unsupported or duplicate entries', () => {
  const initial = createWatchlist(symbol);
  const empty = setWatched(initial, symbol, false, catalog);
  assert.deepEqual(empty, { version: 1, symbols: [] });
  assert.deepEqual(parseWatchlist(empty, catalog), empty);
  assert.deepEqual(setWatched(empty, 'UNKNOWN', true, catalog), empty);
  const added = setWatched(empty, symbol, true, catalog);
  assert.deepEqual(setWatched(added, symbol, true, catalog), initial);
  assert.deepEqual(initial, { version: 1, symbols: [symbol] });
  assert.deepEqual(parseWatchlist({ version: 1, symbols: [symbol, symbol, 'UNAVAILABLE'] }, catalog), initial);
});

test('invalid saved documents cannot inject watchlist entries', () => {
  for (const value of [null, [], {}, 7, { version: 2, symbols: catalog },
    { version: 1, symbols: [3] }, { version: 1, symbols: Array(257).fill(symbol) },
    { version: 1, symbols: ['a'.repeat(101)] }]) assert.equal(parseWatchlist(value, catalog), null);
  const malformed = { getItem: () => '{broken' };
  assert.deepEqual(readWatchlist(malformed, symbol), createWatchlist(symbol));
});

test('watchlist storage round trips independently and denied storage allows session use', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const empty = { version: 1, symbols: [] };
  assert.equal(saveWatchlist(storage, empty), true);
  assert.equal(values.has(WATCHLIST_KEY), true);
  assert.deepEqual(readWatchlist(storage, symbol), empty);
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  assert.deepEqual(readWatchlist(denied, symbol), createWatchlist(symbol));
  assert.equal(saveWatchlist(denied, empty), false);
  assert.equal(saveWatchlist(undefined, empty), false);
});

test('quote deltas use the current candle open and have no percentage for a zero open', () => {
  assert.deepEqual(candleChange({ open: 10000, close: 10100 }), { units: 100, percent: 1 });
  assert.deepEqual(candleChange({ open: 10000, close: 9900 }), { units: -100, percent: -1 });
  assert.deepEqual(candleChange({ open: 0, close: 100 }), { units: 100, percent: null });
});

test('multi-symbol persistence retains order and empty membership independently from selection', () => {
  const supported = [symbol, 'DEMO:STOCK', 'DEMO:FX', 'DEMO:INDEX'];
  const saved = { version: 1, symbols: ['DEMO:FX', symbol, 'DEMO:INDEX'] };
  const storage = { getItem: () => JSON.stringify(saved) };
  assert.deepEqual(readWatchlist(storage, 'DEMO:STOCK', supported), saved);
  assert.deepEqual(setWatched(saved, symbol, true, supported), saved);
  assert.deepEqual(setWatched(saved, 'DEMO:STOCK', true, supported).symbols, [...saved.symbols, 'DEMO:STOCK']);
  assert.deepEqual(setWatched(saved, 'DEMO:FX', false, supported).symbols, [symbol, 'DEMO:INDEX']);
  assert.deepEqual(readWatchlist({ getItem: () => '{"version":1,"symbols":[]}' }, 'DEMO:FX', supported).symbols, []);
  assert.deepEqual(readWatchlist(storage, symbol), createWatchlist(symbol));
  assert.deepEqual(readWatchlist(undefined, 'UNAVAILABLE', supported).symbols, []);
});

test('catalog search matches both localized names and normalized codes without changing catalog order', () => {
  const entries = [
    { instrument: { symbol: 'ZIG/USD' }, labels: { en: 'Synthetic ZIG', 'zh-CN': '模拟 ZIG' } },
    { instrument: { symbol: 'DEMO:STOCK' }, labels: { en: 'Sample Stock', 'zh-CN': '模拟股票' } },
    { instrument: { symbol: 'DEMO:FX' }, labels: { en: 'Sample Foreign Exchange', 'zh-CN': '模拟外汇' } },
  ];
  assert.deepEqual(filterInstrumentEntries(entries, '').map(entry => entry.instrument.symbol), ['ZIG/USD', 'DEMO:STOCK', 'DEMO:FX']);
  assert.deepEqual(filterInstrumentEntries(entries, '股票'), [entries[1]]);
  assert.deepEqual(filterInstrumentEntries(entries, 'foreign demo'), [entries[2]]);
  assert.deepEqual(filterInstrumentEntries(entries, ' ＤＥＭＯ：ＦＸ '), [entries[2]]);
  assert.deepEqual(filterInstrumentEntries(entries, 'not offered'), []);
  assert.equal(entries.length, 3);
});
