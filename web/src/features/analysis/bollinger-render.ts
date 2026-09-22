import type { Frame } from '../../chart/types';
import type { IndicatorState } from './model';

type Style = IndicatorState['bb'];

/** Paint only copied core projections; the price pane's clip is owned by the chart renderer. */
export function drawBollingerFill(ctx: CanvasRenderingContext2D, frame: Frame, style: Style): void {
  const values = frame.bollinger;
  if (!style.enabled || !style.showFill || !style.fillOpacity || !values || frame.meta[4] <= frame.meta[3]) return;
  const count = frame.rows.length / 17;
  const valid = (row: number) => Number.isFinite(values[row * 6 + 4]) && Number.isFinite(values[row * 6 + 5]);
  ctx.save(); ctx.fillStyle = style.fillColor; ctx.globalAlpha = style.fillOpacity;
  for (let start = 0; start < count;) {
    if (!valid(start)) { start++; continue; }
    let end = start + 1;
    while (end < count && valid(end)) end++;
    if (end - start > 1) {
      ctx.beginPath(); ctx.moveTo(frame.rows[start * 17 + 9], values[start * 6 + 4]);
      for (let row = start + 1; row < end; row++) ctx.lineTo(frame.rows[row * 17 + 9], values[row * 6 + 4]);
      for (let row = end - 1; row >= start; row--) ctx.lineTo(frame.rows[row * 17 + 9], values[row * 6 + 5]);
      ctx.closePath(); ctx.fill();
    }
    start = end;
  }
  ctx.restore();
}

export function drawBollingerLines(ctx: CanvasRenderingContext2D, frame: Frame, style: Style): void {
  const values = frame.bollinger;
  if (!style.enabled || !values || frame.meta[4] <= frame.meta[3]) return;
  ctx.save(); ctx.setLineDash([]); ctx.lineWidth = style.width;
  for (const [column, color] of [[3, style.basisColor], [4, style.upperColor], [5, style.lowerColor]] as const) {
    ctx.strokeStyle = color; ctx.beginPath();
    let started = false;
    for (let row = 0; row * 17 < frame.rows.length; row++) {
      const y = values[row * 6 + column], x = frame.rows[row * 17 + 9];
      if (!Number.isFinite(y)) { started = false; continue; }
      if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      started = true;
    }
    ctx.stroke();
  }
  ctx.restore();
}
