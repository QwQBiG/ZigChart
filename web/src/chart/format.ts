import { getLocale } from '../ui/i18n.ts';

type FormatMode = 'price' | 'volume' | 'compact';
const precisions = new Map<number, number>();
const formats = new Map<string, Intl.NumberFormat>();

/** A scale must retain one integer unit in a finite decimal display. */
export function scalePrecision(scale: number): number {
  const cached = precisions.get(scale);
  if (cached !== undefined) return cached;
  if (!Number.isSafeInteger(scale) || scale <= 0) throw new RangeError('Scale must be a positive safe integer');
  let remainder = scale, twos = 0, fives = 0;
  while (remainder % 2 === 0) { remainder /= 2; twos++; }
  while (remainder % 5 === 0) { remainder /= 5; fives++; }
  const digits = Math.max(twos, fives);
  if (remainder !== 1 || digits > 20) throw new RangeError('Scale must have a terminating decimal precision of at most 20 places');
  precisions.set(scale, digits);
  return digits;
}

function format(value: number, scale: number, mode: FormatMode): string {
  const digits = scalePrecision(scale);
  const locale = getLocale();
  const key = `${locale}:${scale}:${mode}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      notation: mode === 'compact' ? 'compact' : 'standard',
      minimumFractionDigits: mode === 'price' ? digits : 0,
      maximumFractionDigits: mode === 'compact' ? Math.max(1, digits) : digits,
    });
    formats.set(key, formatter);
  }
  if (mode !== 'compact' && Number.isSafeInteger(value)) {
    // Preserve integer quotes exactly even when decimal division exceeds double precision.
    const base = 10n ** BigInt(digits);
    const units = BigInt(Math.abs(value)) * (base / BigInt(scale));
    const whole = units / base;
    const signedWhole = value < 0 ? (whole === 0n ? -0 : -whole) : whole;
    const fraction = (units % base).toString().padStart(digits, '0');
    if (mode === 'price') {
      return formatter.formatToParts(signedWhole).map(part => part.type === 'fraction' ? fraction : part.value).join('');
    }
    const remainder = digits ? fraction.replace(/0+$/, '') : '';
    const decimal = remainder ? formatter.formatToParts(1.1).find(part => part.type === 'decimal')!.value : '';
    return `${formatter.format(signedWhole)}${decimal}${remainder}`;
  }
  return formatter.format(value === 0 ? 0 : value / scale);
}

export function formatPrice(value: number, scale: number): string { return format(value, scale, 'price'); }
export function formatVolume(value: number, scale: number, compact = true): string {
  return format(value, scale, compact ? 'compact' : 'volume');
}
