import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartCore } from '../web/src/chart/bridge.ts';
import { DrawingDocument } from '../web/src/features/drawings/document.ts';
import { DrawingEditor } from '../web/src/features/drawings/editor.ts';

const bytes = await readFile(new URL('../web/public/core.wasm', import.meta.url));
const bar = index => ({ time: 1_700_000_000_000 + index * 60_000, open: 10000 + index * 2,
  high: 10040 + index * 2, low: 9960 + index * 2, close: 10000 + index * 2, volume: 100 });
const anchor = (index, price = bar(index).close) => ({ time: bar(index).time, price });
const drawing = (kind = 'trend', id = 'shape-1') => ({ id, kind, a: anchor(105), b: anchor(155),
  color: '#4f8cff', width: 2, locked: false });

async function fixture() {
  const core = await ChartCore.create(bytes);
  core.apply('replace', Array.from({ length: 400 }, (_, index) => bar(index + 50)));
  core.setView(30, 100);
  const document = new DrawingDocument('ZIG/USD', 100);
  const changes = [];
  const editor = new DrawingEditor(document, () => core, () => ({ width: 1000, height: 600 }), save => changes.push(save));
  const point = a => {
    const [g] = core.projectDrawings([{ kind: 'horizontal', a, b: a }], 1000, 600);
    assert.ok(g.valid);
    return { x: g.x1, y: g.y1 };
  };
  return { core, document, editor, changes, point };
}

test('editor creates two-anchor tools with two clicks and only one undo entry', async () => {
  for (const kind of ['trend', 'rectangle', 'ray', 'extended', 'fibonacci']) {
    const { document, editor, changes, point } = await fixture();
    editor.setTool(kind);
    assert.equal(editor.down(point(anchor(105))), true);
    assert.equal(editor.drawing, true);
    assert.equal(document.items.length, 0);
    editor.up();
    editor.motion(point(anchor(155)));
    assert.deepEqual(editor.items[0].b, anchor(155));
    assert.equal(editor.down(point(anchor(155))), true);
    assert.equal(editor.drawing, false);
    assert.equal(editor.tool, 'pointer');
    assert.equal(document.items[0].kind, kind);
    assert.deepEqual(document.items[0].a, anchor(105));
    assert.deepEqual(document.items[0].b, anchor(155));
    assert.equal(changes.filter(Boolean).length, 1);
    document.undo();
    assert.deepEqual(document.items, []);
    assert.equal(document.canUndo, false);
    document.redo();
    assert.equal(document.items.length, 1);
  }
});

test('editor creates single-anchor tools in one click and cancels unfinished construction', async () => {
  for (const kind of ['horizontal', 'vertical', 'horizontalRay']) {
    const { document, editor, changes, point } = await fixture();
    editor.setTool(kind);
    editor.down(point(anchor(130)));
    assert.equal(editor.drawing, false);
    assert.equal(editor.tool, 'pointer');
    assert.equal(document.items.length, 1);
    assert.deepEqual(document.items[0].a, anchor(130));
    assert.deepEqual(document.items[0].b, anchor(130));
    const before = document.serialize();
    editor.setTool('rectangle');
    editor.down(point(anchor(105)));
    editor.motion(point(anchor(155)));
    assert.equal(editor.items.length, 2);
    editor.cancel();
    assert.equal(editor.drawing, false);
    assert.equal(editor.items.length, 1);
    assert.equal(document.serialize(), before);
    assert.equal(changes.filter(Boolean).length, 1);
  }
});

test('single-anchor handle edits keep both stored anchors synchronized and undoable', async () => {
  for (const kind of ['horizontal', 'vertical', 'horizontalRay']) {
    const { document, editor, point } = await fixture();
    editor.setTool(kind); editor.down(point(anchor(130)));
    const original = document.items[0];
    editor.down(point(original.a)); editor.motion(point(anchor(140))); editor.up();
    assert.deepEqual(document.items[0].a, anchor(140));
    assert.deepEqual(document.items[0].b, anchor(140));
    editor.edit('undo'); assert.deepEqual(document.items[0], original);
  }
});

test('editor body drag previews freely but commits exactly one data-space move', async () => {
  const { document, editor, changes, point } = await fixture();
  const original = drawing();
  document.add(original);
  assert.equal(editor.down(point(anchor(130))), true);
  assert.equal(editor.dragging, true);
  for (const offset of [1, 3, 5]) editor.motion(point(anchor(130 + offset, anchor(130).price + 10)));
  assert.deepEqual(document.items, [original]);
  const moved = { ...original, a: anchor(110, original.a.price + 10), b: anchor(160, original.b.price + 10) };
  assert.deepEqual(editor.items, [moved]);
  editor.up(); editor.up();
  assert.equal(editor.dragging, false);
  assert.deepEqual(document.items, [moved]);
  assert.equal(changes.filter(Boolean).length, 1);
  document.undo();
  assert.deepEqual(document.items, [original]);
  document.undo();
  assert.deepEqual(document.items, []);
});

test('editor handle drag changes one endpoint and cancel leaves history untouched', async () => {
  const { document, editor, changes, point } = await fixture();
  const original = drawing();
  document.add(original);
  editor.down(point(original.b));
  editor.motion(point(anchor(165, original.b.price + 12)));
  assert.deepEqual(editor.items[0].a, original.a);
  assert.deepEqual(editor.items[0].b, anchor(165, original.b.price + 12));
  editor.cancel(); editor.up();
  assert.deepEqual(document.items, [original]);
  assert.equal(changes.filter(Boolean).length, 0);
  editor.down(point(original.a));
  editor.motion(point(anchor(110, original.a.price + 8)));
  editor.up();
  assert.deepEqual(document.items[0].a, anchor(110, original.a.price + 8));
  assert.deepEqual(document.items[0].b, original.b);
  assert.equal(changes.filter(Boolean).length, 1);
  document.undo();
  assert.deepEqual(document.items, [original]);
});

test('editor locked selection blocks move and delete while preserving valid style edits', async () => {
  const { document, editor, point } = await fixture();
  const original = { ...drawing(), locked: true };
  document.add(original);
  assert.equal(editor.down(point(anchor(130))), true);
  assert.equal(document.selected, original.id);
  assert.equal(editor.dragging, false);
  editor.motion(point(anchor(135)));
  editor.up();
  editor.edit('delete');
  assert.deepEqual(document.items, [original]);
  editor.style('#ffaa00', 4);
  assert.deepEqual(document.items, [{ ...original, color: '#ffaa00', width: 4 }]);
  editor.edit('undo');
  assert.deepEqual(document.items, [original]);
  editor.edit('lock');
  assert.equal(document.selection.locked, false);
  editor.edit('delete');
  assert.deepEqual(document.items, []);
});

test('editor selection uses the topmost shape and future blank cannot become an anchor', async () => {
  const { core, document, editor, point } = await fixture();
  document.add(drawing('trend', 'lower'));
  document.add(drawing('trend', 'upper'));
  assert.equal(editor.down(point(anchor(130))), true);
  assert.equal(document.selected, 'upper');
  editor.cancel();
  core.follow();
  const blank = { x: 950, y: 200 };
  editor.setTool('trend');
  assert.equal(editor.down(blank), true);
  assert.equal(editor.drawing, false);
  assert.equal(editor.items.length, 2);
  editor.down(point(anchor(430)));
  assert.equal(editor.drawing, true);
  const first = structuredClone(editor.items[2]);
  editor.motion(blank);
  editor.down(blank);
  assert.equal(editor.drawing, true);
  assert.deepEqual(editor.items[2], first);
  assert.equal(document.items.length, 2);
  editor.cancel();
  editor.setTool('pointer');
  assert.equal(editor.down(blank), false);
  assert.equal(document.selected, null);
});

test('editor data anchors remain stable through pan, zoom and history prepend', async () => {
  const { core, document, editor } = await fixture();
  document.add(drawing());
  const saved = document.serialize();
  core.pan(5);
  core.zoom(2, 0.5);
  core.apply('prepend', Array.from({ length: 50 }, (_, index) => bar(index)));
  core.frame(700, 420);
  assert.equal(document.serialize(), saved);
  assert.deepEqual(editor.items, [drawing()]);
  assert.equal(core.projectDrawings(editor.items, 700, 420)[0].valid, true);
});

test('editor body movement re-resolves start timestamp after history prepends during drag', async () => {
  const { core, document, editor, point } = await fixture();
  const original = drawing();
  document.add(original);
  editor.down(point(anchor(130)));
  assert.equal(editor.dragging, true);
  core.apply('prepend', Array.from({ length: 50 }, (_, index) => bar(index)));
  editor.motion(point(anchor(135, anchor(130).price + 10)));
  editor.up();
  assert.deepEqual(document.items, [{ ...original, a: anchor(110, original.a.price + 10), b: anchor(160, original.b.price + 10) }]);
  document.undo();
  assert.deepEqual(document.items, [original]);
});

test('styling a new preview never edits the previously selected drawing or its history', async () => {
  const { document, editor, changes, point } = await fixture();
  const original = drawing();
  document.add(original);
  assert.equal(document.selected, original.id);
  editor.setTool('rectangle');
  assert.equal(document.selected, null);
  editor.down(point(anchor(120)));
  editor.style('#ffaa00', 3);
  assert.deepEqual(document.items, [original]);
  assert.equal(editor.items[1].color, '#ffaa00');
  assert.equal(editor.items[1].width, 3);
  editor.cancel();
  assert.deepEqual(document.items, [original]);
  assert.equal(editor.items.length, 1);
  assert.equal(changes.filter(Boolean).length, 0);
  document.undo();
  assert.deepEqual(document.items, []);
  assert.equal(document.canUndo, false);
});
