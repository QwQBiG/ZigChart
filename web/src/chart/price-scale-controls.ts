import type { ChartCore } from './bridge';
import type { Frame } from './types';
import { getLocale, t } from '../ui/i18n.ts';

interface PriceScaleControlOptions {
  canvas: HTMLCanvasElement;
  button: HTMLButtonElement;
  getCore(): ChartCore | undefined;
  getFrame(): Frame | null;
  getSize(): { width: number; height: number };
  canStart(): boolean;
  onBegin(): void;
  onChange(): void;
}

/** Axis input produces scale factors; the core owns price ranges and anchoring. */
export function createPriceScaleControls(options: PriceScaleControlOptions) {
  const { canvas, button } = options;
  const events = new AbortController();
  const listener = { signal: events.signal, capture: true };
  const originalTitle = canvas.title;
  let hover = false;
  let hoverLocale = getLocale();
  let feedbackSignature = '';
  let active: { id: number; startY: number; lastY: number; anchor: number; moved: boolean } | null = null;

  function axisAnchor(event: MouseEvent): number | null {
    const frame = options.getFrame();
    if (!frame || !options.getCore()?.count) return null;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const { width, height } = options.getSize();
    const m = frame.meta;
    if (!Number.isFinite(x) || !Number.isFinite(y) || m[4] <= m[3] ||
      x < m[11] || x >= width || y < m[3] || y > m[4] || y >= height) return null;
    return (y - m[3]) / (m[4] - m[3]);
  }
  function setHover(value: boolean): void {
    if (hover === value && hoverLocale === getLocale()) return;
    hover = value;
    hoverLocale = getLocale();
    canvas.classList.toggle('price-axis-hover', value);
    canvas.title = value ? t('priceScaleHint') : originalTitle;
  }
  function refresh(): void {
    const core = options.getCore();
    const automatic = core?.scaleIsAuto ?? true;
    const signature = `${getLocale()}:${automatic}:${!!core?.count}`;
    if (signature !== feedbackSignature) {
      feedbackSignature = signature;
      button.textContent = t(automatic ? 'priceScaleAuto' : 'priceScaleFixed');
      const hint = t(automatic ? 'priceScaleAutoHint' : 'priceScaleFixedHint');
      button.disabled = !core?.count;
      button.title = hint;
      button.setAttribute('aria-label', hint);
      button.setAttribute('aria-pressed', String(automatic));
      button.classList.toggle('active', automatic);
    }
    if (hover) setHover(!!core?.count);
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
    if (active || event.button !== 0 || !event.isPrimary || !options.canStart()) return;
    const anchor = axisAnchor(event);
    if (anchor === null) return;
    consume(event);
    options.onBegin();
    canvas.focus({ preventScroll: true });
    active = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, anchor, moved: false };
    canvas.setPointerCapture(event.pointerId);
    setHover(true);
  }, listener);
  canvas.addEventListener('pointermove', event => {
    if (!event.isPrimary) return;
    if (!active) { setHover(axisAnchor(event) !== null); return; }
    if (active.id !== event.pointerId) return;
    consume(event);
    if (!Number.isFinite(event.clientY)) return;
    if (!active.moved && Math.abs(event.clientY - active.startY) < 4) return;
    active.moved = true;
    const delta = event.clientY - active.lastY;
    active.lastY = event.clientY;
    if (!delta) return;
    options.getCore()?.scalePrice(Math.exp(Math.max(-1, Math.min(1, -delta * .01))), active.anchor);
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
  function reset(): void {
    const core = options.getCore();
    if (!core?.count || !options.canStart()) return;
    cancel(); options.onBegin(); core.resetScale(); refresh(); options.onChange();
  }
  canvas.addEventListener('dblclick', event => {
    if (event.button !== 0 || axisAnchor(event) === null || !options.canStart()) return;
    consume(event); reset();
  }, listener);
  button.addEventListener('click', reset, { signal: events.signal });
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const core = options.getCore();
    if (!core?.count || !options.canStart()) return;
    consume(event);
    cancel(); options.onBegin();
    core.scalePrice(event.key === 'ArrowUp' ? 1.1 : 1 / 1.1, .5);
    refresh(); options.onChange();
  }, { signal: events.signal });
  refresh();
  return { refresh, cancel, dispose() { events.abort(); cancel(); } };
}
