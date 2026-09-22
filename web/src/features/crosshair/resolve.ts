import type { Frame } from '../../chart/types';
import { mainSeriesX } from '../../chart/rendering/main-series.ts';
import type { SeriesStyle } from '../series/model';
import { isCloseSeries } from '../series/model.ts';
import type { CrosshairStyle } from './model';
import { OSCILLATOR_STRIDE } from '../analysis/values.ts';

const STRIDE = 17;
export interface CrosshairPointer { x: number; y: number }
export interface ResolvedCrosshair extends CrosshairPointer {
  index: number | null;
  rawPrice?: number;
  rawVolume?: number;
  rawOscillator?: number;
  time?: number;
}

/** Resolve interaction against the projected frame, without owning scale transforms or market state. */
export function resolveCrosshair(frame: Frame, pointer: CrosshairPointer | null, style: CrosshairStyle,
  seriesStyle: SeriesStyle, pixelRatio = 1): ResolvedCrosshair | null {
  const { rows, meta: m } = frame;
  if (!pointer || style.mode === 'hidden' || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y) ||
    pointer.x < 0 || pointer.x >= m[11] || pointer.y < 0 || pointer.y > m[12]) return null;
  const result: ResolvedCrosshair = { x: pointer.x, y: pointer.y, index: null };
  const spacing = m[9] > 0 ? m[11] / m[9] : 0;
  if (!(spacing > 0 && Number.isFinite(spacing))) return result;
  let row = -1, nearest = spacing / 2;
  for (let offset = 0; offset + STRIDE <= rows.length; offset += STRIDE) {
    const delta = pointer.x - rows[offset + 9], distance = Math.abs(delta);
    if (delta >= -spacing / 2 && delta < spacing / 2 && distance <= nearest) { row = offset; nearest = distance; }
  }
  if (row < 0) return result;
  result.index = rows[row]; result.time = rows[row + 1];
  if (style.mode === 'normal') return result;
  const closeBased = isCloseSeries(seriesStyle.type);
  result.x = closeBased ? rows[row + 9] : mainSeriesX(rows[row + 9], pixelRatio);
  if (m[4] > m[3] && pointer.y >= m[3] && pointer.y <= m[4]) {
    let column = 13;
    if (style.mode === 'magnetOHLC' && !closeBased) {
      for (const candidate of [10, 11, 12]) {
        if (Math.abs(pointer.y - rows[row + candidate]) < Math.abs(pointer.y - rows[row + column])) column = candidate;
      }
    }
    const y = rows[row + column];
    if (Number.isFinite(y) && y >= m[3] && y <= m[4]) {
      result.y = y; result.rawPrice = rows[row + column - 8];
    }
  } else if (m[6] > m[5] && pointer.y >= m[5] && pointer.y <= m[6]) {
    const y = rows[row + 14];
    if (Number.isFinite(y) && y >= m[5] && y <= m[6]) {
      result.y = y; result.rawVolume = rows[row + 6];
    }
  } else if (frame.oscillators) {
    const pane = frame.panes?.find(value => value.id >= 2 && pointer.y >= value.contentTop && pointer.y <= value.contentBottom);
    if (!pane) return result;
    const offset = row / STRIDE * OSCILLATOR_STRIDE;
    let nearest = Infinity;
    for (const column of pane.id === 2 ? [4] : [5, 6, 7]) {
      const y = frame.oscillators[offset + column], value = frame.oscillators[offset + column - 4];
      if (!Number.isFinite(y) || !Number.isFinite(value) || y < pane.contentTop || y > pane.contentBottom) continue;
      const distance = Math.abs(pointer.y - y);
      if (distance < nearest) { nearest = distance; result.y = y; result.rawOscillator = value; }
    }
  }
  return result;
}
