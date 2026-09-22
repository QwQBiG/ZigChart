export const CROSSHAIR_MODES = ['normal', 'magnet', 'hidden', 'magnetOHLC'] as const;
export type CrosshairMode = typeof CROSSHAIR_MODES[number];
export interface CrosshairStyle {
  version: 1;
  mode: CrosshairMode;
  color: string;
  width: 1 | 2 | 3;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  vertical: boolean;
  horizontal: boolean;
}

export const DEFAULT_CROSSHAIR_STYLE: Readonly<CrosshairStyle> = Object.freeze({
  version: 1, mode: 'normal', color: '#787b86', width: 1, lineStyle: 'dashed', vertical: true, horizontal: true,
});

export function parseCrosshairStyle(value: unknown): CrosshairStyle {
  const result = { ...DEFAULT_CROSSHAIR_STYLE };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.version !== 1) return result;
  if (CROSSHAIR_MODES.some(mode => mode === input.mode)) result.mode = input.mode as CrosshairMode;
  if (typeof input.color === 'string' && /^#[\da-f]{6}$/i.test(input.color)) result.color = input.color.toLowerCase();
  if (input.width === 1 || input.width === 2 || input.width === 3) result.width = input.width;
  if (input.lineStyle === 'solid' || input.lineStyle === 'dashed' || input.lineStyle === 'dotted') result.lineStyle = input.lineStyle;
  if (typeof input.vertical === 'boolean') result.vertical = input.vertical;
  if (typeof input.horizontal === 'boolean') result.horizontal = input.horizontal;
  return result;
}

export function readCrosshairStyle(text: string | null): CrosshairStyle {
  try { return parseCrosshairStyle(text === null ? null : JSON.parse(text)); }
  catch { return { ...DEFAULT_CROSSHAIR_STYLE }; }
}
