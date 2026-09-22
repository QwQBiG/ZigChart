import type { Frame } from '../../chart/types';
import type { Appearance } from '../appearance/model';
import type { SeriesStyle } from './model';
import { isCloseSeries } from './model.ts';
import { mainSeriesBarWidth, mainSeriesOhlcHalfWidth, mainSeriesX } from '../../chart/rendering/main-series.ts';

const STRIDE = 17;
const HANDLE_RADIUS = 4;
const HIT_RADIUS = 6;
const EDGE_TOLERANCE = 2;
export interface SeriesPoint { x: number; y: number }
export interface CandleVisibility { body?: boolean; border?: boolean; wick?: boolean; hollowRising?: boolean }

function inPricePane(frame: Frame, point: SeriesPoint): boolean {
  const m = frame.meta;
  return Number.isFinite(point.x) && Number.isFinite(point.y) && m[4] > m[3] &&
    point.x >= 0 && point.x < m[11] && point.y >= m[3] && point.y <= m[4];
}

function distanceToSegment(point: SeriesPoint, start: SeriesPoint, end: SeriesPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
  return (point.x - start.x - dx * ratio) ** 2 + (point.y - start.y - dy * ratio) ** 2;
}

function seriesCenter(rows: Float64Array, offset: number, style?: SeriesStyle, pixelRatio = 1): SeriesPoint {
  const closeBased = isCloseSeries(style?.type);
  return { x: closeBased ? rows[offset + 9] : style ? mainSeriesX(rows[offset + 9], pixelRatio) : Math.round(rows[offset + 9]) + .5,
    y: closeBased ? rows[offset + 13] : (rows[offset + 10] + rows[offset + 13]) / 2 };
}

/** Legacy candle hit contract retained for integrations without a series style. */
export function hitCandle(frame: Frame, point: SeriesPoint, visibility: CandleVisibility = {}): number | null {
  if (!inPricePane(frame, point)) return null;
  const { rows, meta } = frame;
  const halfWidth = Math.max(1, Math.min(20, meta[7])) / 2;
  let result: number | null = null, closest = Infinity;
  for (let i = 0; i + STRIDE <= rows.length; i += STRIDE) {
    const x = Math.round(rows[i + 9]) + 0.5;
    const top = Math.min(rows[i + 10], rows[i + 13]);
    const height = Math.max(1, Math.abs(rows[i + 13] - rows[i + 10]));
    const bottom = top + height;
    const dx = Math.abs(point.x - x);
    const dy = Math.abs(point.y - (rows[i + 10] + rows[i + 13]) / 2);
    const hollow = visibility.hollowRising === true && rows[i + 5] >= rows[i + 2];
    const body = visibility.body !== false && (!hollow || visibility.border !== false) && dx <= halfWidth &&
      point.y >= top - (height === 1 ? EDGE_TOLERANCE : 0) &&
      point.y <= bottom + (height === 1 ? EDGE_TOLERANCE : 0);
    const border = visibility.border !== false && dx <= halfWidth + EDGE_TOLERANCE &&
      point.y >= top - EDGE_TOLERANCE && point.y <= bottom + EDGE_TOLERANCE &&
      (Math.abs(dx - halfWidth) <= EDGE_TOLERANCE ||
        Math.abs(point.y - top) <= EDGE_TOLERANCE || Math.abs(point.y - bottom) <= EDGE_TOLERANCE);
    const wick = visibility.wick !== false && dx <= EDGE_TOLERANCE &&
      point.y >= rows[i + 11] && point.y <= rows[i + 12] &&
      !(hollow && visibility.body !== false && dx <= halfWidth && point.y >= top && point.y <= bottom);
    const distance = dx * dx + dy * dy;
    if ((body || border || wick) && distance < closest) { result = rows[i]; closest = distance; }
  }
  return result;
}

/** Hit only visible primitives in the current main-series renderer and price pane. */
export function hitMainSeries(frame: Frame, point: SeriesPoint, appearance: Appearance, style: SeriesStyle,
  pixelRatio = 1, baselineY?: number): number | null {
  if (!inPricePane(frame, point)) return null;
  if (isCloseSeries(style.type)) return hitClosePath(frame, point, style, pixelRatio, baselineY);
  const { rows } = frame;
  const halfWidth = mainSeriesBarWidth(frame, pixelRatio) / 2;
  const halfTick = mainSeriesOhlcHalfWidth(frame, pixelRatio);
  const pixel = 1 / (Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1);
  let result: number | null = null, closest = Infinity;
  for (let i = 0; i + STRIDE <= rows.length; i += STRIDE) {
    const x = mainSeriesX(rows[i + 9], pixelRatio);
    const open = rows[i + 10], close = rows[i + 13], high = rows[i + 11], low = rows[i + 12];
    const dx = Math.abs(point.x - x);
    let hit: boolean;
    if (style.type === 'bars') {
      const distance = Math.min(
        distanceToSegment(point, { x, y: high }, { x, y: low }),
        distanceToSegment(point, { x: x - halfTick, y: open }, { x, y: open }),
        distanceToSegment(point, { x, y: close }, { x: x + halfTick, y: close }));
      hit = distance <= (EDGE_TOLERANCE + pixel / 2) ** 2;
    } else {
      const top = Math.min(open, close), height = Math.max(pixel, Math.abs(close - open)), bottom = top + height;
      const hollow = style.type === 'hollow' && rows[i + 5] >= rows[i + 2];
      const interior = dx <= halfWidth && point.y >= top && point.y <= bottom;
      const dojiTolerance = height === pixel ? EDGE_TOLERANCE : 0;
      const body = appearance.showBody && !hollow && dx <= halfWidth &&
        point.y >= top - dojiTolerance && point.y <= bottom + dojiTolerance;
      const border = appearance.showBorder && dx <= halfWidth + EDGE_TOLERANCE &&
        point.y >= top - EDGE_TOLERANCE && point.y <= bottom + EDGE_TOLERANCE &&
        (Math.abs(dx - halfWidth) <= EDGE_TOLERANCE || Math.abs(point.y - top) <= EDGE_TOLERANCE ||
          Math.abs(point.y - bottom) <= EDGE_TOLERANCE);
      const wick = appearance.showWick && dx <= EDGE_TOLERANCE + pixel / 2 &&
        point.y >= Math.min(high, low) && point.y <= Math.max(high, low) && !(hollow && appearance.showBody && interior);
      hit = body || border || wick;
    }
    const distance = dx * dx + (point.y - (open + close) / 2) ** 2;
    if (hit && distance < closest) { result = rows[i]; closest = distance; }
  }
  return result;
}

function hitClosePath(frame: Frame, point: SeriesPoint, style: SeriesStyle, pixelRatio: number, baselineY?: number): number | null {
  const { rows, meta } = frame;
  if (rows.length === STRIDE) {
    const dpr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    const radius = Math.max(1 / (2 * dpr), style.lineWidth / 2);
    const distance = (point.x - rows[9]) ** 2 + (point.y - rows[13]) ** 2;
    return distance <= (radius + 3) ** 2 ? rows[0] : null;
  }
  const tolerance = (3 + style.lineWidth / 2) ** 2;
  let result: number | null = null, closest = Infinity;
  for (let i = STRIDE; i + STRIDE <= rows.length; i += STRIDE) {
    const previous = i - STRIDE;
    const start = { x: rows[previous + 9], y: rows[previous + 13] };
    const end = { x: rows[i + 9], y: rows[i + 13] };
    if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || end.x < start.x) continue;
    const corner = { x: end.x, y: start.y };
    let distance = style.lineType === 'step' ? Math.min(distanceToSegment(point, start, corner),
      distanceToSegment(point, corner, end)) : distanceToSegment(point, start, end);
    if ((style.type === 'area' || (style.type === 'baseline' && Number.isFinite(baselineY))) && point.x >= start.x && point.x <= end.x) {
      const ratio = end.x === start.x ? 1 : (point.x - start.x) / (end.x - start.x);
      const boundary = style.lineType === 'step' ? start.y : start.y + ratio * (end.y - start.y);
      const base = style.type === 'baseline' ? baselineY! : meta[4];
      if (point.y >= Math.min(boundary, base) && point.y <= Math.max(boundary, base)) distance = 0;
    }
    if (distance <= tolerance && distance < closest) {
      result = Math.abs(point.x - start.x) <= Math.abs(point.x - end.x) ? rows[previous] : rows[i];
      closest = distance;
    }
  }
  return result;
}

/** Only visible center handles are actionable; the nearest center wins in dense views. */
export function hitSeriesHandle(frame: Frame, point: SeriesPoint, style?: SeriesStyle, pixelRatio = 1): number | null {
  if (!inPricePane(frame, point)) return null;
  const { rows } = frame;
  let result: number | null = null, closest = HIT_RADIUS * HIT_RADIUS;
  for (let i = 0; i + STRIDE <= rows.length; i += STRIDE) {
    const center = seriesCenter(rows, i, style, pixelRatio);
    if (!inPricePane(frame, center)) continue;
    const distance = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
    if (distance <= closest) { result = rows[i]; closest = distance; }
  }
  return result;
}

/** Consume the current core frame without retaining its borrowed rows or deriving price coordinates. */
export function drawSeriesSelection(ctx: CanvasRenderingContext2D, frame: Frame, color: string, background: string,
  style?: SeriesStyle, pixelRatio = 1): void {
  const { rows, meta: m } = frame;
  if (m[4] <= m[3] || m[11] <= 0) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, m[3], m[11], m[4] - m[3]); ctx.clip();
  ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.lineWidth = 1.5;
  ctx.fillStyle = background; ctx.strokeStyle = color;
  const radius = Math.max(1.5, Math.min(HANDLE_RADIUS, m[11] / Math.max(1, m[9]) * .3));
  ctx.beginPath();
  for (let i = 0; i + STRIDE <= rows.length; i += STRIDE) {
    const center = seriesCenter(rows, i, style, pixelRatio);
    if (!inPricePane(frame, center)) continue;
    ctx.moveTo(center.x + radius, center.y);
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  }
  ctx.fill(); ctx.stroke(); ctx.restore();
}
