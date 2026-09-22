export interface Appearance {
  version: 3;
  theme: 'dark' | 'light';
  upColor: string;
  downColor: string;
  borderUpColor: string;
  borderDownColor: string;
  wickUpColor: string;
  wickDownColor: string;
  backgroundColor: string;
  gridColor: string;
  showGrid: boolean;
  showLastPrice: boolean;
  showBody: boolean;
  showBorder: boolean;
  showWick: boolean;
  candleStyle: 'solid' | 'hollow';
}

export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({
  version: 3, theme: 'dark',
  upColor: '#26a69a', downColor: '#ef5350', backgroundColor: '#000000',
  borderUpColor: '#26a69a', borderDownColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  gridColor: '#202020',
  showGrid: true, showLastPrice: true, candleStyle: 'solid',
  showBody: true, showBorder: true, showWick: true,
});

export function appearanceForTheme(theme: Appearance['theme']): Appearance {
  return theme === 'light' ? {
    ...DEFAULT_APPEARANCE, theme, backgroundColor: '#ffffff', gridColor: '#edf0f5',
    upColor: '#089981', downColor: '#f23645',
    borderUpColor: '#089981', borderDownColor: '#f23645',
    wickUpColor: '#089981', wickDownColor: '#f23645',
  } : { ...DEFAULT_APPEARANCE };
}

const colorFields = ['upColor', 'downColor', 'backgroundColor', 'gridColor'] as const;
const candleColorFields = ['borderUpColor', 'borderDownColor', 'wickUpColor', 'wickDownColor'] as const;

/** Unknown versions reset as a unit; malformed fields fall back to the selected theme. */
export function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_APPEARANCE };
  const input = value as Record<string, unknown>;
  if (input.version !== 1 && input.version !== 2 && input.version !== 3) return { ...DEFAULT_APPEARANCE };
  const result = appearanceForTheme(input.theme === 'light' ? 'light' : 'dark');
  for (const field of colorFields) {
    const color = input[field];
    if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) result[field] = color.toLowerCase();
  }
  // Upgrade the previous dark preset while retaining explicitly customized colors.
  if (input.version === 1 && result.theme === 'dark') {
    if (result.backgroundColor === '#131722') result.backgroundColor = '#000000';
    if (result.gridColor === '#242b3a') result.gridColor = '#202020';
  }
  if (input.version < 3) {
    result.borderUpColor = result.wickUpColor = result.upColor;
    result.borderDownColor = result.wickDownColor = result.downColor;
  } else {
    for (const field of candleColorFields) {
      const color = input[field];
      if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) result[field] = color.toLowerCase();
    }
  }
  for (const field of ['showGrid', 'showLastPrice', 'showBody', 'showBorder', 'showWick'] as const) {
    if (typeof input[field] === 'boolean') result[field] = input[field];
  }
  if (input.candleStyle === 'solid' || input.candleStyle === 'hollow') result.candleStyle = input.candleStyle;
  return result;
}

export function readAppearance(text: string | null): Appearance {
  try { return parseAppearance(text === null ? null : JSON.parse(text)); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function resolvePalette(appearance: Appearance) {
  return {
    ...appearance,
    ...(appearance.theme === 'light' ? {
      text: '#242a38', muted: '#667085', surface: '#f6f8fc', border: '#dfe4ed',
      crosshair: '#67748a', labelText: '#ffffff',
    } : {
      text: '#e6e6e6', muted: '#959595', surface: '#0b0b0b', border: '#292929',
      crosshair: '#898989', labelText: '#ffffff',
    }),
  };
}
