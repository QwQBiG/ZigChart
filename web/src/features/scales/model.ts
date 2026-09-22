import type { PriceScaleMode } from '../../chart/types';

export interface ScalePreferences { version: 1; mode: PriceScaleMode; inverted: boolean }
export const DEFAULT_SCALES: Readonly<ScalePreferences> = Object.freeze({ version: 1, mode: 'normal', inverted: false });
export const SCALE_MODES: readonly PriceScaleMode[] = ['normal', 'logarithmic', 'percentage', 'indexed'];

export function parseScales(value: unknown): ScalePreferences {
  const result = { ...DEFAULT_SCALES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return result;
  if (SCALE_MODES.includes(input.mode as PriceScaleMode)) result.mode = input.mode as PriceScaleMode;
  if (typeof input.inverted === 'boolean') result.inverted = input.inverted;
  return result;
}

export function readScales(text: string | null): ScalePreferences {
  try { return parseScales(text === null ? null : JSON.parse(text)); }
  catch { return { ...DEFAULT_SCALES }; }
}
