import type { Instrument } from './contracts';

export interface InstrumentEntry {
  instrument: Instrument;
  labels: Record<'en' | 'zh-CN', string>;
}

export const DEFAULT_SYMBOL = 'ZIG/USD';
export const SAMPLE_CATALOG: readonly InstrumentEntry[] = Object.freeze([
  { instrument: { symbol: DEFAULT_SYMBOL, name: 'Synthetic Market', priceScale: 100, volumeScale: 1, intervalMs: 60_000 },
    labels: { en: 'Simulated ZIG/USD', 'zh-CN': '模拟 ZIG/USD' } },
  { instrument: { symbol: 'DEMO:STOCK', name: 'Simulated stock', priceScale: 100, volumeScale: 1, intervalMs: 60_000 },
    labels: { en: 'Simulated stock', 'zh-CN': '模拟股票' } },
  { instrument: { symbol: 'DEMO:FX', name: 'Simulated FX', priceScale: 100_000, volumeScale: 1, intervalMs: 60_000 },
    labels: { en: 'Simulated FX', 'zh-CN': '模拟外汇' } },
  { instrument: { symbol: 'DEMO:INDEX', name: 'Simulated index', priceScale: 10, volumeScale: 1, intervalMs: 60_000 },
    labels: { en: 'Simulated index', 'zh-CN': '模拟指数' } },
].map(entry => Object.freeze({ instrument: Object.freeze(entry.instrument), labels: Object.freeze(entry.labels) })));

export function findSampleInstrument(symbol: string): InstrumentEntry | undefined {
  return SAMPLE_CATALOG.find(entry => entry.instrument.symbol === symbol);
}
