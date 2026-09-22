import type { Bar, HistoryPage, MarketDataSource, MarketReplay, ReplayState } from './contracts';
import { bucketStart, nextBucketStart, getPeriod, MINUTE_MS, DAY_MS } from './periods.ts';
import type { PeriodId } from './periods';
import { DEFAULT_SYMBOL, findSampleInstrument } from './catalog.ts';

export const instrument = findSampleInstrument(DEFAULT_SYMBOL)!.instrument;
export const SAMPLE_START = Date.UTC(2022, 0, 1);
export const HISTORY_COUNT = (Date.UTC(2026, 0, 13, 8) - SAMPLE_START) / MINUTE_MS;

interface Profile {
  base: number; drift: number; swing: number; cycle: number; micro: number;
  seed: number; wick: number; volume: number;
}
const profiles: Record<string, Profile> = {
  'DEMO:STOCK': { base: 17500, drift: .0004, swing: 3500, cycle: 75, micro: 80, seed: 1709, wick: 25, volume: 40000 },
  'DEMO:FX': { base: 108000, drift: .001, swing: 4000, cycle: 130, micro: 40, seed: 4229, wick: 12, volume: 5000 },
  'DEMO:INDEX': { base: 180000, drift: .016, swing: 24000, cycle: 95, micro: 150, seed: 7919, wick: 80, volume: 12000 },
};

function profileClose(slot: number, profile: Profile): number {
  return Math.round(profile.base + slot * profile.drift +
    Math.sin(slot / 1440 / profile.cycle + profile.seed) * profile.swing +
    Math.sin(slot / (31 + profile.seed % 29)) * profile.micro +
    Math.sin(slot / (9 + profile.seed % 7)) * profile.micro / 3 +
    (noise(slot + profile.seed) - .5) * profile.micro / 2);
}

function profileBar(index: number, profile: Profile): Bar {
  const open = profileClose(index - 1, profile), last = profileClose(index, profile);
  return { time: SAMPLE_START + index * MINUTE_MS, open, close: last,
    high: Math.max(open, last) + Math.round(1 + noise(index + profile.seed + 1) * profile.wick),
    low: Math.min(open, last) - Math.round(1 + noise(index + profile.seed + 2) * profile.wick),
    volume: Math.round(100 + noise(index + profile.seed + 3) * profile.volume) };
}

function noise(index: number): number {
  let n = (index + 1337) | 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function closeAt(index: number): number {
  const days = index / 1440;
  return Math.round(4200000 + index * 0.08 + Math.sin(days / 120) * 450000 +
    Math.sin(days / 35) * 180000 + Math.sin(days / 7) * 60000 +
    Math.sin(index / 47) * 19000 + Math.sin(index / 13) * 6500 + (noise(index) - 0.5) * 4200);
}

/** Counter-based synthetic bars: a given index always produces identical data. */
export function sampleBar(index: number, symbol = DEFAULT_SYMBOL): Bar {
  if (symbol !== DEFAULT_SYMBOL) {
    if (!Object.hasOwn(profiles, symbol)) throw new Error(`Unknown sample instrument: ${symbol}`);
    return profileBar(index, profiles[symbol]);
  }
  const open = closeAt(index - 1);
  const close = closeAt(index);
  return {
    time: SAMPLE_START + index * MINUTE_MS, open, close,
    high: Math.max(open, close) + Math.round(300 + noise(index + 1) * 2600),
    low: Math.min(open, close) - Math.round(300 + noise(index + 2) * 2600),
    volume: Math.round(800 + noise(index + 3) * 8200),
  };
}

/** Each simulated minute has four cumulative OHLCV snapshots. */
export function replayBar(step: number, symbol = DEFAULT_SYMBOL): Bar {
  const index = HISTORY_COUNT + Math.floor(step / 4);
  return partialBar(index, step % 4, symbol);
}

function partialBar(index: number, phase: number, symbol = DEFAULT_SYMBOL): Bar {
  const final = sampleBar(index, symbol);
  const fraction = (phase + 1) / 4;
  const close = phase === 3 ? final.close : Math.round(final.open + (final.close - final.open) * fraction);
  return {
    ...final, close,
    high: phase === 3 ? final.high : Math.max(final.open, close),
    low: phase === 3 ? final.low : Math.min(final.open, close),
    volume: Math.round(final.volume * fraction),
  };
}

interface Snapshot { last: Bar; cutoff: number }
interface WorkBudget { samples: number }
const CHUNK_SIZE = 4096;
const DAY_CACHE_LIMIT = 1600;

function pause(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Task boundaries allow input and cancellation without nested-timer clamping.
    const channel = new MessageChannel();
    const clean = () => {
      channel.port1.close();
      channel.port2.close();
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => { clean(); reject(signal?.reason ?? new Error('History aborted')); };
    channel.port1.onmessage = () => { clean(); resolve(); };
    signal?.addEventListener('abort', cancel, { once: true });
    channel.port2.postMessage(undefined);
  });
}

function merge(target: Bar | undefined, bar: Bar, time: number): Bar {
  if (!target) return { ...bar, time };
  target.high = Math.max(target.high, bar.high);
  target.low = Math.min(target.low, bar.low);
  target.close = bar.close;
  target.volume += bar.volume;
  if (!Number.isSafeInteger(target.volume)) throw new Error('Aggregated volume exceeds safe integer range');
  return target;
}

/** A single replay clock backs every period. Only completed daily summaries are cached. */
export class SampleFeed implements MarketDataSource {
  private nextStep = -1;
  private clockStep = -1;
  private readonly days = new Map<number, Bar>();
  private stopSubscription?: () => void;
  private replayCutoff: number | null = null;
  private replayEnd = 0;
  private replayGeneration = 0;
  readonly replay: MarketReplay;

  constructor(private readonly symbol = DEFAULT_SYMBOL) {
    if (!findSampleInstrument(symbol)) throw new Error(`Unknown sample instrument: ${symbol}`);
    const feed = this;
    this.replay = {
      get state(): ReplayState { return feed.replayState(); },
      seek: cutoff => feed.seekReplay(cutoff),
      reset: () => feed.resetReplay(),
      advance: (period, signal) => feed.advanceReplay(period, signal),
    };
  }

  private replayState(): ReplayState {
    const cutoff = this.replayCutoff ?? this.liveSnapshot().cutoff;
    return { active: this.replayCutoff !== null, cutoff, end: this.replayCutoff === null ? cutoff : this.replayEnd };
  }

  private seekReplay(cutoff: number): void {
    const end = this.replayCutoff === null ? this.liveSnapshot().cutoff : this.replayEnd;
    if (!Number.isSafeInteger(cutoff) || cutoff <= SAMPLE_START || cutoff > end || (cutoff - SAMPLE_START) % 15_000 !== 0) {
      throw new Error('Replay cutoff must be an available 15-second boundary');
    }
    this.stopSubscription?.(); this.replayGeneration++;
    this.replayEnd = end; this.replayCutoff = cutoff;
  }

  private resetReplay(): void {
    this.stopSubscription?.(); this.replayGeneration++; this.replayCutoff = null;
  }

  private liveSnapshot(): Snapshot {
    return this.clockStep < 0
      ? { last: sampleBar(HISTORY_COUNT - 1, this.symbol), cutoff: SAMPLE_START + HISTORY_COUNT * MINUTE_MS }
      : { last: replayBar(this.clockStep, this.symbol), cutoff: SAMPLE_START + HISTORY_COUNT * MINUTE_MS + (this.clockStep + 1) * 15_000 };
  }

  private snapshotAt(cutoff: number): Snapshot {
    const index = Math.floor((cutoff - SAMPLE_START - 1) / MINUTE_MS);
    const phase = (cutoff - SAMPLE_START - index * MINUTE_MS) / 15_000 - 1;
    return { last: partialBar(index, phase, this.symbol), cutoff };
  }

  private snapshot(): Snapshot {
    return this.replayCutoff === null ? this.liveSnapshot() : this.snapshotAt(this.replayCutoff);
  }

  private async minutes(start: number, end: number, snapshot: Snapshot, budget: WorkBudget, signal?: AbortSignal): Promise<Bar> {
    let result: Bar | undefined;
    for (let time = start; time < end; time += MINUTE_MS) {
      if (++budget.samples >= CHUNK_SIZE) {
        budget.samples = 0;
        await pause(signal);
        signal?.throwIfAborted();
      }
      const bar = time === snapshot.last.time ? snapshot.last : sampleBar((time - SAMPLE_START) / MINUTE_MS, this.symbol);
      result = merge(result, bar, start);
    }
    if (!result) throw new Error('Empty aggregation range');
    return result;
  }

  private async aggregate(periodId: PeriodId, start: number, snapshot: Snapshot, budget: WorkBudget, signal?: AbortSignal): Promise<Bar> {
    const end = Math.min(nextBucketStart(start, periodId), snapshot.last.time + MINUTE_MS);
    let result: Bar | undefined;
    for (let time = start; time < end;) {
      const fullDay = time % DAY_MS === 0 && time + DAY_MS <= end && time + DAY_MS <= snapshot.cutoff;
      const until = fullDay ? time + DAY_MS : Math.min(end, Math.floor(time / DAY_MS + 1) * DAY_MS);
      let bar = fullDay ? this.days.get(time) : undefined;
      if (!bar) {
        bar = await this.minutes(time, until, snapshot, budget, signal);
        if (fullDay) {
          this.days.set(time, bar);
          if (this.days.size > DAY_CACHE_LIMIT) this.days.delete(this.days.keys().next().value!);
        }
      }
      result = merge(result, bar, start);
      time = until;
    }
    return result!;
  }

  async getHistory(periodId: PeriodId, before: number | undefined, limit: number, signal?: AbortSignal): Promise<HistoryPage> {
    getPeriod(periodId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100_000) throw new Error('History limit must be 1..100000');
    if (before !== undefined && (!Number.isSafeInteger(before) || !Number.isFinite(new Date(before).getTime()))) {
      throw new Error('Invalid history cursor');
    }
    const snapshot = this.snapshot(), replaying = this.replayCutoff !== null;
    await pause(signal);
    let first = bucketStart(SAMPLE_START, periodId);
    if (first < SAMPLE_START) first = nextBucketStart(first, periodId);
    const empty: HistoryPage = { periodId, bars: [], hasMore: false, partialLastBar: false,
      ...(replaying ? { asOf: snapshot.cutoff } : {}) };
    if (before !== undefined && before <= first) return empty;
    let start = bucketStart(Math.min(snapshot.last.time, before === undefined ? snapshot.last.time : before - 1), periodId);
    const starts: number[] = [];
    while (start >= first && starts.length < limit) {
      starts.push(start);
      start = bucketStart(start - 1, periodId);
      if (starts.length % CHUNK_SIZE === 0) await pause(signal);
    }
    const bars: Bar[] = [];
    const budget: WorkBudget = { samples: 0 };
    for (const time of starts.reverse()) {
      signal?.throwIfAborted();
      bars.push(await this.aggregate(periodId, time, snapshot, budget, signal));
    }
    const last = bars.at(-1);
    return { periodId, bars, hasMore: start >= first, asOf: snapshot.cutoff,
      partialLastBar: !!last && nextBucketStart(last.time, periodId) > snapshot.cutoff };
  }

  private async advanceReplay(periodId: PeriodId, signal?: AbortSignal): Promise<HistoryPage> {
    getPeriod(periodId); signal?.throwIfAborted();
    if (this.replayCutoff === null) throw new Error('Historical replay is not active');
    const cutoff = this.replayCutoff, generation = this.replayGeneration;
    if (cutoff === this.replayEnd) return { periodId, bars: [], hasMore: false, partialLastBar: false, asOf: cutoff };
    const target = Math.min(nextBucketStart(cutoff, periodId), this.replayEnd);
    const snapshot = this.snapshotAt(target), start = bucketStart(snapshot.last.time, periodId);
    let first = bucketStart(SAMPLE_START, periodId);
    if (first < SAMPLE_START) first = nextBucketStart(first, periodId);
    await pause(signal);
    const bars = start < first ? [] : [await this.aggregate(periodId, start, snapshot, { samples: 0 }, signal)];
    signal?.throwIfAborted();
    if (generation !== this.replayGeneration || this.replayCutoff !== cutoff) throw new Error('Replay state changed during step');
    this.replayCutoff = target;
    return { periodId, bars, hasMore: start > first, partialLastBar: bars.length > 0 && nextBucketStart(start, periodId) > target, asOf: target };
  }

  subscribe(periodId: PeriodId, onBars: (bars: Bar[], partialLastBar: boolean) => void, onError: (error: Error) => void): () => void {
    getPeriod(periodId);
    if (this.replayCutoff !== null) throw new Error('Use bar steps while historical replay is active');
    this.stopSubscription?.();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { controller.abort(); clearTimeout(timer); };
    this.stopSubscription = stop;
    let previous = this.snapshot();
    let prefix: Bar | undefined;
    let current: Bar;
    const fail = (error: unknown) => {
      if (controller.signal.aborted) return;
      stop();
      onError(error instanceof Error ? error : new Error(String(error)));
    };
    const tick = () => {
      if (controller.signal.aborted) return;
      try {
        if (this.nextStep < 0) this.nextStep = 0;
        else this.clockStep = this.nextStep++;
        const snapshot = this.snapshot();
        const start = bucketStart(snapshot.last.time, periodId);
        if (snapshot.last.time !== previous.last.time) {
          prefix = start === current.time ? current : undefined;
        }
        current = merge(prefix && { ...prefix }, snapshot.last, start);
        previous = snapshot;
        onBars([{ ...current }], nextBucketStart(start, periodId) > snapshot.cutoff);
        if (!controller.signal.aborted) timer = setTimeout(tick, 750);
      } catch (error) { fail(error); }
    };
    const prepare = async () => {
      const start = bucketStart(previous.last.time, periodId);
      if (start < previous.last.time) {
        prefix = await this.aggregate(periodId, start, {
          last: sampleBar((previous.last.time - SAMPLE_START) / MINUTE_MS - 1, this.symbol), cutoff: previous.last.time,
        }, { samples: 0 }, controller.signal);
      }
      current = merge(prefix && { ...prefix }, previous.last, start);
      if (!controller.signal.aborted) timer = setTimeout(tick, 750);
    };
    void prepare().catch(fail);
    return stop;
  }
}
