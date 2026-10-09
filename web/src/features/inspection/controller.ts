import type { ChartCore } from '../../chart/bridge';
import type { ChartInvalidation } from '../../chart/scheduler';
import type { BarInfo, Frame, PaneId } from '../../chart/types';
import type { InspectionSelection } from './types';

interface Options {
  getCore(): ChartCore | undefined;
  getFrame(): Frame | null;
  onStart(): void;
  cancelNavigation(): void;
  loadHistory(): void;
  paint(level: ChartInvalidation): void;
}

/** Keep a UTC anchor across history prepends; the core owns visibility and panning. */
export class InspectionController {
  private time: number | null = null;
  private pane: PaneId = 0;
  private options: Options;
  constructor(options: Options) { this.options = options; }
  get active(): boolean { return this.time !== null; }

  start(preferredTime?: number): boolean {
    const core = this.options.getCore(), frame = this.options.getFrame();
    if (!core?.count || !frame) return false;
    let index = preferredTime === undefined ? -1 : core.indexAtTime(preferredTime);
    if (index < 0) {
      for (let row = 0; row < frame.rows.length; row += 17) {
        if (frame.rows[row + 9] >= 0 && frame.rows[row + 9] < frame.meta[11]) index = frame.rows[row];
      }
    }
    const bar = core.inspect(index < 0 ? core.count - 1 : index);
    if (!bar) return false;
    this.options.onStart(); this.time = bar.time; this.pane = 0;
    this.options.paint(core.revealBar(bar.index) > 0 ? 'full' : 'overlay');
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.time = null; this.options.paint('overlay');
  }

  /** Called inside the shared full-frame cycle, before copying fresh geometry. */
  ensureVisible(): void {
    if (this.time === null) return;
    const core = this.options.getCore(), index = core?.indexAtTime(this.time) ?? -1;
    if (index < 0) this.stop(); else core!.revealBar(index);
  }

  key(key: string): boolean {
    if (this.time === null) return false;
    if (key === 'Escape') { this.stop(); return true; }
    const core = this.options.getCore(), frame = this.options.getFrame();
    if (!core?.count || !frame) { this.stop(); return false; }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const panes = frame.panes ?? [], current = Math.max(0, panes.findIndex(pane => pane.id === this.pane));
      const next = Math.max(0, Math.min(panes.length - 1, current + (key === 'ArrowUp' ? -1 : 1)));
      this.pane = panes[next]?.id ?? 0; this.options.paint('overlay'); return true;
    }
    const current = core.indexAtTime(this.time);
    if (current < 0) { this.stop(); return false; }
    const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'PageUp' ? -10 : key === 'PageDown' ? 10 : null;
    const next = key === 'Home' ? 0 : key === 'End' ? core.count - 1 : delta === null ? null
      : Math.max(0, Math.min(core.count - 1, current + delta));
    if (next === null) return false;
    const bar = core.inspect(next);
    if (!bar) return false;
    this.options.cancelNavigation(); this.time = bar.time;
    this.options.paint(core.revealBar(next) > 0 ? 'full' : 'overlay');
    if (next < current || key === 'Home') this.options.loadHistory();
    return true;
  }

  resolve(frame: Frame): InspectionSelection | null {
    if (this.time === null) return null;
    const core = this.options.getCore(), index = core?.indexAtTime(this.time) ?? -1;
    if (index < 0) { this.stop(); return null; }
    const pane = frame.panes?.find(pane => pane.id === this.pane) ?? frame.panes?.[0];
    if (!pane) return null;
    this.pane = pane.id;
    let offset = -1;
    for (let row = 0; row < frame.rows.length; row += 17) if (frame.rows[row + 1] === this.time) { offset = row; break; }
    if (offset < 0) return null;
    // Values, index and geometry must describe the same copied frame, even if
    // a newer core revision is already waiting for the next full redraw.
    const [barIndex, time, open, high, low, close, volume, ma, ema] = frame.rows.subarray(offset, offset + 9);
    const bar: BarInfo = { index: barIndex, time, open, high, low, close, volume, ma, ema };
    const x = frame.rows[offset + 9], oscillator = offset / 17 * 8;
    const value = pane.id === 0 ? bar.close : pane.id === 1 ? bar.volume : frame.oscillators?.[oscillator + (pane.id === 2 ? 0 : 1)];
    const projected = pane.id === 0 ? frame.rows[offset + 13] : pane.id === 1 ? frame.rows[offset + 14]
      : frame.oscillators?.[oscillator + (pane.id === 2 ? 4 : 5)];
    const y = projected !== undefined && Number.isFinite(projected) ? Math.max(pane.contentTop, Math.min(pane.contentBottom, projected))
      : (pane.contentTop + pane.contentBottom) / 2;
    const pointVisible = projected !== undefined && Number.isFinite(projected)
      && projected >= pane.contentTop && projected <= pane.contentBottom;
    return { bar, frame, paneId: pane.id, x, y, pointVisible, value: value !== undefined && Number.isFinite(value) ? value : null };
  }
}
