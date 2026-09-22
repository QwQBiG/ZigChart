import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { DrawingDocument, validDrawing } from '../web/src/features/drawings/document.ts';
import { DrawingEditor } from '../web/src/features/drawings/editor.ts';
import { createTextStyle } from '../web/src/features/drawings/text-model.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const anchor = { time: 50 * 60000, price: 100 };
const text = () => ({ id: 'note-1', kind: 'text', a: { ...anchor }, b: { ...anchor },
  color: '#4f8cff', width: 2, locked: false, text: createTextStyle('Support 支撑\n<x>') });

test('text documents validate payload ownership, canonical anchors and restore without losing content', () => {
  const document = new DrawingDocument('TEST', 1), note = text();
  assert.ok(document.add(note));
  for (const invalid of [
    { ...note, text: undefined }, { ...note, kind: 'trend' }, { ...note, b: { ...anchor, price: 101 } },
    { ...note, text: { ...note.text, content: '' } }, { ...note, text: { ...note.text, fontSize: 1000 } },
  ]) assert.equal(validDrawing(invalid), false);
  const locked = { ...note, locked: true };
  assert.ok(document.update(locked));
  const styled = { ...locked, text: { ...locked.text, content: 'Revised 注释', bold: true } };
  assert.ok(document.update(styled));
  assert.equal(document.update({ ...styled, a: { ...anchor, price: 101 }, b: { ...anchor, price: 101 } }), false);
  assert.equal(document.removeSelected(), false);
  document.undo(); assert.deepEqual(document.selection, locked);
  document.redo(); assert.deepEqual(document.selection, styled);
  const restored = new DrawingDocument('TEST', 1);
  assert.ok(restored.restore(document.serialize(), ['1m']));
  assert.deepEqual(restored.items, [styled]); assert.equal(restored.canUndo, false);
  const broken = JSON.parse(document.serialize()); broken.periods['1m'][0].text.content = '';
  assert.equal(restored.restore(JSON.stringify(broken), ['1m']), false);
  assert.deepEqual(restored.items, [styled]);
});

test('text tool adds one anchor and its full body uses core hit testing for one undoable move', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', Array.from({ length: 200 }, (_, i) => ({ time: i * 60000,
    open: 100, high: 150, low: 50, close: 100, volume: 10 })));
  core.setView(0, 100);
  const document = new DrawingDocument('TEST', 1), edits = [];
  const editor = new DrawingEditor(document, () => core, () => ({ width: 1000, height: 600 }),
    save => edits.push(save), { initialContent: () => '文字', bounds: items => items.map(() => ({ width: 120, height: 40 })) });
  const [position] = core.projectDrawings([text()], 1000, 600);
  editor.setTool('text'); assert.ok(editor.down({ x: position.x1, y: position.y1 }));
  assert.equal(editor.tool, 'pointer'); assert.equal(editor.drawing, false);
  const original = document.items[0];
  assert.deepEqual(original.a, anchor); assert.deepEqual(original.a, original.b);
  assert.equal(original.text.content, '文字'); assert.equal(edits.filter(Boolean).length, 1);
  const body = { x: position.x1 + 70, y: position.y1 + 20 };
  assert.ok(editor.down(body)); assert.equal(editor.dragging, true);
  editor.motion({ x: body.x + 20, y: body.y });
  assert.deepEqual(document.items, [original]);
  editor.up(); assert.equal(edits.filter(Boolean).length, 2);
  const moved = document.items[0];
  assert.equal(moved.a.time, original.a.time + 2 * 60000);
  assert.deepEqual(moved.a, moved.b); assert.deepEqual(moved.text, original.text);
  editor.edit('undo'); assert.deepEqual(document.items, [original]);
  editor.edit('redo'); assert.deepEqual(document.items, [moved]);
  editor.edit('lock'); editor.edit('delete'); assert.equal(document.items.length, 1);
  editor.edit('lock'); editor.edit('delete'); assert.equal(document.items.length, 0);
});

test('text body can start a drag over right blank while the final anchor remains a loaded candle', async () => {
  const core = await ChartCore.create(bytes);
  core.apply('replace', Array.from({ length: 200 }, (_, i) => ({ time: i * 60000,
    open: 100, high: 150, low: 50, close: 100, volume: 10 })));
  core.setView(159.5, 50);
  const document = new DrawingDocument('TEST', 1), a = { time: 198 * 60000, price: 100 };
  document.add({ ...text(), a, b: { ...a } });
  const editor = new DrawingEditor(document, () => core, () => ({ width: 1000, height: 600 }), () => {},
    { bounds: items => items.map(() => ({ width: 120, height: 40 })) });
  const [position] = core.projectDrawings(document.items, 1000, 600);
  const start = { x: position.x1 + 70, y: position.y1 + 20 };
  assert.equal(core.drawingPoint(start.x, start.y, 1000, 600), null);
  assert.ok(editor.down(start)); assert.equal(editor.dragging, true);
  editor.motion({ x: start.x + 80, y: start.y });
  assert.deepEqual(editor.items[0].a, a, 'A movement beyond the last loaded bar is rejected');
  editor.motion({ x: start.x - 40, y: start.y }); editor.up();
  assert.equal(document.items[0].a.time, 196 * 60000);
  assert.deepEqual(document.items[0].a, document.items[0].b);
  document.undo(); assert.deepEqual(document.items[0].a, a);
});
