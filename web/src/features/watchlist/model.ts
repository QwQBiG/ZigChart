import type { Bar } from '../../chart/types';

export const WATCHLIST_KEY = 'zigchart.watchlist';
export interface WatchlistState { version: 1; symbols: string[] }
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createWatchlist(symbol: string): WatchlistState {
  return { version: 1, symbols: [symbol] };
}

/** Unsupported symbols are excluded; an intentionally empty list stays empty. */
export function parseWatchlist(value: unknown, supported: readonly string[]): WatchlistState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.symbols) || candidate.symbols.length > 256
    || candidate.symbols.some(symbol => typeof symbol !== 'string' || symbol.length > 100)) return null;
  return { version: 1, symbols: [...new Set(candidate.symbols as string[])].filter(symbol => supported.includes(symbol)) };
}

export function setWatched(state: WatchlistState, symbol: string, watched: boolean, supported: readonly string[]): WatchlistState {
  if (watched && state.symbols.includes(symbol)) return { version: 1, symbols: [...state.symbols] };
  const symbols = state.symbols.filter(item => item !== symbol);
  if (watched && supported.includes(symbol) && symbols.length < 256) symbols.push(symbol);
  return { version: 1, symbols };
}

export function readWatchlist(storage: PreferenceStorage | undefined, symbol: string, supported: readonly string[] = [symbol]): WatchlistState {
  const fallback = () => supported.includes(symbol) ? createWatchlist(symbol) : { version: 1 as const, symbols: [] };
  try {
    const raw = storage?.getItem(WATCHLIST_KEY);
    return (raw ? parseWatchlist(JSON.parse(raw), supported) : null) ?? fallback();
  } catch { return fallback(); }
}

export function saveWatchlist(storage: PreferenceStorage | undefined, state: WatchlistState): boolean {
  if (!storage) return false;
  try { storage.setItem(WATCHLIST_KEY, JSON.stringify(state)); return true; }
  catch { return false; }
}

/** Change belongs to this candle; no session or previous-day quote is inferred. */
export function candleChange(bar: Pick<Bar, 'open' | 'close'>): { units: number; percent: number | null } {
  const units = bar.close - bar.open;
  return { units, percent: bar.open === 0 ? null : units / bar.open * 100 };
}
