import type { Frame } from '../../chart/types';
import type { Drawing } from './document';
import type { ProjectedDrawing } from '../../chart/bridge';
import type { Appearance } from '../appearance/model';
import { isSingleAnchor } from '../../chart/drawing-types';
import { drawFibonacci } from './fibonacci-render';
import { drawTextAnnotation } from './text-render';

export function drawAnnotations(ctx: CanvasRenderingContext2D, frame: Frame,
  drawings: readonly Drawing[], positions: readonly ProjectedDrawing[], selected: string | null,
  appearance: Appearance, priceScale = 1): void {
  const m = frame.meta;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, m[3], m[11], m[4] - m[3]); ctx.clip();
  for (let i = 0; i < drawings.length; i++) {
    const drawing = drawings[i];
    const point = positions[i];
    if (!point?.valid) continue;
    ctx.strokeStyle = drawing.color;
    ctx.fillStyle = drawing.color;
    ctx.lineWidth = drawing.width;
    if (drawing.kind === 'text' && drawing.text) drawTextAnnotation(ctx, point, { ...drawing, text: drawing.text });
    if (drawing.kind === 'fibonacci' && drawing.fibonacci && point.levels) {
      drawFibonacci(ctx, point.levels, drawing.fibonacci, m[3], m[4], priceScale);
    }
    ctx.setLineDash(drawing.locked ? [5, 3] : []);
    ctx.beginPath();
    if (drawing.kind === 'rectangle') {
      ctx.rect(Math.min(point.x1, point.x2), Math.min(point.y1, point.y2),
        Math.abs(point.x2 - point.x1), Math.abs(point.y2 - point.y1));
      ctx.globalAlpha = .1; ctx.fill(); ctx.globalAlpha = 1;
    } else if (point.stroke) {
      const line = point.stroke;
      ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2);
      if (line.x1 === line.x2 && line.y1 === line.y2) {
        ctx.arc(line.x1, line.y1, drawing.width / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.stroke(); ctx.setLineDash([]);
    if (drawing.id === selected) {
      ctx.fillStyle = appearance.backgroundColor;
      ctx.lineWidth = 2;
      for (const [x, y] of isSingleAnchor(drawing.kind) ? [[point.x1, point.y1]] : [[point.x1, point.y1], [point.x2, point.y2]]) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }
  ctx.restore();
}
