export const SERIES_TYPES = ['candles', 'hollow', 'bars', 'line', 'area', 'baseline'] as const;
export type SeriesType = typeof SERIES_TYPES[number];
export interface SeriesStyle {
  version: 2;
  type: SeriesType;
  lineColor: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineType: 'simple' | 'step';
  areaTopColor: string;
  areaBottomColor: string;
  baselineSource: 'first-visible' | 'price';
  baselinePrice: number;
  baselineAboveColor: string;
  baselineBelowColor: string;
}

export const DEFAULT_SERIES_STYLE: Readonly<SeriesStyle> = Object.freeze({
  version: 2, type: 'candles', lineColor: '#2962ff', lineWidth: 2, lineType: 'simple',
  areaTopColor: '#2962ff', areaBottomColor: '#dbe7ff',
  baselineSource: 'first-visible', baselinePrice: 0, baselineAboveColor: '#26a69a', baselineBelowColor: '#ef5350',
});

export function isCloseSeries(type?: SeriesType): boolean {
  return type === 'line' || type === 'area' || type === 'baseline';
}

export function isSeriesType(value: unknown): value is SeriesType {
  return typeof value === 'string' && SERIES_TYPES.some(type => type === value);
}

/** Series styling is independent of chart theme, indicators and market data. */
export function parseSeriesStyle(value: unknown): SeriesStyle {
  const result = { ...DEFAULT_SERIES_STYLE };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 && input.version !== 2) return result;
  if (isSeriesType(input.type)) result.type = input.type;
  for (const key of ['lineColor', 'areaTopColor', 'areaBottomColor', 'baselineAboveColor', 'baselineBelowColor'] as const) {
    if (typeof input[key] === 'string' && /^#[\da-f]{6}$/i.test(input[key])) result[key] = input[key].toLowerCase();
  }
  if (input.lineWidth === 1 || input.lineWidth === 2 || input.lineWidth === 3 || input.lineWidth === 4) {
    result.lineWidth = input.lineWidth;
  }
  if (input.lineType === 'simple' || input.lineType === 'step') result.lineType = input.lineType;
  if (input.baselineSource === 'first-visible' || input.baselineSource === 'price') result.baselineSource = input.baselineSource;
  if (typeof input.baselinePrice === 'number' && Number.isSafeInteger(input.baselinePrice)
    && Math.abs(input.baselinePrice) <= 1e12) result.baselinePrice = input.baselinePrice;
  return result;
}

export function readSeriesStyle(text: string | null): SeriesStyle {
  try { return parseSeriesStyle(text === null ? null : JSON.parse(text)); }
  catch { return { ...DEFAULT_SERIES_STYLE }; }
}
