import { drawCrosshair, type RenderOptions } from '../../chart/render';
import type { InspectionSelection } from './types';

/** Transient inspection geometry uses the copied shared frame and never enters PNG output. */
export function drawInspection(ctx: CanvasRenderingContext2D, selection: InspectionSelection, options: RenderOptions): void {
  const { frame, bar, paneId, x, y, pointVisible } = selection;
  const color = '#4f8cff';
  drawCrosshair(ctx, frame, { x, y, index: bar.index, time: bar.time },
    { ...options, crosshairStyle: { ...options.crosshairStyle, color, vertical: true, horizontal: false } });
  const pane = frame.panes?.find(pane => pane.id === paneId);
  if (!pointVisible || !pane) return;
  ctx.save(); ctx.beginPath(); ctx.rect(0, pane.contentTop, frame.meta[11], pane.contentBottom - pane.contentTop); ctx.clip();
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = options.appearance.backgroundColor; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
}
