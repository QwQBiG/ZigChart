/** Stable source IDs shared with the additive Wasm indicator configuration. */
export const INDICATOR_SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;
export type IndicatorSource = typeof INDICATOR_SOURCES[number];

export function indicatorSourceCode(source: unknown): number | null {
  const index = INDICATOR_SOURCES.indexOf(source as IndicatorSource);
  return index < 0 ? null : index;
}
