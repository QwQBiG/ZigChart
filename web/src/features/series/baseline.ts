import type { Frame } from '../../chart/types';
import type { SeriesStyle } from './model';

export interface BaselineGeometry { price: number; y: number; inverted: boolean }

/** Use the same core projection as prices; clipping never changes the raw reference value. */
export function resolveBaseline(frame: Frame, style: SeriesStyle, project: (price: number) => number): BaselineGeometry | null {
  if (style.type !== 'baseline' || frame.rows.length === 0) return null;
  let price = style.baselinePrice;
  if (style.baselineSource === 'first-visible' && frame.priceAxis && Number.isFinite(frame.priceAxis.base)) {
    price = frame.priceAxis.base;
  } else if (style.baselineSource === 'first-visible') {
    let offset = 0;
    for (let i = 0; i < frame.rows.length; i += 17) {
      if (frame.rows[i + 9] >= 0 && frame.rows[i + 9] <= frame.meta[11]) { offset = i; break; }
    }
    price = frame.rows[offset + 5];
  }
  const inverted = frame.priceAxis?.inverted ?? false;
  let y = project(price);
  if (!Number.isFinite(y)) {
    // A nonpositive reference has no logarithmic coordinate but is below all valid closes.
    if (price < frame.meta[0]) y = inverted ? frame.meta[3] : frame.meta[4];
    else if (price > frame.meta[1]) y = inverted ? frame.meta[4] : frame.meta[3];
    else return null;
  }
  return { price, y: Math.max(frame.meta[3], Math.min(frame.meta[4], y)), inverted };
}
