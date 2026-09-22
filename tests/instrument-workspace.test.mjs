import test from 'node:test';
import assert from 'node:assert/strict';
import { InstrumentWorkspace, selectedSymbol } from '../web/src/features/instruments/model.ts';
import { DrawingDocument } from '../web/src/features/drawings/document.ts';
import { RangeController } from '../web/src/features/range/controller.ts';

const original = { symbol: 'ZIG/USD', priceScale: 100, volumeScale: 1, intervalMs: 60000, name: 'Original' };
const fx = { ...original, symbol: 'DEMO:FX', priceScale: 100000 };
const baseline = { baselineSource: 'price', baselinePrice: 4200000 };
const line = { id: 'level', kind: 'horizontal', a: { time: 60000, price: 4200000 },
  b: { time: 60000, price: 4200000 }, color: '#123456', width: 2, locked: false };
function preferences() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('symbol documents migrate only matching legacy data and remain isolated across reloads and scales', () => {
  const storage = preferences(), legacy = new DrawingDocument(original.symbol, original.priceScale);
  legacy.add(line); storage.setItem('zigchart.drawings', legacy.serialize());
  const workspace = new InstrumentWorkspace(storage, ['1m', '1h'], original, baseline);
  const a = workspace.drawing(original), b = workspace.drawing(fx);
  assert.equal(a.document.items.length, 1); assert.equal(b.document.items.length, 0);
  assert.notEqual(a.key, b.key); assert.equal(a.invalid, false);
  b.document.add({ ...line, a: { time: 60000, price: 105000 }, b: { time: 60000, price: 105000 } });
  workspace.saveDrawing(a); workspace.saveDrawing(b);
  assert.equal(a.saved, true); assert.equal(b.saved, true);
  assert.equal(storage.getItem('zigchart.drawings'), legacy.serialize(), 'Legacy data is not deleted or overwritten');
  const reload = new InstrumentWorkspace(storage, ['1m', '1h'], original, baseline);
  assert.equal(reload.drawing(original).document.items[0].a.price, 4200000);
  assert.equal(reload.drawing(fx).document.items[0].a.price, 105000);
  assert.equal(reload.drawing({ ...fx, priceScale: 100 }).document.items.length, 0);
  storage.setItem(b.key, legacy.serialize());
  assert.equal(new InstrumentWorkspace(storage, ['1m'], original, baseline).drawing(fx).invalid, true);
});

test('storage failure retains independent drawings and edit history for this visit', () => {
  const denied = { getItem() { throw Error('Denied'); }, setItem() { throw Error('Quota'); } };
  const workspace = new InstrumentWorkspace(denied, ['1m'], original, baseline);
  const a = workspace.drawing(original); a.document.add(line); workspace.saveDrawing(a);
  assert.equal(a.saved, false);
  const b = workspace.drawing(fx); assert.equal(b.document.items.length, 0);
  assert.equal(workspace.drawing(original), a); assert.equal(a.document.canUndo, true);
  a.document.undo(); assert.equal(a.document.items.length, 0); assert.equal(b.document.canUndo, false);
});

test('fixed baseline prices and selected symbols never leak into another instrument', () => {
  const storage = preferences(), workspace = new InstrumentWorkspace(storage, ['1m'], original, baseline);
  assert.deepEqual(workspace.baseline(original), baseline);
  assert.deepEqual(workspace.baseline(fx), { baselineSource: 'first-visible', baselinePrice: 0 });
  workspace.saveBaseline(fx, { baselineSource: 'price', baselinePrice: 110000 });
  const reload = new InstrumentWorkspace(storage, ['1m'], original, baseline);
  assert.deepEqual(reload.baseline(original), baseline);
  assert.deepEqual(reload.baseline(fx), { baselineSource: 'price', baselinePrice: 110000 });
  storage.setItem('zigchart.baseline:DEMO%3AFX:100000', JSON.stringify({ version: 1, baselineSource: 'price', baselinePrice: 1e20 }));
  assert.deepEqual(new InstrumentWorkspace(storage, ['1m'], original, baseline).baseline(fx), { baselineSource: 'first-visible', baselinePrice: 0 });
  assert.equal(selectedSymbol(fx.symbol, [original.symbol, fx.symbol], original.symbol), fx.symbol);
  assert.equal(selectedSymbol('UNKNOWN', [original.symbol], original.symbol), original.symbol);
});

test('switching range source clears cached cutoff and prevents an old request from fitting the new chart', async () => {
  let cutoff = Date.UTC(2026, 0, 10), release, fits = 0;
  const controller = new RangeController({ cutoff: () => cutoff, width: () => 800,
    open: () => new Promise(resolve => { release = resolve; }), load: async () => {}, first: () => 0,
    hasMore: () => false, fit: () => { fits++; return 0; }, change() {} });
  const pending = controller.select('1D');
  assert.equal(controller.status, 'loading'); cutoff = null; controller.resetSource();
  assert.equal(controller.cutoff(), null); assert.equal(controller.selected, null);
  release(); await pending;
  assert.equal(fits, 0); assert.equal(controller.status, 'idle');
  cutoff = Date.UTC(2026, 1, 10); assert.equal(controller.cutoff(), cutoff);
});
