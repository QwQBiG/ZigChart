import type { Frame } from '../../chart/types';
import { formatAxisPrice } from '../../chart/price-axis';
import type { PriceLine } from './model';

export interface PriceLineScene { lines: readonly PriceLine[]; rows: Float64Array }
function contrast(color: string): string {
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2] > .179 ? '#000000' : '#ffffff';
}

/** Consume copied geometry; custom references never expand the core price range. */
export function drawPriceLines(ctx: CanvasRenderingContext2D, frame: Frame, scene: PriceLineScene, scale: number, axisWidth: number): void {
  const m = frame.meta;
  if (m[4] <= m[3]) return;
  ctx.save(); ctx.font = '12px "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle';
  ctx.beginPath(); ctx.rect(0, m[3], m[11] + axisWidth, m[4] - m[3]); ctx.clip();
  scene.lines.forEach((line, index) => {
    const y = scene.rows[index * 3 + 1], labelY = scene.rows[index * 3 + 2];
    if (!Number.isFinite(y) || !line.visible) return;
    ctx.strokeStyle = line.color; ctx.lineWidth = line.width;
    ctx.setLineDash(line.style === 'solid' ? [] : line.style === 'dotted' ? [1, 3] : [5, 4]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m[11], y); ctx.stroke(); ctx.setLineDash([]);
    if (line.title) {
      ctx.save(); ctx.beginPath(); ctx.rect(8, m[3], Math.max(0, m[11] - 16), m[4] - m[3]); ctx.clip();
      ctx.fillStyle = line.color; ctx.textAlign = 'right';
      const titleY = y - 10 >= m[3] + 7 ? y - 10 : y + 12;
      ctx.fillText(line.title, m[11] - 8, titleY); ctx.restore();
    }
    if (line.axisLabel && Number.isFinite(labelY)) {
      ctx.fillStyle = line.color; ctx.fillRect(m[11], labelY - 10, axisWidth, 20);
      ctx.textAlign = 'left'; ctx.fillStyle = contrast(line.color);
      ctx.fillText(formatAxisPrice(line.price, frame, scale), m[11] + 8, labelY);
      if (Math.abs(labelY - y) > 2) {
        ctx.strokeStyle = line.color; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(m[11] - 4, y); ctx.lineTo(m[11], labelY); ctx.stroke();
      }
    }
  });
  ctx.restore();
}
