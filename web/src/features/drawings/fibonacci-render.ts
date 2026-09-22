import type { ProjectedFibonacciLevel } from '../../chart/bridge';
import { formatPrice } from '../../chart/format';
import { getLocale } from '../../ui/i18n';
import type { FibonacciStyle } from './fibonacci-model';

/** Consume core levels; never interpolate in screen space, including on log charts. */
export function drawFibonacci(ctx: CanvasRenderingContext2D, levels: readonly ProjectedFibonacciLevel[],
  style: FibonacciStyle, top: number, bottom: number, priceScale: number): void {
  ctx.save();
  const sorted = [...levels].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const y1 = Math.max(top, a.y), y2 = Math.min(bottom, b.y);
    if (y2 <= y1) continue;
    ctx.fillStyle = style.levels[a.slot].color; ctx.globalAlpha = style.fillOpacity;
    ctx.fillRect(a.x1, y1, a.x2 - a.x1, y2 - y1);
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash(style.lineStyle === 'dashed' ? [5, 3] : style.lineStyle === 'dotted' ? [1, 3] : []);
  ctx.font = '11px "Segoe UI", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  let previousLabel = -Infinity;
  for (const level of sorted) {
    if (level.y < top || level.y > bottom) continue;
    const color = style.levels[level.slot].color;
    ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(level.x1, level.y); ctx.lineTo(level.x2, level.y); ctx.stroke();
    if ((!style.labels && !style.prices) || level.y - previousLabel < 14 || level.y < top + 14) continue;
    const ratio = style.labels ? level.ratio.toLocaleString(getLocale(), { maximumFractionDigits: 6 }) : '';
    const price = style.prices ? formatPrice(level.price, priceScale) : '';
    const label = ratio && price ? `${ratio} (${price})` : ratio || price;
    if (level.x2 - level.x1 < ctx.measureText(label).width + 8) continue;
    ctx.fillStyle = color; ctx.fillText(label, level.x1 + 4, level.y - 3); previousLabel = level.y;
  }
  ctx.restore();
}
