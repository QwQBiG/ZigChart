import type { Bar, HistoryPage, MarketDataSource, ReplayState } from './contracts';
import type { PeriodId } from './periods';
import { REPLAY_SPEEDS } from './replay.ts';

export interface SessionEvents {
  reset(period: PeriodId): void;
  history(page: HistoryPage, initial: boolean): void;
  bars(bars: Bar[], partialLastBar: boolean): void;
  corrections(bars: Bar[]): void;
  change(): void;
  error(error: unknown, source: 'history' | 'stream' | 'update'): void;
}

/** Owns one period's request and subscription lifetime; late callbacks have no effect. */
export class MarketSession {
  period: PeriodId = '1m';
  loading = false;
  hasMore = true;
  ready = false;
  running = false;
  replayStarted = false;
  replaySpeed = 1;
  stepping = false;
  private generation = 0;
  private stream = 0;
  private abort = new AbortController();
  private unsubscribe: (() => void) | null = null;
  private resumeAfterLoad = false;
  private disposed = false;
  private historyCursor: number | undefined;
  private stepAbort: AbortController | null = null;
  private replayTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private feed: MarketDataSource, private readonly events: SessionEvents) {}

  get historyBefore(): number | undefined { return this.historyCursor; }
  get browsingHistory(): boolean { return this.historyCursor !== undefined; }
  get replayState(): ReplayState | null { return this.feed.replay?.state ?? null; }

  async replaceSource(nextFeed: MarketDataSource, period: PeriodId = this.period): Promise<void> {
    if (this.disposed) return;
    // Invalidate callbacks before abort or unsubscribe can invoke provider cleanup.
    this.generation++;
    this.abort.abort();
    this.resumeAfterLoad = false;
    this.stop();
    this.feed = nextFeed;
    this.replaySpeed = 1;
    this.replayStarted = false;
    this.historyCursor = undefined;
    await this.open(period);
  }

  async enterReplay(cutoff: number): Promise<void> {
    if (this.disposed) return;
    this.resumeAfterLoad = false; this.stop();
    try {
      if (!this.feed.replay) throw new Error('Historical replay is unavailable for this source');
      this.feed.replay.seek(cutoff);
    } catch (error) { this.events.error(error, 'stream'); this.events.change(); return; }
    await this.open(this.period);
  }

  async exitReplay(): Promise<void> {
    if (this.disposed || !this.feed.replay?.state.active) return;
    this.resumeAfterLoad = false; this.stop();
    try { this.feed.replay.reset(); }
    catch (error) { this.events.error(error, 'stream'); this.events.change(); return; }
    await this.open(this.period);
  }

  setReplaySpeed(speed: number): void {
    if (!(REPLAY_SPEEDS as readonly number[]).includes(speed)) throw new Error('Unsupported replay speed');
    if (this.disposed || speed === this.replaySpeed) return;
    this.replaySpeed = speed;
    if (this.running && this.feed.replay?.state.active && !this.stepping) this.scheduleReplay();
    this.events.change();
  }

  async stepReplay(): Promise<void> {
    if (this.disposed || !this.feed.replay?.state.active || this.browsingHistory || this.stepping) return;
    this.resumeAfterLoad = false;
    if (this.running) { this.stop(); this.events.change(); }
    await this.advanceReplay(false);
  }

  pauseReplay(): void {
    if (this.disposed) return;
    this.resumeAfterLoad = false; this.stop(true); this.events.change();
  }

  async open(period: PeriodId, before?: number): Promise<void> {
    if (this.disposed) return;
    if (before !== undefined && (!Number.isSafeInteger(before) || !Number.isFinite(new Date(before).getTime()))) {
      throw new Error('Invalid history snapshot cursor');
    }
    const resume = before === undefined && (this.running || this.resumeAfterLoad);
    this.stop();
    this.abort.abort();
    this.abort = new AbortController();
    this.generation++;
    this.period = period;
    this.historyCursor = before;
    this.loading = false;
    this.hasMore = true;
    this.ready = false;
    this.resumeAfterLoad = resume;
    this.events.reset(period);
    await this.load();
  }

  async load(before?: number): Promise<void> {
    if (this.disposed || this.loading || !this.hasMore) return;
    const generation = this.generation;
    const initial = !this.ready;
    const cursor = before ?? (initial ? this.historyCursor : undefined);
    const replay = this.replayState;
    const replayCutoff = replay?.active ? replay.cutoff : undefined;
    this.loading = true;
    this.events.change();
    try {
      const page = await this.feed.getHistory(this.period, cursor, 500, this.abort.signal);
      if (this.disposed || generation !== this.generation) return;
      if (page.periodId !== this.period) throw new Error('History response period mismatch');
      if (replayCutoff !== undefined && (page.asOf !== replayCutoff || page.bars.some(bar => bar.time >= replayCutoff))) {
        throw new Error('History response exceeds replay snapshot cutoff');
      }
      if (cursor !== undefined && page.bars.some(bar => bar.time >= cursor)) {
        throw new Error('History response exceeds exclusive cursor');
      }
      if (page.asOf !== undefined && (!Number.isSafeInteger(page.asOf) || !Number.isFinite(new Date(page.asOf).getTime()) ||
        (page.bars.length > 0 && page.asOf <= page.bars[page.bars.length - 1].time))) {
        throw new Error('Invalid history snapshot cutoff');
      }
      this.events.history(page, initial);
      this.hasMore = page.hasMore && page.bars.length > 0;
      this.ready ||= page.bars.length > 0;
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.events.error(error, 'history');
    } finally {
      if (!this.disposed && generation === this.generation) {
        this.loading = false;
        if (this.ready && this.resumeAfterLoad) {
          this.resumeAfterLoad = false;
          this.start();
        }
        this.events.change();
      }
    }
  }

  toggleReplay(): void {
    if (this.running) { this.resumeAfterLoad = false; this.stop(true); }
    else if (this.ready && !this.disposed && !this.browsingHistory) this.start();
    this.events.change();
  }

  private start(): void {
    if (this.running || this.disposed || this.stepping) return;
    const replay = this.feed.replay?.state;
    if (replay?.active && replay.cutoff >= replay.end) return;
    const generation = this.generation;
    const stream = ++this.stream;
    const active = () => !this.disposed && this.running && generation === this.generation && stream === this.stream;
    this.running = true;
    this.replayStarted = true;
    if (replay?.active) { this.scheduleReplay(); return; }
    try {
      const stop = this.feed.subscribe(this.period, (bars, partial) => {
        if (!active()) return;
        try { this.events.bars(bars, partial); }
        catch (error) { this.stop(); this.events.error(error, 'update'); this.events.change(); }
      }, error => {
        if (!active()) return;
        this.stop(); this.events.error(error, 'stream'); this.events.change();
      }, bars => {
        if (!active()) return;
        try { this.events.corrections(bars); }
        catch (error) { this.stop(); this.events.error(error, 'update'); this.events.change(); }
      });
      if (active()) this.unsubscribe = stop; else this.release(stop);
    } catch (error) {
      this.stop(); this.events.error(error, 'stream');
    }
  }

  private scheduleReplay(): void {
    clearTimeout(this.replayTimer);
    if (!this.running || this.disposed || !this.feed.replay?.state.active) return;
    this.replayTimer = setTimeout(() => {
      this.replayTimer = undefined;
      void this.advanceReplay(true);
    }, 1000 / this.replaySpeed);
  }

  private async advanceReplay(automatic: boolean): Promise<void> {
    const replay = this.feed.replay;
    if (!replay?.state.active || this.disposed || this.browsingHistory) return;
    if (this.loading || this.stepping || !this.ready) {
      if (automatic) this.scheduleReplay();
      return;
    }
    const previous = replay.state;
    if (previous.cutoff >= previous.end) { this.stop(); this.events.change(); return; }
    const generation = this.generation, stream = this.stream, period = this.period;
    const controller = new AbortController();
    this.stepAbort = controller; this.stepping = true; this.events.change();
    const active = () => !this.disposed && !controller.signal.aborted && generation === this.generation && stream === this.stream;
    let source: 'stream' | 'update' = 'stream';
    try {
      const page = await replay.advance(period, controller.signal);
      if (!active()) return;
      const state = replay.state;
      if (page.periodId !== period || page.asOf === undefined || !Number.isSafeInteger(page.asOf) ||
        !state.active || page.asOf !== state.cutoff || state.end !== previous.end ||
        page.asOf <= previous.cutoff || page.asOf > previous.end || page.bars.length > 1 ||
        page.bars.some(bar => bar.time >= page.asOf!)) throw new Error('Invalid replay step response');
      source = 'update';
      if (page.bars.length) this.events.bars(page.bars, page.partialLastBar);
      this.replayStarted = true;
    } catch (error) {
      if (!active()) return;
      this.stop(); this.events.error(error, source); this.events.change();
      return;
    } finally {
      if (this.stepAbort === controller) { this.stepAbort = null; this.stepping = false; }
    }
    if (!active()) return;
    if (replay.state.cutoff >= replay.state.end) this.stop();
    else if (automatic && this.running) this.scheduleReplay();
    this.events.change();
  }

  private release(unsubscribe: () => void, reportFailure = false): void {
    const generation = this.generation;
    const stream = this.stream;
    try { unsubscribe(); }
    catch (error) {
      // Retired subscriptions cannot block teardown or replace an existing failure.
      if (reportFailure && !this.disposed && generation === this.generation && stream === this.stream) {
        this.events.error(error, 'stream');
      }
    }
  }

  private stop(reportFailure = false): void {
    this.running = false;
    this.stream++;
    clearTimeout(this.replayTimer); this.replayTimer = undefined;
    this.stepAbort?.abort(); this.stepAbort = null; this.stepping = false;
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = null;
    if (unsubscribe) this.release(unsubscribe, reportFailure);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.abort.abort();
    this.stop();
  }
}
