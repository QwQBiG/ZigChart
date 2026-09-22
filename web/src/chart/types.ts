import type { Bar } from '../data/contracts';

// Preserve host import compatibility; provider contracts belong to the data layer.
export type { Bar, Instrument, HistoryPage, MarketDataSource } from '../data/contracts';

export interface BarInfo extends Bar {
  index: number;
  ma: number;
  ema: number;
}

export type PriceScaleMode = 'normal' | 'logarithmic' | 'percentage' | 'indexed';

export interface PriceAxisState {
  requestedMode: number;
  effectiveMode: number;
  inverted: boolean;
  base: number;
}

export interface Frame {
  rows: Float64Array;
  meta: Float64Array;
  /** Always supplied by the current bridge; optional for older frame producers. */
  priceAxis?: PriceAxisState;
  /** Repeated [rawPrice, cssY, displayValue] triples, at most 16 ticks. */
  priceTicks?: Float64Array;
  panes?: PaneInfo[];
  /** Aligned with frame rows: [RSI, MACD, signal, histogram, RSI y, MACD y, signal y, histogram y]. */
  oscillators?: Float64Array;
  /** Row-aligned six extra average slots, each [rawValue, cssY]; absent slots are NaN. */
  averages?: Float64Array;
  /** Row-aligned [basis, upper, lower, basisY, upperY, lowerY]; unavailable values are NaN. */
  bollinger?: Float64Array;
  /** Auxiliary tick triples [paneId, rawValue, cssY]. */
  paneTicks?: Float64Array;
}

export type PaneId = 0 | 1 | 2 | 3;
export interface PaneInfo {
  id: PaneId;
  top: number;
  bottom: number;
  contentTop: number;
  contentBottom: number;
  min: number;
  max: number;
}
