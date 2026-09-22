import type { BarInfo, Frame, Instrument } from './types';
import type { PeriodId } from '../data/periods';
import { resolvePalette } from '../features/appearance/model';
import type { Appearance } from '../features/appearance/model';
import { timeAxisTicks } from './time-axis';
import { getLocale } from '../ui/i18n';
import type { Locale } from '../ui/i18n';
import type { IndicatorState } from '../features/analysis/model';
import { drawStudyOverlays, drawVolumePane, drawOscillatorPanes } from '../features/analysis/render';
import { drawBollingerFill } from '../features/analysis/bollinger-render';
import { formatOscillator } from '../features/analysis/values';
import { formatVolume } from './format';
import { drawMainSeries } from './rendering/main-series';
import type { SeriesStyle } from '../features/series/model';
import { resolveBaseline } from '../features/series/baseline';
import type { CrosshairStyle } from '../features/crosshair/model';
import type { ResolvedCrosshair } from '../features/crosshair/resolve';
import { formatAxisPrice } from './price-axis';

export const AXIS_WIDTH = 86;
export const TIME_HEIGHT = 30;
const font = '11px "Segoe UI", Arial, sans-serif';
function createFormats(locale: Locale) {
  const dateLocale = locale === 'en' ? 'en-GB' : locale;
  return {
    time: new Intl.DateTimeFormat(dateLocale, { timeZone: 'UTC', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }),
    intraday: new Intl.DateTimeFormat(dateLocale, { timeZone: 'UTC', hourCycle: 'h23', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    date: new Intl.DateTimeFormat(dateLocale, { timeZone: 'UTC', hourCycle: 'h23', year: 'numeric', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    day: new Intl.DateTimeFormat(dateLocale, { timeZone: 'UTC', year: '2-digit', month: 'short', day: 'numeric' }),
    month: new Intl.DateTimeFormat(dateLocale, { timeZone: 'UTC', year: 'numeric', month: 'short' }),
  };
}
const formats = { en: createFormats('en'), 'zh-CN': createFormats('zh-CN') };

export function formatTime(value: number): string { return `${formats[getLocale()].date.format(value)} UTC`; }
export interface RenderOptions {
  appearance: Appearance;
  seriesStyle: SeriesStyle;
  pixelRatio: number;
  period: PeriodId;
  instrument: Instrument;
  indicators: IndicatorState;
  crosshairStyle: CrosshairStyle;
  priceToY(price: number): number;
  priceAtY(y: number): number;
  paneValueToY(pane: number, value: number): number;
  paneValueAtY(pane: number, y: number): number;
  latest: BarInfo | null;
}

export function drawChart(ctx: CanvasRenderingContext2D, frame: Frame, width: number, height: number, options: RenderOptions): void {
  const { meta: m } = frame;
  const plotW = m[11];
  const plotH = m[12];
  const colors = resolvePalette(options.appearance);
  const appearance = options.appearance;
  ctx.fillStyle = appearance.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = colors.border;
  ctx.beginPath();
  ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, plotH);
  ctx.moveTo(0, plotH + 0.5); ctx.lineTo(width, plotH + 0.5);
  ctx.stroke();
  const ticks = frame.priceTicks ?? [];
  for (let tick = 0; tick < ticks.length; tick += 3) {
    const value = ticks[tick], y = ticks[tick + 1];
    ctx.strokeStyle = appearance.gridColor;
    if (appearance.showGrid) {
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(plotW, Math.round(y) + 0.5); ctx.stroke();
    }
    ctx.fillStyle = colors.muted; ctx.textAlign = 'left';
    ctx.fillText(formatAxisPrice(value, frame, options.instrument.priceScale), plotW + 8, y);
  }
  ctx.fillStyle = colors.muted; ctx.textAlign = 'left';
  ctx.font = font;
  if (!frame.paneTicks && options.indicators.volume.enabled && m[6] > m[5]) {
    ctx.fillText(formatVolume(m[2], options.instrument.volumeScale), plotW + 8, m[5] + 3);
    ctx.fillText('0', plotW + 11, m[6]);
  }
  drawPaneAxes(ctx, frame, options);
  drawTimeAxis(ctx, frame, options);
  if (m[4] > m[3]) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, m[3], plotW, m[4] - m[3]); ctx.clip();
    drawBollingerFill(ctx, frame, options.indicators.bb);
    drawMainSeries(ctx, frame, appearance, options.seriesStyle, options.pixelRatio,
      resolveBaseline(frame, options.seriesStyle, options.priceToY));
    drawStudyOverlays(ctx, frame, options.indicators);
    ctx.restore();
  }
  drawVolumePane(ctx, frame, options.indicators.volume, options.pixelRatio);
  drawOscillatorPanes(ctx, frame, options.indicators, options.pixelRatio, options.paneValueToY);
  if (appearance.showLastPrice && options.latest) drawLastPrice(ctx, frame, options.latest, options);
}

function drawPaneAxes(ctx: CanvasRenderingContext2D, frame: Frame, options: RenderOptions): void {
  const m = frame.meta, palette = resolvePalette(options.appearance);
  ctx.lineWidth = 1; ctx.strokeStyle = palette.border; ctx.beginPath();
  for (const [index, pane] of (frame.panes ?? []).entries()) {
    if (index === 0) continue;
    const y = Math.round(pane.top) + .5;
    ctx.moveTo(0, y); ctx.lineTo(m[11] + AXIS_WIDTH, y);
  }
  ctx.stroke(); ctx.textAlign = 'left'; ctx.font = font;
  const ticks = frame.paneTicks ?? [];
  for (let offset = 0; offset < ticks.length; offset += 3) {
    const id = ticks[offset], value = ticks[offset + 1], y = ticks[offset + 2];
    if (options.appearance.showGrid || (id === 3 && value === 0)) {
      ctx.strokeStyle = id === 3 && value === 0 ? palette.muted : options.appearance.gridColor;
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(m[11], Math.round(y) + .5); ctx.stroke();
    }
    ctx.fillStyle = palette.muted;
    const label = id === 1 ? formatVolume(value, options.instrument.volumeScale)
      : formatOscillator(value, id, options.instrument.priceScale);
    ctx.fillText(label, m[11] + 8, y);
  }
}

function drawTimeAxis(ctx: CanvasRenderingContext2D, frame: Frame, options: RenderOptions): void {
  const m = frame.meta;
  ctx.font = font; ctx.fillStyle = resolvePalette(options.appearance).muted; ctx.textAlign = 'center';
  const ticks = timeAxisTicks(frame, options.period);
  const calendar = ['1d', '1w', '1M'].includes(options.period);
  const acrossDays = ticks.length > 1 && ticks.at(-1)!.time - ticks[0].time >= 86_400_000;
  for (const { time, x } of ticks) {
    const format = options.period === '1M' ? formats[getLocale()].month : calendar ? formats[getLocale()].day :
      acrossDays ? formats[getLocale()].intraday : formats[getLocale()].time;
    ctx.fillText(format.format(time), x, m[12] + 16);
    if (options.appearance.showGrid) {
      ctx.strokeStyle = options.appearance.gridColor; ctx.beginPath();
      const panes = frame.panes ?? [{ contentTop: m[3], contentBottom: m[4] }];
      for (const pane of panes) {
        ctx.moveTo(Math.round(x) + 0.5, pane.contentTop); ctx.lineTo(Math.round(x) + 0.5, pane.contentBottom);
      }
      ctx.stroke();
    }
  }
}

function axisLabel(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string, textColor = '#11181b'): void {
  ctx.fillStyle = color; ctx.fillRect(x, y - 10, AXIS_WIDTH, 20);
  ctx.font = font; ctx.fillStyle = textColor; ctx.textAlign = 'left'; ctx.fillText(value, x + 10, y);
}

function drawLastPrice(ctx: CanvasRenderingContext2D, frame: Frame, latest: BarInfo, options: RenderOptions): void {
  const m = frame.meta;
  const y = options.priceToY(latest.close);
  if (!Number.isFinite(y) || y < m[3] || y > m[4]) return;
  const baseline = resolveBaseline(frame, options.seriesStyle, options.priceToY);
  const color = baseline ? latest.close >= baseline.price ? options.seriesStyle.baselineAboveColor : options.seriesStyle.baselineBelowColor
    : options.seriesStyle.type === 'line' || options.seriesStyle.type === 'area'
    ? options.seriesStyle.lineColor : latest.close >= latest.open ? options.appearance.upColor : options.appearance.downColor;
  ctx.strokeStyle = color; ctx.globalAlpha = .65; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m[11], y); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  axisLabel(ctx, formatAxisPrice(latest.close, frame, options.instrument.priceScale), m[11], y, color);
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, frame: Frame, cursor: ResolvedCrosshair, options: RenderOptions): void {
  const { meta: m } = frame;
  const { x, y } = cursor;
  const style = options.crosshairStyle;
  const components = [1, 3, 5].map(offset => parseInt(style.color.slice(offset, offset + 2), 16));
  const labelText = components[0] * .299 + components[1] * .587 + components[2] * .114 > 150 ? '#111111' : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = style.color; ctx.lineWidth = style.width;
  ctx.setLineDash(style.lineStyle === 'solid' ? [] : style.lineStyle === 'dotted' ? [1, 3] : [4, 4]);
  const inPrice = m[4] > m[3] && y >= m[3] && y <= m[4];
  const inVolume = options.indicators.volume.enabled && m[6] > m[5] && y >= m[5] && y <= m[6];
  const oscillatorPane = frame.panes?.find(pane => pane.id >= 2 && y >= pane.contentTop && y <= pane.contentBottom);
  ctx.beginPath();
  if (style.vertical) { ctx.moveTo(x, 0); ctx.lineTo(x, m[12]); }
  if (style.horizontal && (inPrice || inVolume || oscillatorPane)) { ctx.moveTo(0, y); ctx.lineTo(m[11], y); }
  ctx.stroke(); ctx.setLineDash([]);
  if (style.horizontal && inPrice) {
    const price = cursor.rawPrice ?? options.priceAtY(y);
    if (Number.isFinite(price)) axisLabel(ctx, formatAxisPrice(price, frame, options.instrument.priceScale), m[11], y, style.color, labelText);
  } else if (style.horizontal && inVolume) {
    const volume = cursor.rawVolume ?? options.paneValueAtY(1, y);
    axisLabel(ctx, formatVolume(volume, options.instrument.volumeScale), m[11], y, style.color, labelText);
  } else if (style.horizontal && oscillatorPane) {
    const value = cursor.rawOscillator ?? options.paneValueAtY(oscillatorPane.id, y);
    if (Number.isFinite(value)) axisLabel(ctx, formatOscillator(value, oscillatorPane.id, options.instrument.priceScale), m[11], y, style.color, labelText);
  }
  if (!style.vertical || cursor.time === undefined) return;
  const label = formats[getLocale()].date.format(cursor.time);
  ctx.font = font;
  const labelWidth = ctx.measureText(label).width + 16;
  const left = Math.max(0, Math.min(m[11] - labelWidth, x - labelWidth / 2));
  ctx.fillStyle = style.color; ctx.fillRect(left, m[12] + 2, labelWidth, 25);
  ctx.fillStyle = labelText; ctx.textAlign = 'center'; ctx.fillText(label, left + labelWidth / 2, m[12] + 15);
}
