import type { Frame } from './types';
import { formatPrice } from './format.ts';
import { getLocale } from '../ui/i18n.ts';

const formats = new Map<string, Intl.NumberFormat>();

/** Display-unit conversion only; all price projection and ticks come from the core. */
export function formatAxisPrice(price: number, frame: Frame, priceScale: number): string {
  const axis = frame.priceAxis;
  if (!axis || axis.effectiveMode < 2 || !Number.isFinite(axis.base) || axis.base === 0) return formatPrice(price, priceScale);
  const value = (price - axis.base) / Math.abs(axis.base) * 100 + (axis.effectiveMode === 3 ? 100 : 0);
  if (!Number.isFinite(value)) return '—';
  const ticks = frame.priceTicks;
  const step = ticks && ticks.length >= 6 ? Math.abs(ticks[5] - ticks[2]) : .01;
  const decimals = Math.max(2, Math.min(12, Math.ceil(-Math.log10(step || .01))));
  const key = `${getLocale()}:${decimals}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: decimals });
    formats.set(key, formatter);
  }
  return formatter.format(Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value) + (axis.effectiveMode === 2 ? '%' : '');
}
