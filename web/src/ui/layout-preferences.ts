export const DEFAULT_PANE_WEIGHTS: readonly number[] = Object.freeze([.74, .26, .26, .26]);
export const DEFAULT_PANE_ORDER: readonly number[] = Object.freeze([0, 1, 2, 3]);
export interface LayoutPreferences { version: 3; sidebarWidth: number; paneWeights: number[]; paneOrder: number[] }

export function defaultLayout(): LayoutPreferences {
  return { version: 3, sidebarWidth: 264, paneWeights: [...DEFAULT_PANE_WEIGHTS], paneOrder: [...DEFAULT_PANE_ORDER] };
}

/** Persist relative weights, never derived pixel geometry or a second viewport. */
export function parseLayout(value: unknown): LayoutPreferences {
  const result = defaultLayout();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  const input = value as Record<string, unknown>;
  if (input.version !== 1 && input.version !== 2 && input.version !== 3) return result;
  if (typeof input.sidebarWidth === 'number' && Number.isFinite(input.sidebarWidth)) {
    result.sidebarWidth = Math.max(220, input.sidebarWidth);
  }
  if (input.version === 1) {
    const ratio = typeof input.priceFraction === 'number' && Number.isFinite(input.priceFraction)
      ? Math.max(.3, Math.min(.85, input.priceFraction)) : .74;
    result.paneWeights = [ratio, 1 - ratio, .26, .26];
  } else if (Array.isArray(input.paneWeights) && input.paneWeights.length === 4 &&
    Array.from(input.paneWeights).every(weight => typeof weight === 'number' && Number.isFinite(weight) && weight > 0)) {
    result.paneWeights = [...input.paneWeights];
  }
  const order = input.paneOrder;
  if (input.version === 3 && Array.isArray(order) && order.length === 4 && [0, 1, 2, 3].every(id => order.includes(id))) {
    result.paneOrder = [...order];
  }
  return result;
}

export function readLayout(text: string | null): LayoutPreferences {
  try { return parseLayout(text === null ? null : JSON.parse(text)); }
  catch { return defaultLayout(); }
}
