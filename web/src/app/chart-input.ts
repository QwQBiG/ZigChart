import type { ChartCore, DrawingTextBounds } from '../chart/bridge';
import type { Frame } from '../chart/types';
import type { ChartInvalidation } from '../chart/scheduler';
import type { createTouchNavigation } from '../chart/touch-navigation';
import type { Appearance } from '../features/appearance/model';
import type { Drawing } from '../features/drawings/document';
import type { DrawingEditor } from '../features/drawings/editor';
import type { createMeasureController } from '../features/measure/controller';
import type { SeriesStyle } from '../features/series/model';
import { hitMainSeries, hitSeriesHandle } from '../features/series/selection.ts';
import { resolveBaseline } from '../features/series/baseline.ts';

interface Point { x: number; y: number }
interface Drag {
  id: number; x: number; start: Point; moved: boolean;
  target: 'handle' | 'candle' | 'replay' | null;
}
interface Options {
  canvas: HTMLCanvasElement;
  getCore(): ChartCore | undefined;
  getFrame(): Frame | null;
  getEditor(): DrawingEditor;
  getSize(): { width: number; height: number; pageHeight: number; pixelRatio: number };
  getAppearance(): Appearance;
  getSeriesStyle(): SeriesStyle;
  isSeriesSelected(): boolean;
  isReplayChoosing(): boolean;
  touch: ReturnType<typeof createTouchNavigation>;
  measure: ReturnType<typeof createMeasureController>;
  textBounds(items: readonly Drawing[]): readonly (DrawingTextBounds | null)[];
  selectSeries(selected: boolean): void;
  openSeriesSettings(): void;
  openTextSettings(): void;
  selectReplay(time: number): void;
  startMeasurement(preserveTouches: boolean): void;
  cancelRange(): void;
  loadHistory(): void;
  followLatest(): void;
  clearTooltip(): void;
  syncAxisTitle(): void;
  paint(level: ChartInvalidation): void;
}

/** One pointer/capture owner; mutable market and editor state is resolved at event time. */
export function createChartInput(options: Options) {
  const { canvas, touch, measure } = options;
  const events = new AbortController(), listener = { signal: events.signal };
  let pointer: Point | null = null, drag: Drag | null = null;
  let drawingPointerId: number | null = null, measurePointerId: number | null = null;
  function release(id: number | null | undefined): void {
    if (id != null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function clearPointer(): void { pointer = null; options.clearTooltip(); }
  function clearMeasurement(): void {
    const captured = measurePointerId;
    measurePointerId = null; measure.cancel(); release(captured);
  }
  function cancel(preserveTouches = false): void {
    const captured = measurePointerId ?? drawingPointerId ?? drag?.id;
    measurePointerId = null; drawingPointerId = null; drag = null; measure.cancel();
    if (!preserveTouches) { touch.cancel(); release(captured); }
    options.getEditor().cancel(); clearPointer(); canvas.classList.remove('dragging');
  }
  function position(event: MouseEvent): Point {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function inPlot(point: Point): boolean {
    const size = options.getSize();
    return point.x >= 0 && point.x < size.width && point.y >= 0 && point.y < size.height;
  }
  function selectReplayAt(x: number): void {
    const core = options.getCore();
    if (!core) return;
    const index = core.hit(x, options.getSize().width), bar = index >= 0 ? core.inspect(index) : null;
    if (bar) options.selectReplay(bar.time);
  }

  canvas.addEventListener('pointerdown', event => {
    const core = options.getCore(), editor = options.getEditor(), frame = options.getFrame();
    if (!core?.count || event.button !== 0) return;
    const point = position(event), size = options.getSize();
    if (event.pointerType === 'touch' && touch.down(event.pointerId, point)) { event.preventDefault(); return; }
    if (touch.active || !event.isPrimary || !inPlot(point)) return;
    if (options.isReplayChoosing()) {
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: point.x, start: point, moved: false, target: 'replay' };
      pointer = point; event.preventDefault(); options.paint('overlay'); return;
    }
    canvas.focus({ preventScroll: true });
    if (event.shiftKey && !measure.active && editor.tool === 'pointer'
      && core.drawingPoint(point.x, point.y, size.width, size.height)) {
      options.startMeasurement(event.pointerType === 'touch');
    }
    if (measure.active) {
      if (measure.down(point)) {
        measurePointerId = event.pointerId; canvas.setPointerCapture(event.pointerId);
        pointer = point; event.preventDefault(); options.paint('overlay');
      }
      return;
    }
    if (measure.hasResult) clearMeasurement();
    const placingText = editor.tool === 'text';
    if (editor.down(point)) {
      options.selectSeries(false);
      if (placingText && editor.tool === 'pointer' && editor.document.selection?.kind === 'text') options.openTextSettings();
      if (editor.dragging) { drawingPointerId = event.pointerId; canvas.setPointerCapture(event.pointerId); }
      options.paint('full'); return;
    }
    canvas.setPointerCapture(event.pointerId);
    const style = options.getSeriesStyle();
    const handle = options.isSeriesSelected() && frame && hitSeriesHandle(frame, point, style, size.pixelRatio) !== null;
    const baseline = frame && resolveBaseline(frame, style, price => core.priceToY(price, size.width, size.height));
    const candle = frame && hitMainSeries(frame, point, options.getAppearance(), style, size.pixelRatio, baseline?.y) !== null;
    drag = { id: event.pointerId, x: point.x, start: point, moved: false, target: handle ? 'handle' : candle ? 'candle' : null };
    pointer = point; options.paint('full');
  }, listener);
  canvas.addEventListener('dblclick', event => {
    const core = options.getCore(), editor = options.getEditor();
    if (!core?.count || editor.tool !== 'pointer' || measure.active || options.isReplayChoosing()) return;
    const point = position(event), items = editor.document.items, size = options.getSize();
    if (!inPlot(point)) return;
    const hit = core.hitDrawings(items, size.width, size.height, point.x, point.y, 6, options.textBounds(items));
    if (!hit || items[hit.index].kind !== 'text') return;
    editor.document.selected = items[hit.index].id; options.openTextSettings(); event.preventDefault();
  }, listener);
  canvas.addEventListener('pointermove', event => {
    const core = options.getCore(), editor = options.getEditor(), frame = options.getFrame();
    if (!core?.count) return;
    const point = position(event);
    if (event.pointerType === 'touch' && touch.move(event.pointerId, point)) { event.preventDefault(); return; }
    if (touch.active || !event.isPrimary) return;
    options.syncAxisTitle();
    if (measure.active) {
      measure.motion(point); pointer = inPlot(point) ? point : null; options.paint('overlay'); return;
    }
    if (!options.isReplayChoosing()) editor.motion(point);
    if (drag && drag.id === event.pointerId && frame) {
      if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= 4) {
        options.cancelRange(); drag.moved = true; canvas.classList.add('dragging');
      }
      if (drag.moved) {
        core.pan(-(point.x - drag.x) / options.getSize().width * frame.meta[9]); drag.x = point.x;
      }
    }
    pointer = inPlot(point) ? point : null;
    options.paint(drag?.moved || editor.drawing || editor.dragging ? 'full' : 'overlay');
    if (drag?.moved) options.loadHistory();
  }, listener);

  function endDrag(event: PointerEvent): void {
    if (touch.end(event.pointerId, event.type !== 'pointerup')) { event.preventDefault(); return; }
    if (measurePointerId === event.pointerId) {
      measurePointerId = null;
      if (event.type === 'pointerup') measure.up(position(event)); else measure.cancel();
      release(event.pointerId); options.paint('overlay'); return;
    }
    if (drawingPointerId === event.pointerId) {
      drawingPointerId = null;
      if (event.type === 'pointerup') options.getEditor().up(); else options.getEditor().cancel();
      release(event.pointerId); options.paint('full'); return;
    }
    if (drag?.id !== event.pointerId) return;
    const finished = drag;
    drag = null; canvas.classList.remove('dragging'); release(event.pointerId);
    const point = position(event);
    const clicked = event.type === 'pointerup' && !finished.moved && Math.hypot(point.x - finished.start.x, point.y - finished.start.y) < 4;
    if (clicked) {
      if (finished.target === 'replay' && inPlot(point)) selectReplayAt(point.x);
      else if (finished.target === 'handle') options.openSeriesSettings();
      else options.selectSeries(finished.target === 'candle');
    }
    options.paint('full');
  }
  canvas.addEventListener('pointerup', endDrag, listener);
  canvas.addEventListener('pointercancel', endDrag, listener);
  canvas.addEventListener('lostpointercapture', endDrag, listener);
  canvas.addEventListener('pointerleave', () => {
    options.syncAxisTitle();
    if (!drag) { clearPointer(); options.paint('overlay'); }
  }, listener);
  canvas.addEventListener('wheel', event => {
    const core = options.getCore(), editor = options.getEditor();
    if (!core?.count) return;
    const point = position(event);
    if (!inPlot(point)) return;
    event.preventDefault();
    if (touch.active || editor.dragging || editor.drawing) return;
    clearMeasurement();
    const size = options.getSize();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.pageHeight : 1);
    options.cancelRange();
    core.zoom(Math.exp(Math.max(-1, Math.min(1, -delta * .0015))), point.x / size.width);
    pointer = point; options.paint('full'); options.loadHistory();
  }, { ...listener, passive: false });
  canvas.addEventListener('keydown', event => {
    const core = options.getCore(), editor = options.getEditor(), frame = options.getFrame();
    if (!core?.count || !frame || touch.active || editor.dragging || editor.drawing) return;
    switch (event.key) {
      case 'Enter':
        if (options.isReplayChoosing()) {
          if (pointer) selectReplayAt(pointer.x);
          else if (frame.rows.length) options.selectReplay(frame.rows[frame.rows.length - 17 + 1]);
          event.preventDefault(); return;
        }
        if (frame.meta[4] <= frame.meta[3]) return;
        clearMeasurement();
        if (options.isSeriesSelected()) options.openSeriesSettings();
        else { editor.document.selected = null; editor.setTool('pointer'); options.selectSeries(true); }
        event.preventDefault(); return;
      case 'ArrowLeft': clearMeasurement(); core.pan(-frame.meta[9] * .1); break;
      case 'ArrowRight': clearMeasurement(); core.pan(frame.meta[9] * .1); break;
      case '+': case '=': clearMeasurement(); core.zoom(1.25, .5); break;
      case '-': case '_': clearMeasurement(); core.zoom(.8, .5); break;
      case 'End': event.preventDefault(); options.followLatest(); return;
      default: return;
    }
    options.cancelRange(); event.preventDefault(); clearPointer(); options.paint('full'); options.loadHistory();
  }, listener);

  return {
    get pointer() { return pointer; },
    get dragging() { return drag !== null; },
    cancel, clearMeasurement,
    dispose(): void { events.abort(); cancel(); },
  };
}
