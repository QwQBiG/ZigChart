import type { Frame } from '../chart/types';
import { getLocale } from './i18n.ts';
import { DEFAULT_PANE_WEIGHTS } from './layout-preferences.ts';

export interface PaneResizeCore {
  setPaneWeights(weights: readonly number[]): void;
  getPaneWeights(): number[];
  resizePane(upperId: number, deltaPixels: number, height: number): void;
}
interface PaneBounds { id: number; top: number; bottom: number }
interface PaneResizerOptions {
  container: HTMLElement;
  first: HTMLElement;
  getCore(): PaneResizeCore | undefined;
  getWeights(): number[];
  onWeights(weights: number[]): void;
  onCommit(): void;
  onStart(): void;
  requestPaint(): void;
}
const messages = {
  en: { names: ['Price', 'Volume', 'RSI', 'MACD'], label: 'Resize',
    hint: 'Drag or use Up/Down to resize. Home/End reaches the limit; double-click restores this pair. Escape cancels.' },
  'zh-CN': { names: ['价格', '成交量', 'RSI', 'MACD'], label: '调整图窗',
    hint: '拖动或按上／下调整大小。Home／End 到达边界；双击恢复这对图窗。Esc 取消。' },
};

/** The core supplies bounds and clamps; the host batches only boundary deltas. */
export function createPaneResizers(options: PaneResizerOptions) {
  const events = new AbortController();
  const listener = { signal: events.signal };
  const nodes = [options.first];
  const pairs = new Map<HTMLElement, { upper: number; lower: number }>();
  const pending = new Map<number, { lower: number; delta: number; reset: boolean }>();
  let frame: Frame | null = null;
  let restore: number[] | null = null;
  let active: { element: HTMLElement; pointer: number; startY: number; lastY: number;
    upper: number; lower: number; moved: boolean; weights: number[] } | null = null;
  const setAttribute = (node: HTMLElement, name: string, value: string) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  function bounds(value: Frame): PaneBounds[] {
    if (value.panes) return value.panes;
    const m = value.meta;
    if (!(m[12] > 0 && m[6] > m[5])) return [];
    const split = (m[4] + m[5]) / 2;
    return [{ id: 0, top: 0, bottom: split }, { id: 1, top: split, bottom: m[12] }];
  }
  function cancel(schedule = true): void {
    if (!active) return;
    const previous = active;
    active = null;
    pending.clear();
    if (previous.moved) {
      restore = previous.weights;
      options.onWeights([...restore]);
      if (schedule) options.requestPaint();
    }
    previous.element.classList.remove('resizing');
    if (previous.element.hasPointerCapture(previous.pointer)) previous.element.releasePointerCapture(previous.pointer);
  }
  function queue(upper: number, lower: number, delta: number, replace = false): void {
    const previous = pending.get(upper);
    pending.set(upper, { lower, delta: replace ? delta : (previous?.delta ?? 0) + delta, reset: previous?.reset ?? false });
    options.requestPaint();
  }
  function refresh(): void {
    const text = messages[getLocale()];
    for (const [node, pair] of pairs) {
      setAttribute(node, 'aria-label', `${text.label}: ${text.names[pair.upper]} / ${text.names[pair.lower]}`);
      if (node.title !== text.hint) node.title = text.hint;
    }
  }
  function bind(node: HTMLElement): void {
    node.classList.add('pane-resizer');
    setAttribute(node, 'role', 'separator'); setAttribute(node, 'aria-orientation', 'horizontal');
    node.addEventListener('pointerdown', event => {
      const pair = pairs.get(node);
      if (!pair || !options.getCore() || !frame || event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); cancel(); options.onStart(); node.focus({ preventScroll: true });
      active = { element: node, pointer: event.pointerId, startY: event.clientY, lastY: event.clientY,
        ...pair, moved: false, weights: [...options.getWeights()] };
      node.setPointerCapture(event.pointerId); node.classList.add('resizing');
    }, listener);
    node.addEventListener('pointermove', event => {
      if (!active || active.element !== node || active.pointer !== event.pointerId || !Number.isFinite(event.clientY)) return;
      event.preventDefault();
      if (!active.moved && Math.abs(event.clientY - active.startY) < 4) return;
      active.moved = true;
      const delta = event.clientY - active.lastY; active.lastY = event.clientY;
      if (delta) queue(active.upper, active.lower, delta);
    }, listener);
    node.addEventListener('pointerup', event => {
      if (active?.element !== node || active.pointer !== event.pointerId) return;
      const previous = active; active = null;
      node.classList.remove('resizing');
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      if (previous.moved) { options.onCommit(); options.requestPaint(); }
    }, listener);
    for (const name of ['pointercancel', 'lostpointercapture'] as const) {
      node.addEventListener(name, event => { if (active?.element === node && active.pointer === event.pointerId) cancel(); }, listener);
    }
    node.addEventListener('keydown', event => {
      const pair = pairs.get(node);
      if (event.key === 'Escape' && active?.element === node) { event.preventDefault(); cancel(); return; }
      if (!pair || !frame || !options.getCore() || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); cancel(); options.onStart();
      const edge = event.key === 'Home' || event.key === 'End';
      const direction = event.key === 'ArrowUp' || event.key === 'Home' ? -1 : 1;
      queue(pair.upper, pair.lower, direction * (edge ? frame.meta[12] * 2 : 8), edge);
      options.onCommit();
    }, listener);
    node.addEventListener('dblclick', event => {
      const pair = pairs.get(node);
      if (!pair || !frame || !options.getCore() || event.button !== 0) return;
      event.preventDefault(); cancel(); options.onStart();
      pending.set(pair.upper, { lower: pair.lower, delta: 0, reset: true });
      options.onCommit(); options.requestPaint();
    }, listener);
  }
  function flush(): boolean {
    const core = options.getCore();
    if (!core || (!restore && !pending.size)) return false;
    const before = core.getPaneWeights();
    if (restore) { core.setPaneWeights(restore); restore = null; }
    if (frame) {
      const panes = bounds(frame);
      for (const [upper, change] of pending) {
        const index = panes.findIndex(pane => pane.id === upper);
        if (index < 0 || panes[index + 1]?.id !== change.lower) continue;
        if (change.reset) {
          const weights = core.getPaneWeights(), lower = change.lower;
          const ratio = DEFAULT_PANE_WEIGHTS[upper] / (DEFAULT_PANE_WEIGHTS[upper] + DEFAULT_PANE_WEIGHTS[lower]);
          const first = weights[upper], second = weights[lower];
          weights[upper] = first * ratio + second * ratio;
          weights[lower] = first * (1 - ratio) + second * (1 - ratio);
          core.setPaneWeights(weights);
        }
        if (change.delta) core.resizePane(upper, change.delta, frame.meta[12]);
      }
    }
    pending.clear();
    const weights = core.getPaneWeights();
    options.onWeights([...weights]);
    return weights.some((weight, index) => weight !== before[index]);
  }
  function updateFrame(value: Frame): void {
    const panes = bounds(value);
    if (active) {
      const index = panes.findIndex(pane => pane.id === active!.upper);
      if (index < 0 || panes[index + 1]?.id !== active.lower) cancel();
    }
    for (const [upper, change] of pending) {
      const index = panes.findIndex(pane => pane.id === upper);
      if (index < 0 || panes[index + 1]?.id !== change.lower) pending.delete(upper);
    }
    frame = value;
    while (nodes.length < Math.max(1, panes.length - 1)) {
      const node = options.container.ownerDocument.createElement('div');
      nodes.push(node); options.container.append(node); bind(node);
    }
    pairs.clear();
    for (const [index, node] of nodes.entries()) {
      const upper = panes[index], lower = panes[index + 1];
      const available = !!upper && !!lower && value.meta[12] > 0;
      node.hidden = !available; node.tabIndex = available ? 0 : -1;
      setAttribute(node, 'aria-disabled', String(!available));
      if (!available) continue;
      pairs.set(node, { upper: upper.id, lower: lower.id });
      const position = (upper.bottom + lower.top) / 2;
      const top = `${position}px`;
      if (node.style.top !== top) node.style.top = top;
      setAttribute(node, 'data-upper-pane', String(upper.id));
      setAttribute(node, 'data-lower-pane', String(lower.id));
      setAttribute(node, 'aria-valuemin', String(Math.round(upper.top)));
      setAttribute(node, 'aria-valuemax', String(Math.round(lower.bottom)));
      setAttribute(node, 'aria-valuenow', String(Math.round(position)));
    }
    refresh();
  }
  function resetFrame(): void {
    cancel(); pending.clear(); frame = null; pairs.clear();
    for (const node of nodes) {
      node.hidden = true; node.tabIndex = -1; setAttribute(node, 'aria-disabled', 'true');
    }
  }
  bind(options.first);
  resetFrame();
  return { refresh, cancel, flush, updateFrame, resetFrame,
    dispose() {
      cancel(false); pending.clear(); flush(); events.abort();
      for (const node of nodes.slice(1)) node.remove();
      resetFrame();
    },
  };
}
