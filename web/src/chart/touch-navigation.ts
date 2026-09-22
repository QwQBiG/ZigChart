import type { ChartCore } from './bridge';

interface Point { x: number; y: number }
interface Sample { distance: number; center: number }
interface Options {
  canvas: HTMLCanvasElement;
  getCore(): ChartCore | undefined;
  getSize(): { width: number; height: number };
  onBegin(): void;
  requestPaint(): void;
}

/** Observe one touch; claim two and drain remaining contacts before allowing a new gesture. */
export function createTouchNavigation(options: Options) {
  const points = new Map<number, Point>();
  let mode: 'single' | 'pinch' | 'drain' = 'single';
  let previous: Sample | null = null, pending = false, moved = false;
  let size = { width: 0, height: 0 };
  const finite = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y);
  function sample(): Sample {
    const [a, b] = [...points.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), center: (a.x + b.x) / 2 };
  }
  function release(id: number) {
    if (options.canvas.hasPointerCapture(id)) options.canvas.releasePointerCapture(id);
  }
  function cancel() {
    const ids = [...points.keys()]; points.clear(); mode = 'single';
    previous = null; pending = false; moved = false;
    for (const id of ids) release(id);
  }
  function flush(): boolean {
    if (!pending || mode !== 'pinch' || !previous) return false;
    pending = false;
    const currentSize = options.getSize();
    if (!options.getCore()?.count || currentSize.width !== size.width || currentSize.height !== size.height) { cancel(); return false; }
    const next = sample();
    if (next.distance < 8 || previous.distance < 8) { previous = next; return false; }
    if (!moved && Math.max(Math.abs(next.distance - previous.distance), Math.abs(next.center - previous.center)) < 4) return false;
    moved = true;
    options.getCore()?.transformView(next.distance / previous.distance, previous.center / size.width, next.center / size.width);
    previous = next;
    return true;
  }
  function down(id: number, point: Point): boolean {
    if (mode !== 'single') {
      // Additional fingers suspend navigation until the entire contact group is released.
      flush(); mode = 'drain'; points.set(id, point); options.canvas.setPointerCapture(id); return true;
    }
    const bounds = options.getSize();
    if (!options.getCore()?.count || !finite(point) || bounds.width <= 0 || bounds.height <= 0 ||
      point.x < 0 || point.x >= bounds.width || point.y < 0 || point.y >= bounds.height) return false;
    points.set(id, point);
    if (points.size < 2) return false;
    options.onBegin();
    size = bounds; mode = 'pinch'; previous = sample(); pending = false; moved = false;
    for (const pointerId of points.keys()) options.canvas.setPointerCapture(pointerId);
    options.requestPaint(); return true;
  }
  function move(id: number, point: Point): boolean {
    if (!points.has(id)) return mode !== 'single';
    if (finite(point)) points.set(id, point);
    if (mode === 'single') return false;
    if (mode === 'pinch') { pending = true; options.requestPaint(); }
    return true;
  }
  function end(id: number, cancelled: boolean): boolean {
    if (!points.has(id)) return false;
    const claimed = mode !== 'single';
    if (claimed && !cancelled && flush()) options.requestPaint();
    points.delete(id);
    if (claimed) {
      mode = points.size ? 'drain' : 'single'; previous = null; pending = false;
      release(id); options.requestPaint();
    }
    return claimed;
  }
  return { down, move, end, flush, cancel, get active() { return mode !== 'single'; } };
}
