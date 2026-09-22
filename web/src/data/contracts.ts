import type { PeriodId } from './periods';

/** Provider values use UTC epoch milliseconds and instrument-scaled integer units. */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Instrument {
  symbol: string;
  name: string;
  priceScale: number;
  volumeScale: number;
  intervalMs: number;
}

export interface HistoryPage {
  /** Exclusive snapshot cutoff in UTC milliseconds, independent of candle resolution. */
  asOf?: number;
  periodId: PeriodId;
  bars: Bar[];
  hasMore: boolean;
  partialLastBar: boolean;
}

export interface ReplayState {
  readonly active: boolean;
  /** Exclusive simulated cutoff; candles must not include data at or beyond it. */
  readonly cutoff: number;
  /** Available source cutoff captured when a replay session starts. */
  readonly end: number;
}

/** Optional adapter capability. Replay changes the source snapshot, not chart geometry. */
export interface MarketReplay {
  readonly state: ReplayState;
  seek(cutoff: number): void;
  reset(): void;
  /** Complete the current period or add the next one, returning at most one changed bar. */
  advance(period: PeriodId, signal?: AbortSignal): Promise<HistoryPage>;
}

/** Adapters normalize provider decimals, ordering and revisions before delivery. */
export interface MarketDataSource {
  readonly replay?: MarketReplay;
  getHistory(periodId: PeriodId, before: number | undefined, limit: number, signal?: AbortSignal): Promise<HistoryPage>;
  subscribe(periodId: PeriodId, onBars: (bars: Bar[], partialLastBar: boolean) => void,
    onError: (error: Error) => void, onCorrections?: (bars: Bar[]) => void): () => void;
}
