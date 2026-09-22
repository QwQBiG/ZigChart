import type { Frame } from '../../chart/types';
import { scalePrecision } from '../../chart/format.ts';
import { getLocale } from '../../ui/i18n.ts';

export const OSCILLATOR_STRIDE = 8;
export interface OscillatorValues { rsi: number; macd: number; signal: number; histogram: number }
export interface BollingerValues { basis: number; upper: number; lower: number }
const formats = new Map<string, Intl.NumberFormat>();

export function bollingerValuesAt(frame: Frame | null, index: number): BollingerValues | null {
  if (!frame?.bollinger || !frame.rows.length) return null;
  const row = index - frame.rows[0], offset = row * 6;
  if (!Number.isInteger(row) || row < 0 || frame.rows[row * 17] !== index || offset + 6 > frame.bollinger.length) return null;
  const [basis, upper, lower] = frame.bollinger.subarray(offset, offset + 3);
  return { basis, upper, lower };
}

export function averageValuesAt(frame: Frame | null, index: number): number[] {
  if (!frame?.averages || !frame.rows.length) return [];
  const row = index - frame.rows[0];
  if (!Number.isInteger(row) || row < 0 || frame.rows[row * 17] !== index) return [];
  return Array.from({ length: 6 }, (_, slot) => frame.averages![row * 12 + slot * 2]);
}

/** Look up the same source bar in the copied, row-aligned oscillator batch. */
export function oscillatorValuesAt(frame: Frame | null, index: number): OscillatorValues | null {
  if (!frame?.oscillators || !frame.rows.length) return null;
  const row = index - frame.rows[0];
  const offset = row * OSCILLATOR_STRIDE;
  if (!Number.isInteger(row) || row < 0 || frame.rows[row * 17] !== index || offset + 8 > frame.oscillators.length) return null;
  const values = frame.oscillators;
  return { rsi: values[offset], macd: values[offset + 1], signal: values[offset + 2], histogram: values[offset + 3] };
}

/** Oscillators are fractional results; MACD uses the instrument's price units. */
export function formatOscillator(value: number, pane: number, priceScale: number): string {
  if (!Number.isFinite(value)) return '—';
  const scale = pane === 2 ? 1 : priceScale;
  const digits = pane === 2 ? 2 : Math.min(20, scalePrecision(scale) + 2);
  const key = `${getLocale()}:${digits}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: digits });
    formats.set(key, formatter);
  }
  const scaled = value / scale;
  return formatter.format(Math.abs(scaled) < 0.5 * 10 ** -digits ? 0 : scaled);
}
