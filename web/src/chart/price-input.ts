import { scalePrecision } from './format.ts';

/** Convert decimal input to integer units without rounding financial values. */
export function parsePriceInput(text: string, scale: number): number | null {
  scalePrecision(scale);
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || value.length > 64) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  if (fraction.length > 20) return null;
  const divisor = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole || '0') * divisor + BigInt(fraction || '0')) * BigInt(scale);
  if (numerator % divisor !== 0n) return null;
  const raw = (negative ? -1n : 1n) * (numerator / divisor);
  if (raw < -1_000_000_000_000n || raw > 1_000_000_000_000n) return null;
  return Number(raw);
}

export function priceInputText(price: number, scale: number): string {
  if (!Number.isSafeInteger(price) || Math.abs(price) > 1e12) {
    throw new RangeError('Price must be a safe integer within the supported range');
  }
  const digits = scalePrecision(scale), base = 10n ** BigInt(digits);
  const value = BigInt(Math.abs(price)) * (base / BigInt(scale));
  const fraction = digits ? `.${(value % base).toString().padStart(digits, '0')}` : '';
  return `${price < 0 ? '-' : ''}${value / base}${fraction}`;
}
