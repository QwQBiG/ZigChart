import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingDocument } from '../web/src/features/drawings/document.ts';

const line = (id = 'line-1') => ({ id, kind: 'trend', a: { time: 60000, price: 100 },
  b: { time: 120000, price: 150 }, color: '#ffaa00', width: 2, locked: false });
const doc = () => new DrawingDocument('ZIG/USD', 100);

test('drawing edit history treats a final move as one reversible operation', () => {
  const d = doc();
  d.add(line());
  const moved = { ...line(), a: { time: 180000, price: 110 } };
  d.update(moved);
  d.undo();
  assert.deepEqual(d.items, [line()]);
  d.undo();
  assert.deepEqual(d.items, []);
  d.redo(); d.redo();
  assert.deepEqual(d.items, [moved]);
  d.undo();
  d.update({ ...line(), color: '#ffffff' });
  assert.equal(d.canRedo, false);
});

test('deletion and undo preserve draw order, lock guards movement and deletion', () => {
  const d = doc();
  d.add(line('a')); d.add(line('b')); d.add(line('c'));
  d.selected = 'b'; d.removeSelected(); d.undo();
  assert.deepEqual(d.items.map(item => item.id), ['a', 'b', 'c']);
  d.update({ ...line('b'), locked: true });
  assert.equal(d.update({ ...line('b'), locked: true, a: { time: 180000, price: 120 } }), false);
  assert.equal(d.removeSelected(), false);
  d.update({ ...line('b'), locked: false });
  assert.equal(d.removeSelected(), true);
});

test('period documents and undo stacks remain independent across switches', () => {
  const d = doc();
  d.add(line());
  d.switchPeriod('1M');
  assert.deepEqual(d.items, []);
  assert.equal(d.canUndo, false);
  d.add(line('monthly'));
  d.switchPeriod('1m');
  assert.deepEqual(d.items, [line()]);
  d.undo();
  d.switchPeriod('1M');
  assert.deepEqual(d.items, [line('monthly')]);
});

test('saved drawings roundtrip with stable anchors and no editing history', () => {
  const d = doc(); d.add(line());
  const second = doc();
  assert.equal(second.restore(d.serialize(), ['1m', '1M']), true);
  assert.deepEqual(second.items, [line()]);
  assert.equal(second.canUndo, false);
  const copied = second.items;
  copied[0].a.price = 0;
  assert.equal(second.items[0].a.price, 100);
});

test('all line kinds roundtrip in the existing document format with locked state', () => {
  const d = doc();
  for (const kind of ['vertical', 'ray', 'extended', 'horizontalRay']) {
    assert.equal(d.add({ ...line(kind), kind, locked: true }), true);
  }
  const restored = doc();
  assert.equal(restored.restore(d.serialize(), ['1m']), true);
  assert.deepEqual(restored.items, d.items);
  assert.equal(d.add({ ...line('bad'), kind: 'constructor' }), false);
});

test('invalid or incompatible documents are rejected atomically', () => {
  const d = doc(); d.add(line());
  const good = JSON.parse(d.serialize());
  for (const value of [null, [], { ...good, version: 2 }, { ...good, priceScale: 1 },
    { ...good, symbol: 'OTHER' }, { ...good, periods: { '1s': [line()] } },
    { ...good, periods: { '1m': [line(), line()] } },
    { ...good, periods: { '1m': [{ ...line(), color: ['#ffaa00'] }] } },
    { ...good, periods: { '1m': [{ ...line(), a: { time: 0, price: 0.5 } }] } }]) {
    assert.equal(d.restore(JSON.stringify(value), ['1m']), false);
    assert.deepEqual(d.items, [line()]);
  }
  assert.equal(d.restore('{broken', ['1m']), false);
});

test('drawing count and undo history are bounded', () => {
  const d = doc();
  for (let i = 0; i < 256; i++) assert.equal(d.add(line(`d-${i}`)), true);
  assert.equal(d.full, true);
  assert.equal(d.add(line('overflow')), false);
  for (let i = 0; i < 150; i++) d.undo();
  assert.equal(d.items.length, 156);
});
