import { t } from './i18n.ts';
import type { Frame } from '../chart/types';
import { defaultLayout, readLayout } from './layout-preferences.ts';
import { createPaneResizers, type PaneResizeCore } from './pane-resizers.ts';

interface WorkspaceLayoutOptions {
  getCore(): PaneLayoutCore | undefined;
  getFrame?(): Frame | null;
  onStart(): void;
  requestPaint(): void;
}
interface PaneLayoutCore extends PaneResizeCore {
  getPaneOrder(): number[];
  movePane(id: number, direction: number): void;
  maximizePane(id: number): void;
  readonly maximizedPane: number;
}

/** Resize input stays in the host; the core supplies every pane's actual geometry. */
export function createWorkspaceLayout(options: WorkspaceLayoutOptions) {
  const { onStart, requestPaint } = options;
  let state = defaultLayout();
  try { state = readLayout(localStorage.getItem('zigchart.layout')); } catch { /* Optional layout storage. */ }
  const desk = document.querySelector<HTMLElement>('.desk')!;
  const chart = document.getElementById('chart-container')!;
  const side = document.getElementById('sidebar-resizer')!;
  const events = new AbortController();
  const signal = events.signal;
  let pendingWidth: number | null = null;
  let pendingSave = false;
  let maximumWidth = 220;
  let active: { element: HTMLElement; pointer: number; x: number; width: number } | null = null;
  const save = () => { try { localStorage.setItem('zigchart.layout', JSON.stringify(state)); } catch { /* Optional layout storage. */ } };
  const panes = createPaneResizers({ container: chart, first: document.getElementById('pane-resizer')!,
    getCore: options.getCore, getWeights: () => state.paneWeights,
    onWeights: weights => { state.paneWeights = weights; }, onCommit: () => { pendingSave = true; },
    onStart: () => { cancelResize(); onStart(); }, requestPaint,
  });
  const measureWidthLimit = () => {
    const width = desk.clientWidth;
    const rail = parseFloat(getComputedStyle(desk).getPropertyValue('--rail-width')) || 48;
    // Desktop keeps a usable price plot; mobile keeps a narrow strip beside its overlay.
    maximumWidth = Math.max(220, width - (width <= 760 ? 48 : rail + 6 + 220));
  };
  const applyWidth = (width: number) => {
    const maximum = maximumWidth;
    const next = Math.max(220, Math.min(maximum, width));
    const changed = state.sidebarWidth !== next;
    state.sidebarWidth = next;
    const cssWidth = `${next}px`;
    if (desk.style.getPropertyValue('--sidebar-width') !== cssWidth) desk.style.setProperty('--sidebar-width', cssWidth);
    side.setAttribute('aria-valuenow', String(Math.round(state.sidebarWidth)));
    side.setAttribute('aria-valuemax', String(Math.round(maximum)));
    return changed;
  };
  const queueWidth = (width: number) => { pendingWidth = width; requestPaint(); };
  const flush = () => {
    const width = pendingWidth;
    pendingWidth = null;
    let changed = width !== null && applyWidth(width);
    changed = panes.flush() || changed;
    if (pendingSave) { pendingSave = false; save(); }
    return changed;
  };
  const refresh = () => {
    side.setAttribute('aria-label', t('resizeSidebar'));
    side.title = t('resizeHint');
    panes.refresh();
  };
  function cancelResize() {
    if (!active) return;
    const { element, pointer } = active;
    active = null;
    element.classList.remove('resizing');
    if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  }
  for (const element of [side]) {
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); cancelResize(); panes.cancel(); onStart(); element.focus({ preventScroll: true });
      measureWidthLimit();
      active = { element, pointer: event.pointerId, x: event.clientX, width: state.sidebarWidth };
      element.setPointerCapture(event.pointerId); element.classList.add('resizing');
    }, { signal });
    element.addEventListener('pointermove', event => {
      if (active?.element !== element || active.pointer !== event.pointerId) return;
      queueWidth(active.width + active.x - event.clientX);
    }, { signal });
    const finish = (event: PointerEvent) => {
      if (active?.element !== element || active.pointer !== event.pointerId) return;
      if (event.type === 'pointercancel') {
        queueWidth(active.width);
      }
      cancelResize();
      pendingSave = true; requestPaint();
    };
    element.addEventListener('pointerup', finish, { signal });
    element.addEventListener('pointercancel', finish, { signal });
    element.addEventListener('lostpointercapture', finish, { signal });
    element.addEventListener('keydown', event => {
      const negative = 'ArrowRight';
      const positive = 'ArrowLeft';
      if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); panes.cancel(); onStart(); measureWidthLimit();
      queueWidth(event.key === 'Home' ? 220 : event.key === 'End' ? maximumWidth : (pendingWidth ?? state.sidebarWidth) + (event.key === positive ? 16 : -16));
      pendingSave = true;
    }, { signal });
    element.addEventListener('dblclick', () => {
      measureWidthLimit(); panes.cancel(); onStart(); queueWidth(defaultLayout().sidebarWidth);
      pendingSave = true;
    }, { signal });
  }
  window.addEventListener('resize', () => {
    cancelResize(); panes.cancel(); measureWidthLimit(); queueWidth(state.sidebarWidth);
  }, { signal });
  measureWidthLimit(); applyWidth(state.sidebarWidth); refresh();
  const initialFrame = options.getFrame?.();
  if (initialFrame) panes.updateFrame(initialFrame);
  function arrange(change: (core: PaneLayoutCore) => void, persist: boolean) {
    const core = options.getCore();
    if (!core) return;
    cancelResize(); panes.resetFrame(); flush(); onStart();
    change(core);
    if (persist) { state.paneOrder = core.getPaneOrder(); save(); }
    requestPaint();
  }
  return {
    get paneWeights() { return [...state.paneWeights]; }, refresh, flush,
    get paneOrder() { return [...state.paneOrder]; },
    get maximizedPane() { return options.getCore()?.maximizedPane ?? -1; },
    movePane(id: number, direction: number) { arrange(core => core.movePane(id, direction), true); },
    maximizePane(id: number) { arrange(core => core.maximizePane(id), false); },
    updateFrame: panes.updateFrame,
    resetFrame() {
      cancelResize(); pendingWidth = null; pendingSave = false; panes.resetFrame();
    },
    dispose() { cancelResize(); panes.dispose(); pendingWidth = null; pendingSave = false; events.abort(); },
  };
}
