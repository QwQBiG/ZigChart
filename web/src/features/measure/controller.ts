import type { ChartCore, DrawingAnchor, Measurement } from '../../chart/bridge';

interface Point { x: number; y: number }
interface MeasureOptions {
  getCore(): Pick<ChartCore, 'drawingPoint' | 'measure'> | null | undefined;
  getSize(): { width: number; height: number };
  onChange(): void;
}

/** Temporary anchors use loaded UTC timestamps and integer prices supplied by Zig. */
export function createMeasureController(options: MeasureOptions) {
  let active = false, complete = false;
  let a: DrawingAnchor | null = null, b: DrawingAnchor | null = null;
  let pressed: Point | null = null, finishing = false, dragged = false;
  function anchor(point: Point): DrawingAnchor | null {
    const core = options.getCore(), size = options.getSize();
    const value = core?.drawingPoint(point.x, point.y, size.width, size.height);
    return value ? { time: value.time, price: value.price } : null;
  }
  function cancel(): void {
    const changed = active || a !== null;
    active = false; complete = false; a = null; b = null; pressed = null; finishing = false; dragged = false;
    if (changed) options.onChange();
  }
  function enable(): void {
    active = true; complete = false; a = null; b = null; pressed = null; finishing = false; dragged = false;
    options.onChange();
  }
  function update(point: Point): boolean {
    const next = anchor(point);
    if (!next) return false;
    if (next.time !== b?.time || next.price !== b?.price) { b = next; options.onChange(); }
    return true;
  }
  return {
    get active() { return active; },
    get measuring() { return active && a !== null; },
    get hasResult() { return complete; },
    enable,
    toggle(): void { if (active) cancel(); else enable(); },
    down(point: Point): boolean {
      if (!active) return false;
      const next = anchor(point);
      if (!next) return true;
      finishing = a !== null; pressed = { ...point }; dragged = false;
      if (!a) a = next;
      b = { ...next }; options.onChange();
      return true;
    },
    motion(point: Point): void {
      if (!active || !a) return;
      if (pressed && Math.hypot(point.x - pressed.x, point.y - pressed.y) >= 4) dragged = true;
      update(point);
    },
    up(point: Point): void {
      if (!active || !a || !pressed) return;
      const moved = dragged || Math.hypot(point.x - pressed.x, point.y - pressed.y) >= 4;
      const valid = update(point);
      pressed = null;
      if (valid && (finishing || moved)) { active = false; complete = true; options.onChange(); }
      finishing = false; dragged = false;
    },
    cancel,
    result(): Measurement | null {
      if (!a || !b) return null;
      const size = options.getSize();
      return options.getCore()?.measure(a, b, size.width, size.height) ?? null;
    },
  };
}
