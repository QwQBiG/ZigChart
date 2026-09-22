import { DAY_MS, PERIODS, periodOrdinal, type PeriodId } from '../../data/periods.ts';

export const RANGE_IDS = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'] as const;
export type RangeId = typeof RANGE_IDS[number];

/** Date fields are UTC calendar days, independent of the browser's local timezone. */
export function parseUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 9999) return null;
  const time = Date.UTC(year, month - 1, day);
  return formatUtcDate(time) === value ? time : null;
}

export function formatUtcDate(time: number): string {
  if (!Number.isSafeInteger(time)) return '';
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1970 || date.getUTCFullYear() > 9999) return '';
  return date.toISOString().slice(0, 10);
}

/** Inclusive date fields become an exclusive numeric interval, capped at known market data. */
export function customRange(fromText: string, toText: string, cutoff: number): { from: number; to: number } | null {
  const from = parseUtcDate(fromText), lastDay = parseUtcDate(toText);
  if (from === null || lastDay === null || lastDay < from ||
    !Number.isSafeInteger(cutoff) || !Number.isFinite(new Date(cutoff).getTime()) || from >= cutoff) return null;
  return { from, to: Math.min(lastDay + DAY_MS, cutoff) };
}

/** UTC calendar arithmetic for the continuous sample; exchange sessions belong to the provider. */
export function rangeStart(id: RangeId, end: number): number {
  if (!Number.isSafeInteger(end) || !Number.isFinite(new Date(end).getTime())) throw new Error('Invalid range cutoff');
  if (id === 'All') return 0;
  if (id === '1D' || id === '5D') return end - (id === '1D' ? 1 : 5) * DAY_MS;
  const date = new Date(end);
  if (id === 'YTD') return Date.UTC(date.getUTCFullYear(), 0, 1);
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 }[id];
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

/** Choose a real provider resolution that fits readable candles and 20% future space. */
export function rangePeriod(id: RangeId, end: number, plotWidth: number): PeriodId {
  if (id === 'All') return '1M';
  return rangePeriodBetween(rangeStart(id, end), end, plotWidth);
}

export function rangePeriodBetween(from: number, to: number, plotWidth: number): PeriodId {
  const capacity = Math.max(10, Math.min(2000, plotWidth / 6)) * .8;
  return PERIODS.find(period => periodOrdinal(to - 1, period.id) - periodOrdinal(from, period.id) + 2 <= capacity)?.id ?? '1M';
}
