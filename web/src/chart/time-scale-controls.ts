import type { ChartCore } from './bridge';
import type { Frame } from './types';
import { getLocale } from '../ui/i18n.ts';

interface TimeScaleControlOptions {
  canvas: HTMLCanvasElement;
  getCore(): ChartCore | undefined;
  getFrame(): Frame | null;
  getSize(): { width: number; height: number };
  canStart(): boolean;
  onBegin(): void;
  onChange(): void;
  onFollow?(): void;
}

const hints = {
  en: 'Drag right to zoom in, left to zoom out. Scroll to zoom; double-click to follow the latest bars.',
  'zh-CN': '向右拖动放大，向左拖动缩小。滚轮缩放；双击跟随最新 K 线。',
};

/** CSS-pixel axis gestures delegate viewport changes to the shared core. */
export function createTimeScaleControls(options: TimeScaleControlOptions) {
  const { canvas } = options;
  const events = new AbortController();
  const listener = { signal: events.signal, capture: true };
  let hover = false;
  let active: { id: number; startX: number; lastX: number; moved: boolean } | null = null;

  function axisAnchor(event: MouseEvent): number | null {
    const frame = options.getFrame();
    if (!frame || !options.getCore()?.count) return null;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const { width, height } = options.getSize();
    const plotWidth = frame.meta[11], plotHeight = frame.meta[12];
    if (![x, y, width, height, plotWidth, plotHeight].every(Number.isFinite) || plotWidth <= 0 ||
      plotHeight < 0 || x < 0 || x >= plotWidth || x >= width || y < plotHeight || y >= height) return null;
    return x / plotWidth;
  }
  function setHover(value: boolean): void {
    hover = value;
    canvas.classList.toggle('time-axis-hover', value);
    // The host owns the shared canvas title, including the price-axis hint.
    if (value) canvas.setAttribute('data-time-axis-hint', hints[getLocale()]);
    else canvas.removeAttribute('data-time-axis-hint');
  }
  function refresh(): void {
    if (!options.getCore()?.count) cancel();
    else if (hover) setHover(true);
  }
  function cancel(): void {
    const previous = active;
    active = null;
    setHover(false);
    if (previous && canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
  }
  function consume(event: Event): void {
    event.preventDefault(); event.stopImmediatePropagation();
  }
  canvas.addEventListener('pointerdown', event => {
    if (active || event.button !== 0 || !event.isPrimary || !options.canStart() ||
      canvas.hasPointerCapture(event.pointerId) || axisAnchor(event) === null) return;
    consume(event);
    options.onBegin();
    canvas.focus({ preventScroll: true });
    active = { id: event.pointerId, startX: event.clientX, lastX: event.clientX, moved: false };
    canvas.setPointerCapture(event.pointerId);
    setHover(true);
  }, listener);
  canvas.addEventListener('pointermove', event => {
    if (!event.isPrimary) return;
    if (!active) {
      setHover(options.canStart() && !canvas.hasPointerCapture(event.pointerId) && axisAnchor(event) !== null);
      return;
    }
    if (active.id !== event.pointerId) return;
    consume(event);
    if (!Number.isFinite(event.clientX)) return;
    if (!active.moved && Math.abs(event.clientX - active.startX) < 4) return;
    active.moved = true;
    const delta = event.clientX - active.lastX;
    active.lastX = event.clientX;
    if (!delta) return;
    options.getCore()?.zoom(Math.exp(Math.max(-1, Math.min(1, delta * .01))), 1);
    refresh(); options.onChange();
  }, listener);
  const finish = (event: PointerEvent) => {
    if (active?.id !== event.pointerId) return;
    consume(event);
    const overAxis = event.type === 'pointerup' && axisAnchor(event) !== null;
    cancel(); setHover(overAxis); refresh();
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(name, finish, listener);
  }
  canvas.addEventListener('pointerleave', () => { if (!active) setHover(false); }, listener);
  canvas.addEventListener('wheel', event => {
    if (active || !options.canStart()) return;
    const anchor = axisAnchor(event);
    if (anchor === null || !Number.isFinite(event.deltaY) || !event.deltaY) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? options.getSize().height : 1;
    const factor = Math.exp(Math.max(-1, Math.min(1, -event.deltaY * unit * .0015)));
    consume(event);
    options.onBegin();
    options.getCore()?.zoom(factor, anchor);
    setHover(true); refresh(); options.onChange();
  }, { ...listener, passive: false });
  canvas.addEventListener('dblclick', event => {
    if (event.button !== 0 || !options.canStart() || axisAnchor(event) === null) return;
    consume(event);
    cancel(); options.onBegin();
    if (options.onFollow) options.onFollow(); else options.getCore()?.follow();
    refresh(); options.onChange();
  }, listener);
  return { refresh, cancel, dispose() { events.abort(); cancel(); } };
}
