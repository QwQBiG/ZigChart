export type PeriodId = '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m'
  | '1h' | '2h' | '4h' | '6h' | '12h' | '1d' | '1w' | '1M';

export interface Period {
  readonly id: PeriodId;
  readonly unit: 'minute' | 'hour' | 'day' | 'week' | 'month';
  readonly multiplier: number;
  readonly intervalMs?: number;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);

export const PERIODS: readonly Period[] = [
  ...[1, 2, 3, 5, 10, 15, 30].map(multiplier => ({
    id: `${multiplier}m` as PeriodId, unit: 'minute' as const, multiplier,
    intervalMs: multiplier * MINUTE_MS,
  })),
  ...[1, 2, 4, 6, 12].map(multiplier => ({
    id: `${multiplier}h` as PeriodId, unit: 'hour' as const, multiplier,
    intervalMs: multiplier * 60 * MINUTE_MS,
  })),
  { id: '1d', unit: 'day', multiplier: 1, intervalMs: DAY_MS },
  { id: '1w', unit: 'week', multiplier: 1, intervalMs: 7 * DAY_MS },
  { id: '1M', unit: 'month', multiplier: 1 },
];

export function getPeriod(id: string): Period {
  const period = PERIODS.find(item => item.id === id);
  if (!period) throw new Error(`Unsupported period: ${id}`);
  return period;
}

/** Ordinals are stable calendar slots, independent of pagination and loaded bars. */
export function periodOrdinal(time: number, id: PeriodId): number {
  if (!Number.isSafeInteger(time) || !Number.isFinite(new Date(time).getTime())) {
    throw new Error('Invalid period timestamp');
  }
  const period = getPeriod(id);
  if (period.unit === 'month') {
    const date = new Date(time);
    return date.getUTCFullYear() * 12 + date.getUTCMonth();
  }
  return Math.floor((time - (period.unit === 'week' ? MONDAY_EPOCH : 0)) / period.intervalMs!);
}

/** These boundaries describe the synthetic UTC, 24/7 fixture, not exchange sessions. */
export function bucketStart(time: number, id: PeriodId): number {
  const ordinal = periodOrdinal(time, id);
  const period = getPeriod(id);
  if (period.unit === 'month') {
    const date = new Date(0);
    date.setUTCFullYear(Math.floor(ordinal / 12), ordinal % 12, 1);
    return date.getTime();
  }
  return ordinal * period.intervalMs! + (period.unit === 'week' ? MONDAY_EPOCH : 0);
}

export function nextBucketStart(time: number, id: PeriodId): number {
  const start = bucketStart(time, id);
  const period = getPeriod(id);
  if (period.unit !== 'month') return start + period.intervalMs!;
  const date = new Date(start);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}
