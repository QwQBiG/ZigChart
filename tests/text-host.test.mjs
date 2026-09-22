import test from 'node:test';
import assert from 'node:assert/strict';
import { createTextStyle, validTextStyle } from '../web/src/features/drawings/text-model.ts';
import { drawTextAnnotation, getTextLayout } from '../web/src/features/drawings/text-render.ts';

function context() {
  const calls = [], states = [];
  const ctx = { font: '10px serif', calls, measures: 0,
    measureText(text) {
      this.measures++;
      const size = Number(this.font.match(/(\d+)px/)[1]);
      return { width: [...text].reduce((total, point) => total + (point.codePointAt(0) > 127 ? size : size / 2), 0) };
    },
    save() { states.push({ font: this.font, globalAlpha: this.globalAlpha }); calls.push(['save']); },
    restore() { Object.assign(this, states.pop()); calls.push(['restore']); },
    setLineDash(value) { calls.push(['setLineDash', value]); },
    fillRect(...args) { calls.push(['fillRect', ...args, this.globalAlpha, this.fillStyle]); },
    strokeRect(...args) { calls.push(['strokeRect', ...args, this.lineWidth]); },
    fillText(...args) { calls.push(['fillText', ...args, this.font, this.fillStyle]); },
  };
  return ctx;
}

test('text styles validate complete independent values and normalize factory line endings', () => {
  const style = createTextStyle('First\r\n第二行\rThird');
  assert.equal(style.content, 'First\n第二行\nThird'); assert.equal(validTextStyle(style), true);
  assert.equal(style.background, false); assert.equal(style.border, false);
  for (const patch of [{ content: '' }, { content: ' \n\t' }, { content: 'x'.repeat(1001) },
    { content: Array(21).fill('x').join('\n') }, { content: 'a\rb' }, { content: 42 },
    { fontSize: 9 }, { fontSize: 49 }, { fontSize: 12.5 }, { wrapWidth: 79 }, { wrapWidth: 641 },
    { wrapWidth: 100.5 }, { bold: 1 }, { italic: 'false' }, { background: null }, { border: undefined },
    { backgroundColor: '#fff' }, { borderColor: 'red' }, { backgroundOpacity: NaN },
    { backgroundOpacity: Infinity }, { backgroundOpacity: -.01 }, { backgroundOpacity: 1.01 }]) {
    assert.equal(validTextStyle({ ...style, ...patch }), false, JSON.stringify(patch));
  }
  assert.equal(validTextStyle({ ...style, content: 'x'.repeat(1000), fontSize: 10, wrapWidth: 80, backgroundOpacity: 0 }), true);
  assert.equal(validTextStyle({ ...style, fontSize: 48, wrapWidth: 640, backgroundOpacity: 1, borderColor: '#ABCDEF' }), true);
  assert.equal(validTextStyle(null), false);
});

test('CJK and supplementary characters wrap intact; explicit empty lines remain', () => {
  const ctx = context(), content = '汉字🙂指标测试';
  const layout = getTextLayout(ctx, { ...createTextStyle(content), wrapWidth: 80 });
  assert.deepEqual(layout.lines, ['汉字🙂指', '标测试']);
  assert.equal(layout.lines.join(''), content); assert.equal(layout.width, 68);
  assert.equal(layout.height, 2 * layout.lineHeight + 12); assert.equal(ctx.font, '10px serif');
  const multiline = getTextLayout(ctx, createTextStyle('alpha\n\nbeta'));
  assert.deepEqual(multiline.lines, ['alpha', '', 'beta']);
  const spaced = 'alpha beta  gamma\tend';
  assert.equal(getTextLayout(ctx, { ...createTextStyle(spaced), wrapWidth: 80 }).lines.join(''), spaced);
});

test('layout cache ignores paint-only changes, keys font changes and evicts old entries', () => {
  const ctx = context(), style = createTextStyle('Cached');
  const first = getTextLayout(ctx, style), measured = ctx.measures;
  assert.equal(getTextLayout(ctx, { ...style, background: true, borderColor: '#ff0000' }), first);
  assert.equal(ctx.measures, measured);
  const bold = getTextLayout(ctx, { ...style, bold: true, italic: true });
  assert.match(bold.font, /^italic bold 14px/); assert.notEqual(bold, first);
  for (let i = 0; i < 256; i++) getTextLayout(ctx, createTextStyle(`Entry ${i}`));
  const before = ctx.measures; getTextLayout(ctx, style); assert.ok(ctx.measures > before);
  const other = context(); getTextLayout(other, style); assert.ok(other.measures > 0);
});

test('drawing uses shared padded bounds, keeps border inside them, and treats markup literally', () => {
  const ctx = context(), content = '<b>收益</b> & <script>literal</script>';
  const style = { ...createTextStyle(content), wrapWidth: 640, background: true, border: true, backgroundOpacity: .25 };
  const layout = getTextLayout(ctx, style);
  drawTextAnnotation(ctx, { x1: 100, y1: 200 }, { color: '#112233', width: 4, text: style });
  assert.deepEqual(ctx.calls.find(call => call[0] === 'fillRect'), ['fillRect', 100, 200, layout.width, layout.height, .25, '#000000']);
  assert.deepEqual(ctx.calls.find(call => call[0] === 'strokeRect'), ['strokeRect', 102, 202, layout.width - 4, layout.height - 4, 4]);
  assert.deepEqual(ctx.calls.find(call => call[0] === 'fillText'), ['fillText', content, 106, 206, layout.font, '#112233']);
  assert.equal(ctx.font, '10px serif'); assert.deepEqual(ctx.calls.at(-1), ['restore']);
  ctx.calls.length = 0;
  drawTextAnnotation(ctx, { x1: NaN, y1: 20 }, { color: '#112233', width: 1, text: style });
  assert.equal(ctx.calls.length, 0);
});
