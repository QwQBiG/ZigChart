import type { Frame } from '../../chart/types';

/** Selection is drawn from the shared Zig frame, so all panes mark the same candle. */
export function drawReplaySelection(ctx: CanvasRenderingContext2D, frame: Frame, index: number): void {
  const { rows, meta } = frame;
  let x = NaN;
  for (let offset = 0; offset < rows.length; offset += 17) {
    if (rows[offset] === index) { x = rows[offset + 9]; break; }
  }
  if (!Number.isFinite(x) || x < 0 || x > meta[11]) return;
  ctx.save();
  ctx.fillStyle = '#4f8cff'; ctx.globalAlpha = .08;
  ctx.fillRect(x, 0, meta[11] - x, meta[12]);
  ctx.globalAlpha = 1; ctx.strokeStyle = '#4f8cff'; ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, meta[12]); ctx.stroke();
  ctx.restore();
}
