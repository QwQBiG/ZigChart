/** Stable numeric kinds for the additive drawing ABI. */
export const DRAWING_KINDS = { horizontal: 0, trend: 1, rectangle: 2, vertical: 3, ray: 4, extended: 5, horizontalRay: 6, fibonacci: 7, text: 8 } as const;
export type DrawingKind = keyof typeof DRAWING_KINDS;
export function isDrawingKind(value: unknown): value is DrawingKind {
  return typeof value === 'string' && Object.hasOwn(DRAWING_KINDS, value);
}
export function isSingleAnchor(kind: DrawingKind): boolean {
  return kind === 'horizontal' || kind === 'vertical' || kind === 'horizontalRay' || kind === 'text';
}
