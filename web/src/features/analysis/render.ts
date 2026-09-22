import type { Frame } from '../../chart/types';
import type { IndicatorState } from './model';
import { mainSeriesBarWidth, mainSeriesX } from '../../chart/rendering/main-series.ts';
import { OSCILLATOR_STRIDE } from './values.ts';
import { drawBollingerLines } from './bollinger-render.ts';

const STRIDE = 17;

export function drawStudyOverlays(ctx: CanvasRenderingContext2D, frame: Frame, studies: IndicatorState): void {
  drawBollingerLines(ctx, frame, studies.bb);
  for (const [id, column] of [['ma', 15], ['ema', 16]] as const) {
    const style = studies[id];
    if (!style.enabled) continue;
    ctx.strokeStyle = style.color; ctx.lineWidth = style.width; ctx.beginPath();
    let started = false;
    for (let i = 0; i < frame.rows.length; i += STRIDE) {
      const y = frame.rows[i + column];
      if (!Number.isFinite(y)) { started = false; continue; }
      if (started) ctx.lineTo(frame.rows[i + 9], y);
      else ctx.moveTo(frame.rows[i + 9], y);
      started = true;
    }
    ctx.stroke();
  }
  if (frame.averages) {
    for (const style of studies.averages) {
      const slot = Number(style.id.slice(8)) - 1;
      ctx.strokeStyle = style.color; ctx.lineWidth = style.width; ctx.beginPath();
      let started = false;
      for (let row = 0; row * STRIDE < frame.rows.length; row++) {
        const y = frame.averages[row * 12 + slot * 2 + 1], x = frame.rows[row * STRIDE + 9];
        if (!Number.isFinite(y)) { started = false; continue; }
        if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        started = true;
      }
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;
}

export function drawVolumePane(ctx: CanvasRenderingContext2D, frame: Frame, style: IndicatorState['volume'], pixelRatio = 1): void {
  if (!style.enabled || frame.meta[6] <= frame.meta[5]) return;
  const { rows, meta: m } = frame;
  const barWidth = mainSeriesBarWidth(frame, pixelRatio);
  ctx.save(); ctx.beginPath(); ctx.rect(0, m[5], m[11], m[6] - m[5]); ctx.clip();
  ctx.globalAlpha = style.opacity;
  for (const rising of [true, false]) {
    ctx.fillStyle = rising ? style.upColor : style.downColor;
    ctx.beginPath();
    for (let i = 0; i < rows.length; i += STRIDE) {
      if ((rows[i + 5] >= rows[i + 2]) !== rising) continue;
      ctx.rect(mainSeriesX(rows[i + 9], pixelRatio) - barWidth / 2, rows[i + 14], barWidth, Math.max(1 / pixelRatio, m[6] - rows[i + 14]));
    }
    ctx.fill();
  }
  ctx.restore();
}

export function drawOscillatorPanes(ctx: CanvasRenderingContext2D, frame: Frame, studies: IndicatorState,
  pixelRatio: number, valueToY: (pane: number, value: number) => number): void {
  const values = frame.oscillators;
  if (!values?.length) return;
  const plotWidth = frame.meta[11];
  function line(column: number, color: string, width: number) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    let started = false;
    for (let row = 0; row * STRIDE < frame.rows.length; row++) {
      const y = values![row * OSCILLATOR_STRIDE + column];
      if (!Number.isFinite(y)) { started = false; continue; }
      const x = frame.rows[row * STRIDE + 9];
      if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      started = true;
    }
    ctx.stroke();
  }
  for (const pane of frame.panes ?? []) {
    if (pane.id < 2 || pane.contentBottom <= pane.contentTop) continue;
    ctx.save(); ctx.beginPath();
    ctx.rect(0, pane.contentTop, plotWidth, pane.contentBottom - pane.contentTop); ctx.clip();
    ctx.setLineDash([]);
    if (pane.id === 2 && studies.rsi.enabled) {
      const style = studies.rsi;
      if (style.showLevels) {
        const high = valueToY(2, style.upper), low = valueToY(2, style.lower);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          ctx.fillStyle = style.color; ctx.globalAlpha = .07; ctx.fillRect(0, high, plotWidth, low - high);
          ctx.globalAlpha = .5; ctx.strokeStyle = style.color; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(0, high); ctx.lineTo(plotWidth, high); ctx.moveTo(0, low); ctx.lineTo(plotWidth, low); ctx.stroke();
          ctx.globalAlpha = 1; ctx.setLineDash([]);
        }
      }
      line(4, style.color, style.width);
    } else if (pane.id === 3 && studies.macd.enabled) {
      const style = studies.macd, zero = valueToY(3, 0);
      const barWidth = mainSeriesBarWidth(frame, pixelRatio);
      if (Number.isFinite(zero)) {
        for (const positive of [true, false]) {
          ctx.fillStyle = positive ? style.positiveColor : style.negativeColor; ctx.beginPath();
          for (let row = 0; row * STRIDE < frame.rows.length; row++) {
            const offset = row * OSCILLATOR_STRIDE, value = values[offset + 3], y = values[offset + 7];
            if (!Number.isFinite(y) || !Number.isFinite(value) || value === 0 || (value >= 0) !== positive) continue;
            ctx.rect(mainSeriesX(frame.rows[row * STRIDE + 9], pixelRatio) - barWidth / 2,
              Math.min(y, zero), barWidth, Math.max(1 / pixelRatio, Math.abs(y - zero)));
          }
          ctx.fill();
        }
      }
      line(5, style.lineColor, style.width); line(6, style.signalColor, style.width);
    }
    ctx.restore();
  }
}
