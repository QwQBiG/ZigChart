import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotImage, snapshotFilename, snapshotSize } from '../web/src/features/export/image.ts';

test('snapshot allocation uses logical size and caps high-resolution memory', () => {
  assert.deepEqual(snapshotSize(701, 401, 2), {
    pixelWidth: 1402, pixelHeight: 966, scale: 2, totalHeight: 483, chartTop: 56,
  });
  for (const [width, height, dpr] of [[4096, 2160, 4], [20000, 3000, 2], [1234.5, 876.5, 1.25]]) {
    const size = snapshotSize(width, height, dpr);
    assert.ok(size.pixelWidth <= 8192 && size.pixelHeight <= 8192);
    assert.ok(size.pixelWidth * size.pixelHeight <= 16_000_000);
    assert.ok(size.scale <= dpr);
    assert.ok(size.pixelWidth > 0 && size.pixelHeight > 0);
  }
  for (const args of [[0, 20, 1], [20, -1, 1], [20, 20, NaN], [Infinity, 20, 1]]) {
    assert.throws(() => snapshotSize(...args), /dimensions/);
  }
  assert.equal(snapshotFilename('../ZIG/USD', '15m', Date.UTC(2026, 0, 13, 8)), 'zigchart-ZIG-USD-15m-20260113T080000000Z.png');
});

function fixture() {
  const operations = [], values = [];
  const context = new Proxy({
    measureText: text => ({ width: text.length * 6 }),
    fillText: (...args) => values.push(args),
  }, { get: (target, key) => target[key] ?? ((...args) => operations.push([key, ...args])) });
  let finish;
  const canvas = { width: 0, height: 0, getContext: () => context,
    toBlob(callback, type) { assert.equal(type, 'image/png'); finish = callback; } };
  const input = { width: 701, height: 401, pixelRatio: 2, background: '#000000', foreground: '#ffffff', muted: '#aaaaaa',
    title: 'ZigChart', details: 'O 100 H 110 L 90 C 105', footer: 'Synthetic · UTC · 24/7', filename: 'chart.png',
    labels: [{ text: 'RSI 14', top: 250, bottom: 401, width: 615, color: '#ffffff' }],
    draw(ctx) { assert.equal(ctx, context); operations.push(['chart']); } };
  return { canvas, input, operations, values, complete: value => finish(value) };
}

test('capture rasterizes once before asynchronous encoding and preserves exact output bounds', async () => {
  const f = fixture();
  const pending = createSnapshotImage(f.input, () => f.canvas);
  assert.equal(f.canvas.width, 1402); assert.equal(f.canvas.height, 966);
  assert.ok(f.operations.some(op => op[0] === 'translate' && op[2] === 56));
  assert.ok(f.operations.some(op => op[0] === 'rect' && op[3] === 701 && op[4] === 401));
  assert.equal(f.operations.filter(op => op[0] === 'chart').length, 1);
  assert.ok(f.values.some(([text]) => text === 'Synthetic · UTC · 24/7'));
  assert.ok(f.values.some(([text]) => text === 'RSI 14'));
  f.input.title = 'Later state';
  const png = new Blob(['png'], { type: 'image/png' }); f.complete(png);
  assert.deepEqual(await pending, { blob: png, filename: 'chart.png', width: 1402, height: 966 });
  assert.ok(!f.values.some(([text]) => text === 'Later state'));
});

test('PNG encoding and rendering failures reject without a false download', async () => {
  const f = fixture(), pending = createSnapshotImage(f.input, () => f.canvas);
  f.complete(null); await assert.rejects(pending, /PNG encoding failed/);
  await assert.rejects(createSnapshotImage(f.input, () => ({ getContext: () => null })), /Canvas 2D/);
  await assert.rejects(createSnapshotImage({ ...f.input, draw() { throw new Error('Render failed'); } }, () => f.canvas), /Render failed/);
});
