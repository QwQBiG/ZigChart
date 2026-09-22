import type { Measurement } from '../../chart/bridge';
import type { Frame } from '../../chart/types';

/** Both endpoints are Zig projections; measurement never changes the underlying price range. */
export function drawMeasure(ctx: CanvasRenderingContext2D, frame: Frame, value: Measurement | null): void {
  const { meta } = frame;
  if (!value || meta[4] <= meta[3] || ![value.x1, value.y1, value.x2, value.y2].every(Number.isFinite)) return;
  const { x1, y1, x2, y2 } = value;
  const color = value.priceChange < 0 ? '#ef5350' : '#4f8cff';
  ctx.save(); ctx.beginPath(); ctx.rect(0, meta[3], meta[11], meta[4] - meta[3]); ctx.clip();
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.globalAlpha = .12; ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  ctx.globalAlpha = .8; ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length > 10) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x2 - 8 * Math.cos(angle - .45), y2 - 8 * Math.sin(angle - .45));
    ctx.lineTo(x2, y2); ctx.lineTo(x2 - 8 * Math.cos(angle + .45), y2 - 8 * Math.sin(angle + .45)); ctx.stroke();
  }
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
