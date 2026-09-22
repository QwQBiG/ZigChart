import type { TextStyle } from './text-model';

export interface TextLayout { lines: string[]; width: number; height: number; font: string; lineHeight: number }
const padding = 6, capacity = 256;
const cache = new WeakMap<CanvasRenderingContext2D, Map<string, TextLayout>>();

/** CSS-pixel dimensions include padding and are shared by drawing and core hit-box input. */
export function getTextLayout(ctx: CanvasRenderingContext2D, style: TextStyle): TextLayout {
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize}px system-ui, sans-serif`;
  const key = JSON.stringify([style.content, font, style.wrapWidth]);
  let entries = cache.get(ctx);
  if (!entries) { entries = new Map(); cache.set(ctx, entries); }
  const known = entries.get(key);
  if (known) return known;
  const previous = ctx.font; ctx.font = font;
  const lines: string[] = [], limit = style.wrapWidth - padding * 2;
  try {
    for (const paragraph of style.content.split('\n')) {
      let line = '';
      for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
        if (line && ctx.measureText(line + token).width > limit && ctx.measureText(token).width <= limit) {
          lines.push(line); line = '';
        }
        // Split overlong tokens by Unicode code point, preserving every character.
        for (const point of token) {
          if (line && ctx.measureText(line + point).width > limit) { lines.push(line); line = ''; }
          line += point;
        }
      }
      lines.push(line);
    }
    const lineHeight = Math.ceil(style.fontSize * 1.35);
    const width = Math.ceil(Math.max(0, ...lines.map(line => ctx.measureText(line).width))) + padding * 2;
    const layout = { lines, width, height: lines.length * lineHeight + padding * 2, font, lineHeight };
    if (entries.size >= capacity) entries.delete(entries.keys().next().value!);
    entries.set(key, layout);
    return layout;
  } finally { ctx.font = previous; }
}

/** The caller owns the main price-pane clip; coordinates are a projected top-left anchor. */
export function drawTextAnnotation(ctx: CanvasRenderingContext2D, position: { x1: number; y1: number },
  drawing: { color: string; width: number; text: TextStyle }): void {
  if (![position.x1, position.y1].every(Number.isFinite)) return;
  const { text } = drawing, layout = getTextLayout(ctx, text), { x1: x, y1: y } = position;
  ctx.save(); ctx.setLineDash([]);
  if (text.background) {
    ctx.fillStyle = text.backgroundColor; ctx.globalAlpha = text.backgroundOpacity;
    ctx.fillRect(x, y, layout.width, layout.height);
  }
  ctx.globalAlpha = 1;
  if (text.border) {
    ctx.strokeStyle = text.borderColor; ctx.lineWidth = drawing.width;
    const inset = drawing.width / 2;
    ctx.strokeRect(x + inset, y + inset, layout.width - drawing.width, layout.height - drawing.width);
  }
  ctx.font = layout.font; ctx.fillStyle = drawing.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  layout.lines.forEach((line, index) => ctx.fillText(line, x + padding, y + padding + index * layout.lineHeight));
  ctx.restore();
}
