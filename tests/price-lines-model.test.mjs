import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PRICE_LINE, PRICE_LINE_LIMIT, PriceLineStore } from '../web/src/features/price-lines/model.ts';
import { parsePriceInput, priceInputText } from '../web/src/chart/price-input.ts';

const instrument = { symbol: 'ZIG/USD', priceScale: 100 };
const key = value => `zigchart.price-lines:${encodeURIComponent(value.symbol)}:${value.priceScale}`;
const draft = (price = 4093868) => ({ ...DEFAULT_PRICE_LINE, price, title: 'Reference' });
const storedLine = () => ({ ...draft(), id: 1 });
const documentValue = (overrides = {}) => ({ version: 1, ...instrument, nextId: 2, lines: [storedLine()], ...overrides });

function memoryStorage() {
  const values = new Map();
  let writes = 0;
  return { values, get writes() { return writes; }, getItem: name => values.get(name) ?? null,
    setItem(name, value) { writes++; values.set(name, value); } };
}
function restore(raw) {
  const storage = memoryStorage(); storage.values.set(key(instrument), raw);
  return new PriceLineStore(storage);
}

test('price lines retain stable IDs across edits and removal at the sixteen-line limit', () => {
  const storage = memoryStorage(), store = new PriceLineStore(storage);
  assert.equal(PRICE_LINE_LIMIT, 16);
  for (let i = 0; i < PRICE_LINE_LIMIT; i++) assert.equal(store.put(instrument, draft(i)), true);
  assert.deepEqual(store.items(instrument).map(item => item.id), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(store.put(instrument, draft(99)), false);
  assert.equal(storage.writes, 16);
  assert.equal(store.put(instrument, { ...draft(-5), title: '  Support  ', color: '#ABCDEF', visible: false }, 8), true);
  assert.equal(store.items(instrument)[7].id, 8);
  assert.equal(store.items(instrument)[7].title, 'Support');
  assert.equal(store.items(instrument)[7].color, '#abcdef');
  assert.equal(store.remove(instrument, 8), true);
  assert.equal(store.put(instrument, draft(100)), true);
  assert.equal(store.items(instrument).at(-1).id, 17);
  assert.equal(store.remove(instrument, 8), false);
  assert.equal(store.put(instrument, draft(), 8), false);
  assert.deepEqual(new PriceLineStore(storage).items(instrument), store.items(instrument));
});

test('price lines separate encoded symbols and scales while retaining in-memory documents', () => {
  const storage = memoryStorage(), store = new PriceLineStore(storage);
  const otherScale = { ...instrument, priceScale: 8 };
  const escapedSymbol = { ...instrument, symbol: 'ZIG%2FUSD' };
  assert.equal(store.put(instrument, draft(123)), true);
  assert.equal(store.put(otherScale, draft(8)), true);
  assert.equal(store.put(escapedSymbol, draft(456)), true);
  assert.deepEqual(store.items(instrument).map(item => item.price), [123]);
  assert.deepEqual(store.items(otherScale).map(item => item.price), [8]);
  assert.deepEqual(store.items(escapedSymbol).map(item => item.price), [456]);
  assert.equal(storage.values.size, 3);
  const reopened = new PriceLineStore(storage);
  for (const identity of [instrument, otherScale, escapedSymbol]) assert.deepEqual(reopened.items(identity), store.items(identity));
});

test('unavailable storage preserves current-session edits without reporting document corruption', () => {
  const unavailable = new PriceLineStore();
  assert.deepEqual(unavailable.status(instrument), { saved: false, invalid: false });
  assert.equal(unavailable.put(instrument, draft()), true);
  assert.deepEqual(unavailable.status(instrument), { saved: false, invalid: false });
  let fails = true;
  const values = new Map();
  const storage = { getItem(name) { if (fails) throw new Error('Unavailable'); return values.get(name) ?? null; },
    setItem(name, value) { if (fails) throw new Error('Quota exceeded'); values.set(name, value); } };
  const store = new PriceLineStore(storage);
  assert.deepEqual(store.status(instrument), { saved: false, invalid: false });
  assert.equal(store.put(instrument, draft()), true);
  const other = { ...instrument, symbol: 'OTHER' };
  assert.equal(store.put(other, draft(8)), true);
  assert.equal(store.items(instrument)[0].price, draft().price);
  fails = false;
  assert.equal(store.put(instrument, draft(55), 1), true);
  assert.deepEqual(store.status(instrument), { saved: true, invalid: false });
  assert.equal(new PriceLineStore(storage).items(instrument)[0].price, 55);
});

test('writes and restored records retain only known fields and return independent copies', () => {
  const storage = memoryStorage(), store = new PriceLineStore(storage);
  const original = { ...draft(), ignored: { privateValue: 1 } };
  assert.equal(store.put(instrument, original), true);
  original.price = 999;
  const result = store.items(instrument); result[0].title = 'Changed'; result.push(storedLine());
  assert.equal(store.items(instrument).length, 1);
  assert.equal(store.items(instrument)[0].price, draft().price);
  assert.equal(store.items(instrument)[0].title, 'Reference');
  assert.equal(Object.hasOwn(store.items(instrument)[0], 'ignored'), false);
  const saved = JSON.parse(storage.values.get(key(instrument)));
  assert.deepEqual(Object.keys(saved.lines[0]).sort(), Object.keys(storedLine()).sort());
  const restored = restore(JSON.stringify(documentValue({ lines: [{ ...storedLine(), ignored: { large: true } }], ignored: 'root' })));
  assert.deepEqual(restored.items(instrument), [storedLine()]);
  assert.equal(restored.put(instrument, draft(7), 1), true);
});

test('invalid edits leave membership, IDs and persisted state unchanged', () => {
  const storage = memoryStorage(), store = new PriceLineStore(storage);
  assert.equal(store.put(instrument, draft()), true);
  const before = storage.values.get(key(instrument));
  const invalid = [
    ['price', 1e12 + 1], ['price', -1e12 - 1], ['price', .5], ['price', NaN], ['price', Infinity],
    ['price', '123'], ['title', 'x'.repeat(65)], ['title', 'a\nb'], ['title', 'a\u007fb'], ['title', 2],
    ['color', ['#abcdef']], ['color', '#fff'], ['color', 'red'], ['width', 0], ['width', 5], ['width', '2'],
    ['style', 'unknown'], ['style', ['solid']], ['visible', 1], ['axisLabel', 'true'],
  ];
  for (const [field, value] of invalid) assert.equal(store.put(instrument, { ...draft(), [field]: value }, 1), false, field);
  for (const id of [0, -1, .5, NaN, Infinity, '1', 99]) {
    assert.equal(store.put(instrument, draft(), id), false);
    assert.equal(store.remove(instrument, id), false);
  }
  assert.deepEqual(store.items(instrument), [storedLine()]);
  assert.equal(storage.values.get(key(instrument)), before);
  assert.equal(storage.writes, 1);
});

test('restoration rejects malformed documents atomically and allows a fresh saved edit', () => {
  const invalid = [null, [], {}, documentValue({ version: 2 }), documentValue({ symbol: 'OTHER' }),
    documentValue({ priceScale: 8 }), documentValue({ nextId: 0 }), documentValue({ nextId: 1.5 }),
    documentValue({ nextId: 2 ** 31 + 1 }), documentValue({ nextId: 1 }), documentValue({ lines: {} }),
    documentValue({ lines: [storedLine(), storedLine()] }),
    documentValue({ lines: [storedLine(), { ...storedLine(), id: 2, price: .1 }], nextId: 3 }),
    documentValue({ lines: [{ ...storedLine(), color: ['#abcdef'] }] }),
    documentValue({ lines: Array.from({ length: 17 }, (_, i) => ({ ...storedLine(), id: i + 1 })), nextId: 18 }),
    ...[0, -1, .5, '1', 2].map(id => documentValue({ lines: [{ ...storedLine(), id }] })),
  ];
  for (const value of invalid) {
    const storage = memoryStorage(); storage.values.set(key(instrument), JSON.stringify(value));
    const store = new PriceLineStore(storage);
    assert.deepEqual(store.items(instrument), [], JSON.stringify(value));
    assert.deepEqual(store.status(instrument), { saved: false, invalid: true });
    assert.equal(store.put(instrument, draft()), true);
    assert.deepEqual(store.items(instrument), [storedLine()]);
    assert.deepEqual(store.status(instrument), { saved: true, invalid: false });
  }
  for (const raw of ['', '{broken']) {
    const store = restore(raw);
    assert.deepEqual(store.items(instrument), []);
    assert.deepEqual(store.status(instrument), { saved: false, invalid: true });
  }
});

test('restoration bounds UTF-8 documents at 32 KiB before parsing', () => {
  const raw = JSON.stringify(documentValue());
  const maximum = restore(raw.padEnd(32 * 1024, ' '));
  assert.deepEqual(maximum.items(instrument), [storedLine()]);
  assert.deepEqual(maximum.status(instrument), { saved: true, invalid: false });
  const unicode = JSON.stringify(documentValue({ ignored: '中'.repeat(11000) }));
  assert.ok(unicode.length < 32 * 1024);
  assert.ok(new TextEncoder().encode(unicode).length > 32 * 1024);
  for (const oversized of [raw.padEnd(32 * 1024 + 1, ' '), unicode]) {
    const store = restore(oversized);
    assert.deepEqual(store.items(instrument), []);
    assert.deepEqual(store.status(instrument), { saved: false, invalid: true });
  }
});

test('restored IDs continue monotonically and stop before the integer ID limit', () => {
  const store = restore(JSON.stringify(documentValue({ nextId: 50, lines: [{ ...storedLine(), id: 25 }] })));
  assert.equal(store.put(instrument, draft(3)), true);
  assert.deepEqual(store.items(instrument).map(item => item.id), [25, 50]);
  assert.equal(store.remove(instrument, 50), true);
  assert.equal(store.put(instrument, draft(4)), true);
  assert.deepEqual(store.items(instrument).map(item => item.id), [25, 51]);
  const exhausted = restore(JSON.stringify(documentValue({ nextId: 2 ** 31, lines: [{ ...storedLine(), id: 2 ** 31 - 1 }] })));
  assert.equal(exhausted.put(instrument, draft()), false);
  assert.equal(exhausted.put(instrument, draft(4), 2 ** 31 - 1), true);
  assert.equal(exhausted.items(instrument)[0].id, 2 ** 31 - 1);
});

test('decimal price input converts exactly into integer units', () => {
  for (const [text, scale, expected] of [
    ['40938.68', 100, 4093868], [' -0.01 ', 100, -1], ['+.125', 8, 1], ['12.340', 100, 1234],
    ['10.', 1, 10], ['.5', 2, 1], ['0002.50', 100, 250], ['-0', 100, 0],
    ['1000000000000', 1, 1e12], ['-1000000000000', 1, -1e12], ['10000000000.00', 100, 1e12],
    ['0.00000000000001048576', 5 ** 20, 1],
  ]) assert.equal(parsePriceInput(text, scale), expected, `${text} / ${scale}`);
});

test('decimal price input rejects rounding, exponents, grouping and unsupported values', () => {
  for (const [text, scale] of [['1.001', 100], ['.1', 8], ['1e2', 100], ['1E-2', 100], ['NaN', 100],
    ['Infinity', 100], ['1,000.00', 100], ['1 000', 100], ['', 100], ['  ', 100], ['.', 100],
    ['--1', 100], ['0x10', 100], ['１２', 100], ['1\n2', 100], ['1.2.3', 100],
    ['0.000000000000000000001', 100], ['1'.repeat(65), 1], ['1000000000001', 1], ['-1000000000001', 1],
    ['10000000000.01', 100], ['9007199254740993', 1]]) assert.equal(parsePriceInput(text, scale), null, text);
  for (const scale of [0, -1, .5, 3, 6, 7, 2 ** 21, 2 ** 53, Infinity, NaN, '100']) {
    assert.throws(() => parsePriceInput('1', scale), RangeError);
    assert.throws(() => priceInputText(1, scale), RangeError);
  }
});

test('price input text round trips integer units without locale rounding or grouping', () => {
  for (const scale of [1, 2, 8, 32, 100, 1000000000, 5 ** 20]) {
    for (const price of [0, 1, -1, 1234567, -1234567, 1e12, -1e12]) {
      const text = priceInputText(price, scale);
      assert.match(text, /^-?\d+(?:\.\d+)?$/);
      assert.equal(parsePriceInput(text, scale), price, `${price} / ${scale}`);
    }
  }
  assert.equal(priceInputText(1, 8), '0.125');
  assert.equal(priceInputText(-1, 100), '-0.01');
  assert.equal(priceInputText(1234567, 100), '12345.67');
  assert.equal(priceInputText(-0, 100), '0.00');
  for (const price of [.5, NaN, Infinity, '1', 1e12 + 1, -1e12 - 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => priceInputText(price, 100), RangeError, String(price));
  }
});
