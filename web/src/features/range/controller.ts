import { bucketStart } from '../../data/periods.ts';
import type { PeriodId } from '../../data/periods';
import { rangePeriod, rangePeriodBetween, rangeStart, type RangeId } from './model.ts';

interface RangeHost {
  cutoff(): number | null;
  width(): number;
  open(period: PeriodId, before?: number): Promise<void>;
  load(before: number): Promise<void>;
  first(): number | null;
  hasMore(): boolean;
  fit(from: number, to: number): number;
  change(): void;
}
export type RangeStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'limited' | 'empty' | 'error';

/** Cancels obsolete fits without owning a second market subscription or viewport. */
export class RangeController {
  selected: RangeId | 'Custom' | null = null;
  status: RangeStatus = 'idle';
  private generation = 0;
  private lastCutoff: number | null = null;
  constructor(private readonly host: RangeHost) {}

  cutoff(): number | null {
    const current = this.host.cutoff();
    if (current !== null) this.lastCutoff = current;
    return this.lastCutoff;
  }

  cancel(): void {
    this.generation++;
    this.selected = null;
    this.status = 'idle';
    this.host.change();
  }

  resetSource(): void {
    this.lastCutoff = null;
    this.cancel();
  }

  async select(id: RangeId): Promise<void> {
    const end = this.cutoff();
    if (end === null) return;
    const period = rangePeriod(id, end, this.host.width());
    await this.apply(id, rangeStart(id, end), end, period);
  }

  async custom(from: number, to: number): Promise<void> {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from ||
      !Number.isFinite(new Date(from).getTime()) || !Number.isFinite(new Date(to).getTime())) return;
    const end = this.cutoff();
    if (end === null || from >= end) return;
    to = Math.min(to, end);
    await this.apply('Custom', from, to, rangePeriodBetween(from, to, this.host.width()), to);
  }

  private async apply(id: RangeId | 'Custom', start: number, end: number, period: PeriodId, before?: number): Promise<void> {
    const token = ++this.generation;
    const from = bucketStart(start, period);
    this.selected = id;
    this.status = 'loading';
    this.host.change();
    try {
      await this.host.open(period, before);
      if (token !== this.generation) return;
      let first = this.host.first();
      if (first === null) {
        this.status = 'empty';
        this.host.change();
        return;
      }
      // History remains bounded by the core's capacity; failed/non-progressing pages stop immediately.
      for (let pages = 0; first > from && this.host.hasMore(); pages++) {
        if (pages >= 199) throw new Error('Range history capacity reached');
        await this.host.load(first);
        if (token !== this.generation) return;
        const previous = first;
        first = this.host.first();
        if (first === null) throw new Error('Range history disappeared');
        if (first >= previous) {
          if (!this.host.hasMore()) break;
          throw new Error('Range history did not advance');
        }
      }
      const result = this.host.fit(from, end);
      this.status = result < 0 ? 'empty' : result > 0 ? 'limited' :
        first > from && id !== 'All' ? 'partial' : 'ready';
    } catch {
      if (token !== this.generation) return;
      this.status = 'error';
    }
    this.host.change();
  }
}
