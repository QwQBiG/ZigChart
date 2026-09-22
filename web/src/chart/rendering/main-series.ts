import type { Frame } from '../types';
import type { Appearance } from '../../features/appearance/model';
import type { SeriesStyle } from '../../features/series/model';
import type { BaselineGeometry } from '../../features/series/baseline';

const STRIDE = 17;
const ratio = (value: number): number => Number.isFinite(value) && value > 0 ? value : 1;

/** The core controls bar spacing and body width; the host only ensures a physical pixel. */
export function mainSeriesBarWidth(frame: Frame, pixelRatio = 1): number {
  return Math.max(1 / ratio(pixelRatio), frame.meta[7]);
}

export function mainSeriesX(x: number, pixelRatio = 1): number {
  const dpr = ratio(pixelRatio);
  return (Math.round(x * dpr) + 0.5) / dpr;
}

export function mainSeriesOhlcHalfWidth(frame: Frame, pixelRatio = 1): number {
  return mainSeriesBarWidth(frame, pixelRatio) / 2;
}

/** Draw CSS coordinates into the host's DPR transform, without retaining the frame. */
export function drawMainSeries(ctx: CanvasRenderingContext2D, frame: Frame,
  appearance: Appearance, style: SeriesStyle, pixelRatio = 1, baseline: BaselineGeometry | null = null): void {
  if (frame.rows.length === 0) return;
  const m = frame.meta;
  ctx.save();
  try {
    ctx.beginPath(); ctx.rect(0, m[3], m[11], m[4] - m[3]); ctx.clip();
    ctx.setLineDash([]);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.lineWidth = 1 / ratio(pixelRatio);
    if (style.type === 'baseline') { if (baseline) drawBaseline(ctx, frame, style, baseline, pixelRatio); }
    else if (style.type === 'line' || style.type === 'area') drawCloseSeries(ctx, frame, style, pixelRatio);
    else if (style.type === 'bars') drawOhlc(ctx, frame, appearance, pixelRatio);
    else drawCandles(ctx, frame, appearance, style.type === 'hollow', pixelRatio);
  } finally { ctx.restore(); }
}

function drawCandles(ctx: CanvasRenderingContext2D, frame: Frame, appearance: Appearance,
  hollow: boolean, pixelRatio: number): void {
  const rows = frame.rows;
  const width = mainSeriesBarWidth(frame, pixelRatio);
  const minHeight = 1 / ratio(pixelRatio);
  for (const rising of [true, false]) {
    if (appearance.showWick) {
      ctx.strokeStyle = rising ? appearance.wickUpColor : appearance.wickDownColor;
      ctx.beginPath();
      for (let i = 0; i < rows.length; i += STRIDE) {
        if ((rows[i + 5] >= rows[i + 2]) !== rising) continue;
        const x = mainSeriesX(rows[i + 9], pixelRatio);
        ctx.moveTo(x, rows[i + 11]); ctx.lineTo(x, rows[i + 12]);
      }
      ctx.stroke();
    }
    if (!appearance.showBody && !appearance.showBorder) continue;
    ctx.beginPath();
    for (let i = 0; i < rows.length; i += STRIDE) {
      if ((rows[i + 5] >= rows[i + 2]) !== rising) continue;
      const x = mainSeriesX(rows[i + 9], pixelRatio);
      ctx.rect(x - width / 2, Math.min(rows[i + 10], rows[i + 13]), width,
        Math.max(minHeight, Math.abs(rows[i + 13] - rows[i + 10])));
    }
    if (appearance.showBody) {
      ctx.fillStyle = hollow && rising ? appearance.backgroundColor : rising ? appearance.upColor : appearance.downColor;
      ctx.fill();
    }
    if (appearance.showBorder) {
      ctx.strokeStyle = rising ? appearance.borderUpColor : appearance.borderDownColor;
      ctx.stroke();
    }
  }
}

function drawOhlc(ctx: CanvasRenderingContext2D, frame: Frame, appearance: Appearance, pixelRatio: number): void {
  const rows = frame.rows;
  const half = mainSeriesOhlcHalfWidth(frame, pixelRatio);
  for (const rising of [true, false]) {
    ctx.strokeStyle = rising ? appearance.upColor : appearance.downColor;
    ctx.beginPath();
    for (let i = 0; i < rows.length; i += STRIDE) {
      if ((rows[i + 5] >= rows[i + 2]) !== rising) continue;
      const x = mainSeriesX(rows[i + 9], pixelRatio);
      ctx.moveTo(x, rows[i + 11]); ctx.lineTo(x, rows[i + 12]);
      ctx.moveTo(x - half, rows[i + 10]); ctx.lineTo(x, rows[i + 10]);
      ctx.moveTo(x, rows[i + 13]); ctx.lineTo(x + half, rows[i + 13]);
    }
    ctx.stroke();
  }
}

function closePath(ctx: CanvasRenderingContext2D, rows: Float64Array, step: boolean): void {
  ctx.beginPath();
  ctx.moveTo(rows[9], rows[13]);
  for (let i = STRIDE; i < rows.length; i += STRIDE) {
    if (step) ctx.lineTo(rows[i + 9], rows[i - STRIDE + 13]);
    ctx.lineTo(rows[i + 9], rows[i + 13]);
  }
}

function drawCloseSeries(ctx: CanvasRenderingContext2D, frame: Frame, style: SeriesStyle, pixelRatio: number): void {
  const { rows, meta: m } = frame;
  if (rows.length === STRIDE) {
    ctx.beginPath();
    ctx.arc(rows[9], rows[13], Math.max(1 / ratio(pixelRatio), style.lineWidth) / 2, 0, Math.PI * 2);
    ctx.fillStyle = style.lineColor; ctx.fill();
    return;
  }
  const step = style.lineType === 'step';
  if (style.type === 'area') {
    const gradient = ctx.createLinearGradient(0, m[3], 0, m[4]);
    gradient.addColorStop(0, `${style.areaTopColor}66`);
    gradient.addColorStop(1, `${style.areaBottomColor}0a`);
    closePath(ctx, rows, step);
    ctx.lineTo(rows[rows.length - STRIDE + 9], m[4]); ctx.lineTo(rows[9], m[4]); ctx.closePath();
    ctx.fillStyle = gradient; ctx.fill();
  }
  closePath(ctx, rows, step);
  ctx.strokeStyle = style.lineColor; ctx.lineWidth = style.lineWidth;
  ctx.stroke();
}

function drawBaseline(ctx: CanvasRenderingContext2D, frame: Frame, style: SeriesStyle,
  baseline: BaselineGeometry, pixelRatio: number): void {
  const { rows, meta: m } = frame;
  if (rows.length === STRIDE) {
    ctx.beginPath(); ctx.arc(rows[9], rows[13], Math.max(1 / ratio(pixelRatio), style.lineWidth) / 2, 0, Math.PI * 2);
    ctx.fillStyle = rows[5] >= baseline.price ? style.baselineAboveColor : style.baselineBelowColor;
    ctx.fill(); return;
  }
  for (const above of [true, false]) {
    const upperHalf = above !== baseline.inverted;
    const top = upperHalf ? m[3] : baseline.y, bottom = upperHalf ? baseline.y : m[4];
    if (bottom <= top) continue;
    const color = above ? style.baselineAboveColor : style.baselineBelowColor;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, top, m[11], bottom - top); ctx.clip();
    const fill = ctx.createLinearGradient(0, baseline.y, 0, upperHalf ? top : bottom);
    fill.addColorStop(0, `${color}0a`); fill.addColorStop(1, `${color}66`);
    closePath(ctx, rows, style.lineType === 'step');
    ctx.lineTo(rows[rows.length - STRIDE + 9], baseline.y); ctx.lineTo(rows[9], baseline.y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    closePath(ctx, rows, style.lineType === 'step');
    ctx.strokeStyle = color; ctx.lineWidth = style.lineWidth; ctx.stroke();
    ctx.restore();
  }
}
